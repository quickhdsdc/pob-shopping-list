/**
 * 底子物品表。
 *
 * 存在的理由：魔法装备在 PoB 里只有一行名字 ——
 * `Flagellant's Quicksilver Flask of Incision` —— 而交易站的 `type`
 * 只认底子本身（`Quicksilver Flask`）。直接拿全名当底子会搜出空结果。
 */

export interface BaseItem {
  readonly name: string;
  /** PoB 的大类：Flask / Jewel / Gloves / One Handed Sword … */
  readonly type: string;
  /** PoB 的小类：Utility / Abyss / Cluster / Evasion …，可能为空 */
  readonly sub: string;
}

export interface BaseIndex {
  readonly byName: ReadonlyMap<string, BaseItem>;
  /** 按名字长度倒序，`Large Cluster Jewel` 必须先于 `Cluster Jewel` 被试到 */
  readonly byLengthDesc: readonly BaseItem[];
}

export function buildBaseIndex(tsv: string): BaseIndex {
  const byName = new Map<string, BaseItem>();
  const all: BaseItem[] = [];
  for (const line of tsv.split('\n')) {
    const p = line.split('\t');
    const name = p[0]?.trim();
    const type = p[1]?.trim();
    if (!name || !type) continue;
    if (byName.has(name)) continue;
    const item: BaseItem = { name, type, sub: p[2]?.trim() ?? '' };
    byName.set(name, item);
    all.push(item);
  }
  all.sort((a, b) => b.name.length - a.name.length);
  return { byName, byLengthDesc: all };
}

/**
 * 从魔法装备的全名里剥出底子。
 *
 * 从长到短找第一个**按词边界**命中的底子名。找不到返回 null ——
 * 调用方应当据此不写 `type`，搜得宽总好过搜出空结果。
 */
export function baseFromName(index: BaseIndex, name: string): string | null {
  const trimmed = name.trim();
  if (index.byName.has(trimmed)) return trimmed;
  for (const b of index.byLengthDesc) {
    const i = trimmed.indexOf(b.name);
    if (i < 0) continue;
    const okLeft = i === 0 || trimmed[i - 1] === ' ';
    const end = i + b.name.length;
    const okRight = end === trimmed.length || trimmed[end] === ' ';
    if (okLeft && okRight) return b.name;
  }
  return null;
}
