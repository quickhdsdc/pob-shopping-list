/** 页面装配：读控件、跑流程、把结果交给 ui.ts 渲染。 */

import { fetchLeagues, ImportError, importFromUrl, looksLikeUrl } from './api.js';
import { COPY } from './copy.js';
import { parseBuild } from './core/build.js';
import { isUniqueRarity } from './core/items.js';
import { decodePobCode, PobError } from './core/pob.js';
import { buildQuery, type TradeStatus, tradeUrl } from './core/query.js';
import { matchMod } from './core/stats.js';
import { loadTables, type Tables } from './data.js';
import { type CardState, renderCards, renderSummary } from './ui.js';

declare const __DATA_VERSION__: string;

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`page is missing #${id}`);
  return node as T;
}

const codeInput = need<HTMLTextAreaElement>('code');
const leagueInput = need<HTMLInputElement>('league');
const statusSelect = need<HTMLSelectElement>('st');
const tolInput = need<HTMLInputElement>('tol');
const maxModsInput = need<HTMLInputElement>('maxmods');
const goButton = need<HTMLButtonElement>('go');
const copyAllButton = need<HTMLButtonElement>('copyall');
const statusLine = need<HTMLParagraphElement>('status');
const summaryBar = need<HTMLDivElement>('summary');
const output = need<HTMLDivElement>('out');

let tables: Tables | null = null;
let cards: CardState[] = [];

function say(message: string, kind: '' | 'ok' | 'err' = ''): void {
  statusLine.textContent = message;
  statusLine.className = kind;
}

function status(): TradeStatus {
  return statusSelect.value as TradeStatus;
}

function urlFor(card: CardState): string {
  return tradeUrl(leagueInput.value, buildQuery(card, status()));
}

function numberFrom(input: HTMLInputElement, fallback: number): number {
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? v : fallback;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  if (!tables) {
    say(COPY.status.notReady, 'err');
    return;
  }

  // 贴的是链接就先让 Worker 去把代码取回来，取到之后原地替换掉输入框内容 ——
  // 用户能看见拿到的是什么，也能在导入之后再手改。
  let raw = codeInput.value;
  if (looksLikeUrl(raw)) {
    say(COPY.status.importing);
    try {
      raw = await importFromUrl(raw);
      codeInput.value = raw;
    } catch (e) {
      say(e instanceof ImportError ? e.message : String(e), 'err');
      return;
    }
  }

  say(COPY.status.decoding);

  let items;
  try {
    const xml = await decodePobCode(raw);
    items = parseBuild(xml, tables.bases);
  } catch (e) {
    say(e instanceof PobError ? COPY.errors[e.code] : String(e), 'err');
    return;
  }

  const stats = tables.stats;
  cards = renderCards(
    output,
    items,
    stats,
    {
      tolerance: numberFrom(tolInput, 80) / 100,
      maxMods: Math.max(1, Math.round(numberFrom(maxModsInput, 4))),
    },
    {
      onSearch: (card) => window.open(urlFor(card), '_blank', 'noopener'),
      onCopy: async (card, button) => {
        const ok = await copyText(urlFor(card));
        button.textContent = ok ? COPY.buttons.copied : COPY.buttons.copyFailed;
        setTimeout(() => (button.textContent = COPY.buttons.copy), 1500);
      },
    },
  );

  // 传奇按名字搜，词条识别与否不影响结果，所以只统计稀有/魔法装备上的
  let matched = 0;
  let unmatched = 0;
  for (const item of items) {
    if (isUniqueRarity(item.rarity)) continue;
    for (const m of item.mods) {
      if (matchMod(stats, m).id) matched++;
      else unmatched++;
    }
  }
  renderSummary(summaryBar, { items: items.length, matched, unmatched });
  copyAllButton.textContent = COPY.buttons.copyAll(cards.length);
  say('');
}

goButton.addEventListener('click', () => {
  void run();
});

copyAllButton.addEventListener('click', () => {
  void (async () => {
    if (cards.length === 0) {
      say(COPY.copyAll.nothing, 'err');
      return;
    }
    const text = cards
      .map((c) => `### ${c.name}${c.base && c.base !== c.name ? ` | ${c.base}` : ''}\n${urlFor(c)}`)
      .join('\n\n');
    const ok = await copyText(text);
    say(ok ? COPY.copyAll.done(cards.length) : COPY.copyAll.failed, ok ? 'ok' : 'err');
  })();
});

// 用户一旦自己改过赛季，就不再被接口返回的当前赛季覆盖
let leagueTouched = false;
leagueInput.addEventListener('input', () => {
  leagueTouched = true;
});

/**
 * 填赛季下拉。
 *
 * 用 <input list> 而不是 <select>：接口拿不到时（离线单文件版）
 * 输入框还能手填，行为跟以前一模一样。
 */
async function populateLeagues(): Promise<void> {
  const data = await fetchLeagues();
  if (!data) return; // 离线版：保持手填
  const list = need<HTMLDataListElement>('leagues');
  list.textContent = '';
  for (const l of data.leagues) {
    const opt = document.createElement('option');
    opt.value = l.id;
    list.appendChild(opt);
  }
  if (!leagueTouched) leagueInput.value = data.current;
}

void (async () => {
  try {
    tables = await loadTables(__DATA_VERSION__);
    goButton.disabled = false;
    say('');
  } catch (e) {
    say(COPY.status.tablesFailed(String(e)), 'err');
  }
  // 赛季列表取不到不影响主流程，所以不拦着上面的按钮解禁
  await populateLeagues();
})();
