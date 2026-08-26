/**
 * build XML -> 装备清单。
 *
 * 需要 DOMParser，所以只能跑在浏览器里（测试用 jsdom）。
 * 不带 DOM 的解码部分在 core/pob.ts。
 */

import { type BaseIndex } from './bases.js';
import { type ParsedItem, parseItemText } from './items.js';
import { PobError } from './pob.js';

export type Slot =
  /** PoB 的槽位名原文：Weapon 1 / Body Armour / Helmet Abyssal Socket 1 … */
  | { readonly kind: 'equipment'; readonly name: string }
  /** 天赋树上的珠宝孔 */
  | { readonly kind: 'tree-jewel'; readonly nodeId: string }
  /** 在物品栏里但没装上 */
  | { readonly kind: 'unequipped' };

export interface BuildItem extends ParsedItem {
  readonly slot: Slot;
}

/** 已装备的常规槽位，按人看着顺眼的顺序排 */
const SLOT_ORDER = [
  'Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots',
  'Amulet', 'Ring 1', 'Ring 2', 'Belt',
  'Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5',
  'Weapon 1 Swap', 'Weapon 2 Swap',
] as const;

export function slotRank(slot: Slot): number {
  if (slot.kind === 'unequipped') return 900;
  if (slot.kind === 'tree-jewel') return 700;
  const i = SLOT_ORDER.indexOf(slot.name as (typeof SLOT_ORDER)[number]);
  if (i >= 0) return i;
  if (/Abyssal Socket/.test(slot.name)) return 500;   // 装备上的深渊插槽
  return 600;                                          // 没见过的槽位名
}

/** 从 build XML 里取出所有物品，按槽位排序。 */
export function parseBuild(xml: string, bases: BaseIndex): BuildItem[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    throw new PobError('bad-xml');
  }
  if (doc.querySelector('parsererror')) throw new PobError('bad-xml');

  const slotOf = new Map<string, Slot>();
  for (const s of doc.querySelectorAll('ItemSet Slot')) {
    const id = s.getAttribute('itemId');
    const name = s.getAttribute('name');
    if (id && id !== '0' && name) slotOf.set(id, { kind: 'equipment', name });
  }
  for (const s of doc.querySelectorAll('Sockets Socket')) {
    const id = s.getAttribute('itemId');
    const nodeId = s.getAttribute('nodeId');
    if (id && id !== '0' && nodeId && !slotOf.has(id)) {
      slotOf.set(id, { kind: 'tree-jewel', nodeId });
    }
  }

  const items: BuildItem[] = [];
  for (const node of doc.querySelectorAll('Items > Item')) {
    const parsed = parseItemText(node.textContent ?? '', bases);
    if (!parsed) continue;
    const id = node.getAttribute('id');
    items.push({ ...parsed, slot: (id && slotOf.get(id)) || { kind: 'unequipped' } });
  }

  if (items.length === 0) throw new PobError('no-items');
  items.sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
  return items;
}
