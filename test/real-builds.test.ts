// @vitest-environment jsdom
/**
 * 拿真实 build 跑一遍全流程。
 *
 * test/ 下每多一个 .pobcode 文件，这里就自动多跑一套 —— 收到新 build 直接丢进去。
 * 断言刻意写得宽松：这里防的是「换一套 build 就崩」，不是钉死某个具体数字。
 * 精确的行为断言在 build.test.ts 里针对固定样例做。
 */
import { describe, expect, it } from 'vitest';

import { isUniqueRarity } from '../src/core/items.js';
import { parseBuild } from '../src/core/build.js';
import { autoSelect, buildQuery, cmpFor, type QueryCard, tolValue, tradeUrl } from '../src/core/query.js';
import { matchMod } from '../src/core/stats.js';
import { bases, realBuilds, stats, xmlFromCode } from './helpers.js';

const B = bases();
const S = stats();

describe.each(realBuilds())('真实 build: $name', ({ code }) => {
  const xml = xmlFromCode(code);
  const items = parseBuild(xml, B);

  it('解得开，而且是 PoB 存档', () => {
    expect(xml).toContain('<PathOfBuilding');
  });

  it('解析出装备', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('每件装备都有底子和稀有度', () => {
    for (const item of items) {
      expect(item.rarity).toMatch(/^[A-Z]+$/);
      expect(item.base.length).toBeGreaterThan(0);
    }
  });

  it('稀有/魔法装备的识别率不低于 95%', () => {
    let total = 0;
    let unmatched = 0;
    for (const item of items) {
      if (isUniqueRarity(item.rarity)) continue;
      for (const m of item.mods) {
        total++;
        if (!matchMod(S, m).id) unmatched++;
      }
    }
    if (total === 0) return; // 全传奇的 build，没什么可算的
    // 剩下的缺口是交易站的 stat 列表里确实没有对应文本的那几条，
    // 比如必定触发版的 Curse Enemies with Punishment on Hit（列表里只有
    // 「#% chance to」那版，是另一个词条）。不是匹配缺陷。
    expect((1 - unmatched / total) * 100).toBeGreaterThanOrEqual(95);
  });

  describe('生成的查询', () => {
    const cards: QueryCard[] = items.map((item) => {
      const matches = item.mods.map((m) => matchMod(S, m));
      const auto = autoSelect(item.mods, matches, 4, item.rarity);
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
            value: m.value === null ? null : tolValue(m.value, 0.8),
          };
        }),
      };
    });

    it('每件装备都生成得出链接', () => {
      const urls = cards.map((c) => tradeUrl('Allflame', buildQuery(c, 'securable')));
      expect(urls).toHaveLength(items.length);
      expect(urls.every((u) => u.startsWith('https://www.pathofexile.com/trade/search/'))).toBe(true);
    });

    it('没有一件装备的 type 是交易站不存在的底子', () => {
      const bad = cards
        .map((c) => buildQuery(c, 'securable').query.type)
        .filter((t): t is string => !!t && !B.byName.has(t));
      expect(bad).toEqual([]);
    });

    it('没有一条筛选的数值塌成 0', () => {
      for (const c of cards) {
        for (const f of buildQuery(c, 'securable').query.stats[0].filters) {
          expect(f.value).not.toEqual({ min: 0 });
        }
      }
    });

    it('URL 不会长到浏览器吃不下', () => {
      // 实测 Chrome 地址栏上限约 32 KB
      for (const c of cards) {
        expect(tradeUrl('Allflame', buildQuery(c, 'securable')).length).toBeLessThan(32_000);
      }
    });
  });
});
