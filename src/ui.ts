/**
 * 界面层：把解析好的装备渲染成卡片，并维护「勾了哪几条、门槛填多少」的状态。
 *
 * 所有查询逻辑都在 core/ 里，这里只负责 DOM 和状态；所有文案在 copy.ts。
 */

import { COPY } from './copy.js';
import { type BuildItem, type Slot } from './core/build.js';
import { isUniqueRarity } from './core/items.js';
import { autoSelect, type Cmp, cmpFor, type FilterRow, type QueryCard, tolValue } from './core/query.js';
import { matchMod, type StatIndex, stripTag } from './core/stats.js';

interface RowState extends FilterRow {
  on: boolean;
  value: number | null;
}

export interface CardState extends QueryCard {
  readonly rows: RowState[];
}

export interface RenderOptions {
  readonly tolerance: number;
  readonly maxMods: number;
}

export interface CardHandlers {
  readonly onSearch: (card: CardState) => void;
  readonly onCopy: (card: CardState, button: HTMLButtonElement) => void;
}

export function formatSlot(slot: Slot): string {
  switch (slot.kind) {
    case 'equipment':
      return slot.name;
    case 'tree-jewel':
      return COPY.card.treeJewel(slot.nodeId);
    case 'unequipped':
      return COPY.card.unequipped;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badge(text: string, bad = false): HTMLSpanElement {
  return el('span', bad ? 'badge bad' : 'badge', text);
}

function renderCard(
  item: BuildItem,
  stats: StatIndex,
  opts: RenderOptions,
  handlers: CardHandlers,
): { node: HTMLElement; state: CardState } {
  const matches = item.mods.map((m) => matchMod(stats, m));
  const auto = autoSelect(item.mods, matches, opts.maxMods, item.rarity);
  const isUnique = isUniqueRarity(item.rarity);

  const state: CardState = {
    rarity: item.rarity,
    name: item.name,
    base: item.base,
    baseUnknown: item.baseUnknown,
    rows: [],
  };

  const card = el('div', item.baseUnknown ? 'card has-warn' : 'card');

  const head = el('div', 'chead');
  const left = el('div');
  left.appendChild(el('div', 'slot', formatSlot(item.slot)));
  left.appendChild(el('div', `iname r-${item.rarity}`, item.name));
  if (item.base && item.base !== item.name) {
    left.appendChild(el('div', 'ibase', item.base));
  }
  if (item.baseUnknown) {
    left.appendChild(el('div', 'ibase warn', COPY.card.baseUnknown));
  }
  head.appendChild(left);

  const acts = el('div', 'acts');
  const searchBtn = el('button', undefined, COPY.buttons.search);
  const copyBtn = el('button', 'sec', COPY.buttons.copy);
  acts.append(searchBtn, copyBtn);
  head.appendChild(acts);
  card.appendChild(head);

  if (item.mods.length > 0) {
    const table = el('table', 'mods');
    item.mods.forEach((mod, i) => {
      const match = matches[i]!;
      const cmp: Cmp = cmpFor(match.value);
      const row: RowState = {
        on: auto.has(i),
        id: match.id,
        cmp,
        value: match.value === null ? null : tolValue(match.value, opts.tolerance),
      };
      state.rows.push(row);

      const tr = el('tr', mod.implicit ? 'impl' : undefined);

      const tdCheck = el('td', 'num');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = row.on;
      check.disabled = !match.id;
      tdCheck.appendChild(check);
      tr.appendChild(tdCheck);

      const tdText = el('td', 'txt', stripTag(mod.line));
      if (mod.implicit) tdText.appendChild(badge(COPY.card.implicit));
      if (!match.id) {
        tdText.classList.add('nomatch');
        tdText.appendChild(badge(COPY.card.noFilter, true));
      }
      tr.appendChild(tdText);

      // 未识别的词条给一句原因，别让人对着红字猜
      tr.appendChild(el('td', 'reason', match.id ? '' : COPY.card.noFilterReason));

      const tdNum = el('td', 'num');
      tdNum.appendChild(el('span', 'cmp', match.id ? (cmp === 'max' ? '≤' : '≥') : ''));
      const input = el('input');
      input.type = 'number';
      input.step = 'any';
      input.disabled = !match.id;
      if (row.value !== null) input.value = String(row.value);
      tdNum.appendChild(input);
      tr.appendChild(tdNum);

      check.addEventListener('change', () => {
        row.on = check.checked;
        tdText.classList.toggle('off', !check.checked && !!match.id);
      });
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        row.value = Number.isFinite(v) ? v : null;
      });

      table.appendChild(tr);
    });
    card.appendChild(table);
  }

  const picked = state.rows.filter((r) => r.on).length;
  card.appendChild(
    el('p', 'hint', isUnique ? COPY.card.hintUnique : COPY.card.hintOther(picked)),
  );

  searchBtn.addEventListener('click', () => handlers.onSearch(state));
  copyBtn.addEventListener('click', () => handlers.onCopy(state, copyBtn));

  return { node: card, state };
}

export function renderCards(
  container: HTMLElement,
  items: readonly BuildItem[],
  stats: StatIndex,
  opts: RenderOptions,
  handlers: CardHandlers,
): CardState[] {
  container.textContent = '';
  const states: CardState[] = [];
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const { node, state } = renderCard(item, stats, opts, handlers);
    frag.appendChild(node);
    states.push(state);
  }
  container.appendChild(frag);
  return states;
}

export interface Summary {
  readonly items: number;
  readonly matched: number;
  readonly unmatched: number;
}

/** 统计条：以前是一句流水账，扫一眼看不出识别率 */
export function renderSummary(container: HTMLElement, s: Summary): void {
  container.textContent = '';
  const part = (className: string, n: number, label: string): HTMLElement => {
    const span = el('span', className);
    span.appendChild(el('strong', undefined, String(n)));
    span.append(` ${label}`);
    return span;
  };
  container.append(
    part('n-items', s.items, COPY.summary.items),
    el('span', 'sep', '|'),
    part('n-ok', s.matched, COPY.summary.matched),
    el('span', 'sep', '|'),
    part('n-bad', s.unmatched, COPY.summary.unmatched),
  );
  container.hidden = false;
}
