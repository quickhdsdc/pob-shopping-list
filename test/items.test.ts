import { describe, expect, it } from 'vitest';

import { parseItemText } from '../src/core/items.js';
import { bases } from './helpers.js';

const B = bases();
const parse = (t: string) => parseItemText(t, B);

describe('物品文本解析', () => {
  it('稀有装备：第二行名字、第三行底子', () => {
    const item = parse(`Rarity: RARE
Cataclysm Claw
Slink Gloves
Item Level: 86
Implicits: 1
+16% to all Elemental Resistances
14% increased Attack Speed`)!;
    expect(item.name).toBe('Cataclysm Claw');
    expect(item.base).toBe('Slink Gloves');
    expect(item.baseUnknown).toBe(false);
    expect(item.mods).toEqual([
      { line: '+16% to all Elemental Resistances', implicit: true },
      { line: '14% increased Attack Speed', implicit: false },
    ]);
  });

  it('魔法装备：一行名字，底子要剥出来', () => {
    const item = parse(`Rarity: MAGIC
Flagellant's Quicksilver Flask of Incision
Item Level: 85
Implicits: 0
55% increased Movement Speed`)!;
    expect(item.name).toBe("Flagellant's Quicksilver Flask of Incision");
    expect(item.base).toBe('Quicksilver Flask');
    expect(item.baseUnknown).toBe(false);
  });

  it('底子剥不出来时标记出来，base 退回全名', () => {
    const item = parse(`Rarity: MAGIC
Whatever Nonexistent Doodad of Nothing
Implicits: 0
+1 to Something`)!;
    expect(item.baseUnknown).toBe(true);
    expect(item.base).toBe('Whatever Nonexistent Doodad of Nothing');
  });

  it('属性行和标记行不算词条', () => {
    const item = parse(`Rarity: RARE
X
Slink Gloves
Evasion: 334
EvasionBasePercentile: 1
Unique ID: abc
Shaper Item
Elder Item
Item Level: 86
Quality: 20
Sockets: R-G-R-B
LevelReq: 70
Implicits: 0
Corrupted
14% increased Attack Speed
Note: whatever`)!;
    expect(item.mods).toEqual([{ line: '14% increased Attack Speed', implicit: false }]);
  });

  it('植入边界按词条条数算，不按行号', () => {
    // Corrupted 夹在植入词条中间时，按行号算会把最后一条植入误判成词缀
    const item = parse(`Rarity: RARE
X
Slink Gloves
Implicits: 2
+16% to all Elemental Resistances
Corrupted
+1 to Maximum Frenzy Charges
14% increased Attack Speed`)!;
    expect(item.mods.map((m) => m.implicit)).toEqual([true, true, false]);
  });

  it('保留 {crafted} 前缀交给匹配层去剥', () => {
    const item = parse(`Rarity: RARE
X
Slink Gloves
Implicits: 0
{crafted}14% increased Attack Speed`)!;
    expect(item.mods[0]!.line).toBe('{crafted}14% increased Attack Speed');
  });

  it('没有 Rarity 行就不是物品', () => {
    expect(parse('随便什么文本')).toBeNull();
    expect(parse('')).toBeNull();
  });
});
