// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { isUniqueRarity } from '../src/core/items.js';
import { parseBuild, slotRank } from '../src/core/build.js';
import { PobError } from '../src/core/pob.js';
import { autoSelect, buildQuery, cmpFor, type QueryCard, tolValue, tradeUrl } from '../src/core/query.js';
import { matchMod } from '../src/core/stats.js';
import { bases, sampleXml, stats } from './helpers.js';

const B = bases();
const S = stats();
const items = parseBuild(sampleXml(), B);

describe('样例 build 的整体解析', () => {
  it('44 件装备', () => {
    expect(items).toHaveLength(44);
  });

  it('已装备的排在未装备的前面', () => {
    const ranks = items.map((i) => slotRank(i.slot));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('稀有/魔法装备的识别率不低于 88%', () => {
    let total = 0;
    let unmatched = 0;
    for (const item of items) {
      if (isUniqueRarity(item.rarity)) continue; // 传奇按名字搜，词条识别与否不影响
      for (const m of item.mods) {
        total++;
        if (!matchMod(S, m).id) unmatched++;
      }
    }
    // 149 而不是老的无头测试报的 154：那个测试靠 CSS 类名首字母判断稀有度，
    // RELIC 和 RARE 都是 'R'，把那件遗物药剂（Dying Sun，5 条词条）算成了稀有装备。
    expect(total).toBe(149);
    expect((1 - unmatched / total) * 100).toBeGreaterThanOrEqual(88);
  });

  it('空 XML 抛 no-items', () => {
    expect(() => parseBuild('<PathOfBuilding></PathOfBuilding>', B)).toThrow(PobError);
  });
});

/** 照界面的默认行为把一件装备变成一张查询卡 */
function toCard(item: (typeof items)[number], tol = 0.8, maxMods = 4): QueryCard {
  const matches = item.mods.map((m) => matchMod(S, m));
  const auto = autoSelect(item.mods, matches, maxMods, item.rarity);
  return {
    rarity: item.rarity,
    name: item.name,
    base: item.base,
    baseUnknown: item.baseUnknown,
    rows: item.mods.map((_, i) => {
      const m = matches[i]!;
      return {
        on: auto.has(i),
        id: m.id,
        cmp: cmpFor(m.value),
        value: m.value === null ? null : tolValue(m.value, tol),
      };
    }),
  };
}

describe('每件装备都生成得出可用的查询', () => {
  const cards = items.map((item) => toCard(item));

  it('44 条链接', () => {
    const urls = cards.map((c) => tradeUrl('Allflame', buildQuery(c, 'securable')));
    expect(urls).toHaveLength(44);
    expect(urls.every((u) => u.startsWith('https://www.pathofexile.com/trade/search/Allflame?q='))).toBe(true);
  });

  it('没有一件装备的 type 是交易站不存在的底子', () => {
    // 回归 1 号 bug：魔法装备的全名当底子，13 件药剂和珠宝全搜出空结果
    const bad = cards
      .map((c) => buildQuery(c, 'securable').query.type)
      .filter((t): t is string => !!t && !B.byName.has(t));
    expect(bad).toEqual([]);
  });

  it('魔法装备确实剥出了底子', () => {
    const magic = cards.filter((c) => c.rarity === 'MAGIC');
    expect(magic.length).toBeGreaterThan(0);
    expect(magic.every((c) => !c.baseUnknown)).toBe(true);
  });

  it('没有一条筛选的数值塌成 0', () => {
    // 回归 2 号 bug：min: 0 等于没筛
    for (const c of cards) {
      for (const f of buildQuery(c, 'securable').query.stats[0].filters) {
        expect(f.value).not.toEqual({ min: 0 });
      }
    }
  });

  it('没有一件非传奇装备只勾中了植入词条', () => {
    // 回归 3 号 bug：按文本顺序取前 4 条，影响力植入把词缀全挤掉了
    for (const [i, c] of cards.entries()) {
      if (isUniqueRarity(c.rarity)) continue;
      const on = c.rows.map((r, j) => [r, items[i]!.mods[j]!] as const).filter(([r]) => r.on);
      if (on.length === 0) continue;
      expect(on.some(([, m]) => !m.implicit)).toBe(true);
    }
  });

  it('传奇一条词条都不勾', () => {
    for (const c of cards) {
      if (!isUniqueRarity(c.rarity)) continue;
      expect(c.rows.every((r) => !r.on)).toBe(true);
      expect(buildQuery(c, 'securable').query.name).toBe(c.name);
    }
  });

  it('那件 Cataclysm Claw 勾的是词缀不是植入', () => {
    const card = cards.find((c) => c.name === 'Cataclysm Claw')!;
    const q = buildQuery(card, 'securable').query;
    expect(q.type).toBe('Slink Gloves');
    expect(q.stats[0].filters).toHaveLength(4);
    expect(q.stats[0].filters.every((f) => f.id.startsWith('explicit.'))).toBe(true);
  });
});
