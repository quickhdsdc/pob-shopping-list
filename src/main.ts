/** 页面装配：读控件、跑流程、把结果交给 ui.ts 渲染。 */

import { fetchLeagues, ImportError, importFromUrl, looksLikeUrl } from './api.js';
import { parseBuild } from './core/build.js';
import { isUniqueRarity } from './core/items.js';
import { decodePobCode, PobError, type PobErrorCode } from './core/pob.js';
import { buildQuery, type TradeStatus, tradeUrl } from './core/query.js';
import { matchMod } from './core/stats.js';
import { loadTables, type Tables } from './data.js';
import { type CardState, renderCards } from './ui.js';

declare const __DATA_VERSION__: string;

const MESSAGES: Record<PobErrorCode, string> = {
  empty: '先粘贴 PoB 代码',
  'is-url': '请粘贴代码本身，不是链接 —— 浏览器跨域读不到 pobb.in / pob.cool',
  'bad-base64': '不是合法的 base64，检查有没有复制全',
  'no-decompression': '浏览器太旧，不支持 DecompressionStream，请换 Chrome / Edge / Firefox 新版',
  'inflate-failed': '解压失败，这可能不是一段 PoB 代码',
  'bad-xml': '解出来的不是合法的 PoB 存档',
  'no-items': '这段代码里没有任何装备',
};

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`页面缺少 #${id}`);
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
const output = need<HTMLDivElement>('out');

let tables: Tables | null = null;
let cards: CardState[] = [];

function say(message: string, kind: '' | 'ok' | 'err' = ''): void {
  statusLine.textContent = message;
  statusLine.className = kind;
}

function league(): string {
  return leagueInput.value;
}

function status(): TradeStatus {
  return statusSelect.value as TradeStatus;
}

function urlFor(card: CardState): string {
  return tradeUrl(league(), buildQuery(card, status()));
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
    say('对照表还没加载完，稍等一下', 'err');
    return;
  }
  // 贴的是链接就先让 Worker 去把代码取回来，取到之后原地替换掉输入框内容 ——
  // 用户能看见拿到的是什么，也能在导入之后再手改。
  let raw = codeInput.value;
  if (looksLikeUrl(raw)) {
    say('正在从链接取回 build…');
    try {
      raw = await importFromUrl(raw);
      codeInput.value = raw;
    } catch (e) {
      say(e instanceof ImportError ? e.message : `导入失败：${String(e)}`, 'err');
      return;
    }
  }

  say('解码中…');

  let items;
  try {
    const xml = await decodePobCode(raw);
    items = parseBuild(xml, tables.bases);
  } catch (e) {
    say(e instanceof PobError ? MESSAGES[e.code] : `出错了：${String(e)}`, 'err');
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
        button.textContent = ok ? '已复制' : '失败';
        setTimeout(() => (button.textContent = '复制'), 1500);
      },
    },
  );

  // 传奇按名字搜，词条识别与否不影响结果，所以只统计稀有/魔法装备上的
  let modTotal = 0;
  let nonUniqueMods = 0;
  let unmatched = 0;
  for (const item of items) {
    modTotal += item.mods.length;
    if (isUniqueRarity(item.rarity)) continue;
    for (const m of item.mods) {
      nonUniqueMods++;
      if (!matchMod(stats, m).id) unmatched++;
    }
  }
  say(
    `解析出 ${items.length} 件装备，共 ${modTotal} 条词条。` +
      `稀有/魔法装备 ${nonUniqueMods} 条里有 ${unmatched} 条未识别（红色标出，需手动处理）；` +
      `传奇按名字搜，词条不影响。`,
    'ok',
  );
}

goButton.addEventListener('click', () => {
  void run();
});

copyAllButton.addEventListener('click', () => {
  void (async () => {
    if (cards.length === 0) {
      say('还没生成', 'err');
      return;
    }
    const text = cards
      .map((c) => `### ${c.name}${c.base && c.base !== c.name ? ` | ${c.base}` : ''}\n${urlFor(c)}`)
      .join('\n\n');
    const ok = await copyText(text);
    say(ok ? `已复制 ${cards.length} 条链接` : '复制失败', ok ? 'ok' : 'err');
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
    say(`词条对照表加载失败：${String(e)}`, 'err');
  }
  // 赛季列表取不到不影响主流程，所以不拦着上面的按钮解禁
  await populateLeagues();
})();
