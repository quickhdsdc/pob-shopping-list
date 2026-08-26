/** PoB 物品文本（`<Item>` 节点里那段纯文本）的解析。 */

import { type BaseIndex, baseFromName } from './bases.js';

export interface ItemMod {
  /** 原始行，可能带 `{crafted}` 之类前缀 */
  readonly line: string;
  readonly implicit: boolean;
}

export interface ParsedItem {
  /** NORMAL / MAGIC / RARE / UNIQUE / RELIC */
  readonly rarity: string;
  readonly name: string;
  /** 交易站的 `type`。底子没认出来时退回全名，同时 baseUnknown 为 true */
  readonly base: string;
  /** true 表示 base 不可信，生成查询时不应写进 `type` */
  readonly baseUnknown: boolean;
  readonly mods: readonly ItemMod[];
}

export function isUniqueRarity(rarity: string): boolean {
  return rarity === 'UNIQUE' || rarity === 'RELIC';
}

/** 稀有和传奇是「第二行名字、第三行底子」，魔法和普通只有一行名字 */
function hasSeparateBaseLine(rarity: string): boolean {
  return rarity === 'RARE' || isUniqueRarity(rarity);
}

/** 这些行是属性/元数据，不是词条 */
const META =
  /^(Unique ID|Item Level|Quality|Sockets|LevelReq|Implicits|Armour|Evasion|Energy Shield|Ward|Intangibility|Catalyst|CatalystQuality|Radius|Limited to|Requires|Cluster Jewel|Talisman Tier|Prefix|Suffix|Note|Selected Variant|Variant|League|Source|Has \d+ Socket|.*BasePercentile)\s*:/i;

/** 这些独占一行的标记也不是词条 */
const FLAGS =
  /^(Corrupted|Mirrored|Split|Unidentified|Shaper Item|Elder Item|Warlord Item|Hunter Item|Redeemer Item|Crusader Item|Searing Exarch Item|Eater of Worlds Item|Fractured Item|Synthesised Item|Historic|Primordial|Foil Unique.*|Veiled.*)$/i;

export function parseItemText(text: string, bases: BaseIndex): ParsedItem | null {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return null;

  const rm = lines[0]?.match(/^Rarity:\s*(\w+)/i);
  if (!rm?.[1]) return null;
  const rarity = rm[1].toUpperCase();

  const twoLine = hasSeparateBaseLine(rarity);
  const name = lines[1] ?? '';

  let base: string;
  let baseUnknown: boolean;
  if (twoLine) {
    base = lines[2] ?? '';
    baseUnknown = base.length === 0;
  } else {
    const stripped = baseFromName(bases, name);
    base = stripped ?? name;
    baseUnknown = stripped === null;
  }

  const start = twoLine ? 3 : 2;

  // `Implicits: N` 之后的前 N 条词条是植入词条。这一行也是词条区的起点 ——
  // 在它之前的全是属性行。
  let implicitCount = 0;
  let implicitAt = -1;
  for (let i = start; i < lines.length; i++) {
    const m = lines[i]?.match(/^Implicits:\s*(\d+)/i);
    if (m?.[1]) {
      implicitCount = parseInt(m[1], 10);
      implicitAt = i;
      break;
    }
  }

  const mods: ItemMod[] = [];
  if (implicitAt >= 0) {
    // 用「已收下的词条数」而不是行号来判断植入边界：中间夹着的
    // Corrupted / Note: 之类的行会被跳过，拿行号算边界会算偏。
    for (let i = implicitAt + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || META.test(line) || FLAGS.test(line)) continue;
      mods.push({ line, implicit: mods.length < implicitCount });
    }
  }

  return { rarity, name, base, baseUnknown, mods };
}
