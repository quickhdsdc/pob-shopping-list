/**
 * 界面层：把解析好的装备渲染成卡片，并维护「勾了哪几条、门槛填多少」的状态。
 *
 * 所有查询逻辑都在 core/ 里，这里只负责 DOM 和状态。
 */

import { isUniqueRarity } from './core/items.js';
import { type BuildItem, type Slot } from './core/build.js';
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
      return `天赋树珠宝 ${slot.nodeId}`;
    case 'unequipped':
      return '（未装备）';
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

function badge(text: string): HTMLSpanElement {
  return el('span', 'badge', text);
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

  const card = el('div', 'card');

  const head = el('div', 'chead');
  const left = el('div');
  left.appendChild(el('div', 'slot', formatSlot(item.slot)));
  left.appendChild(el('div', `iname r-${item.rarity}`, item.name));
  if (item.base && item.base !== item.name) {
    left.appendChild(el('div', 'ibase', item.base));
  }
  if (item.baseUnknown) {
    left.appendChild(
      el('div', 'ibase warn', '底子没认出来，搜索不限定底子（可能是新赛季底子，对照表该更新了）'),
    );
  }
  head.appendChild(left);

  const acts = el('div', 'acts');
  const searchBtn = el('button', undefined, '官网搜索');
  const copyBtn = el('button', 'sec', '复制');
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
      if (mod.implicit) tdText.appendChild(badge('植入'));
      if (!match.id) {
        tdText.classList.add('nomatch');
        tdText.appendChild(badge('未识别'));
      }
      tr.appendChild(tdText);

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

  card.appendChild(
    el(
      'p',
      'hint',
      isUnique
        ? '传奇按名字+底子精确搜索，词条默认不勾（勾上可再筛数值范围）'
        : `默认勾选 ${opts.maxMods} 条（词缀优先于植入），数值已按容差自动填。勾选和数值都可以改。`,
    ),
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
