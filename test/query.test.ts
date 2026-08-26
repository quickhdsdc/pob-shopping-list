import { describe, expect, it } from 'vitest';

import { type ItemMod } from '../src/core/items.js';
import { type ModMatch } from '../src/core/stats.js';
import { autoSelect, buildQuery, cmpFor, type QueryCard, tolValue, tradeUrl } from '../src/core/query.js';

describe('容差取值', () => {
  it('正数向下取整', () => {
    expect(tolValue(134, 0.8)).toBe(107);
    expect(tolValue(17.5, 0.8)).toBe(14);
  });

  it('不把小数值塌成 0', () => {
    // 这是曾经的 2 号 bug：+1 最大狂怒球 × 80% = 0.8，取 0 之后筛选形同虚设
    expect(tolValue(1, 0.8)).toBe(1);
    expect(tolValue(2, 0.1)).toBe(1);
  });

  it('小数保留两位', () => {
    expect(tolValue(0.8, 0.8)).toBe(0.64);
    expect(tolValue(3.5, 0.8)).toBe(2.8);
  });

  it('负数向零取整，也不塌成 0', () => {
    expect(tolValue(-13, 0.8)).toBe(-10);
    expect(tolValue(-1, 0.8)).toBe(-1);
  });

  it('0 就是 0', () => {
    expect(tolValue(0, 0.8)).toBe(0);
  });
});

describe('门槛方向', () => {
  it('负数词条越负越好，用上限', () => {
    // 这是曾经的 3 号 bug：一律写 min，负数词条方向反了
    expect(cmpFor(-13)).toBe('max');
    expect(cmpFor(134)).toBe('min');
    expect(cmpFor(null)).toBe('min');
  });

  it('生成的查询用对应的 min / max', () => {
    const card: QueryCard = {
      rarity: 'RARE', name: 'X', base: 'Slink Gloves', baseUnknown: false,
      rows: [
        { on: true, id: 'explicit.stat_a', cmp: 'min', value: 107 },
        { on: true, id: 'explicit.stat_b', cmp: 'max', value: -10 },
      ],
    };
    const f = buildQuery(card, 'securable').query.stats[0].filters;
    expect(f[0]!.value).toEqual({ min: 107 });
    expect(f[1]!.value).toEqual({ max: -10 });
  });
});

describe('默认勾选', () => {
  const mod = (implicit: boolean): ItemMod => ({ line: 'x', implicit });
  const hit = (id: string | null): ModMatch => ({ id, value: 1 });

  it('词缀优先于植入', () => {
    // 这是曾经的 4 号 bug：按文本顺序取，影响力植入把真正的词缀挤掉了
    const mods = [mod(true), mod(true), mod(false), mod(false)];
    const ms = [hit('a'), hit('b'), hit('c'), hit('d')];
    expect([...autoSelect(mods, ms, 2, 'RARE')].sort()).toEqual([2, 3]);
  });

  it('词缀不够时才补植入', () => {
    const mods = [mod(true), mod(false)];
    const ms = [hit('a'), hit('b')];
    expect([...autoSelect(mods, ms, 4, 'RARE')].sort()).toEqual([0, 1]);
  });

  it('跳过没匹配上的词条', () => {
    const mods = [mod(false), mod(false)];
    const ms = [hit(null), hit('b')];
    expect([...autoSelect(mods, ms, 4, 'RARE')]).toEqual([1]);
  });

  it('传奇一条都不勾', () => {
    const mods = [mod(false), mod(false)];
    const ms = [hit('a'), hit('b')];
    expect(autoSelect(mods, ms, 4, 'UNIQUE').size).toBe(0);
    expect(autoSelect(mods, ms, 4, 'RELIC').size).toBe(0);
  });
});

describe('查询组装', () => {
  const base = { name: 'Spinesnatch', base: 'Fleshripper', baseUnknown: false, rows: [] };

  it('传奇按名字 + 底子', () => {
    const q = buildQuery({ ...base, rarity: 'UNIQUE' }, 'securable').query;
    expect(q.name).toBe('Spinesnatch');
    expect(q.type).toBe('Fleshripper');
    expect(q.filters).toBeUndefined();
  });

  it('稀有不写名字，限定 nonunique', () => {
    const q = buildQuery({ ...base, rarity: 'RARE' }, 'securable').query;
    expect(q.name).toBeUndefined();
    expect(q.filters!.type_filters.filters.rarity.option).toBe('nonunique');
  });

  it('魔法限定 magic', () => {
    const q = buildQuery({ ...base, rarity: 'MAGIC' }, 'securable').query;
    expect(q.filters!.type_filters.filters.rarity.option).toBe('magic');
  });

  it('底子认不出来时干脆不写 type', () => {
    const q = buildQuery({ ...base, rarity: 'MAGIC', baseUnknown: true }, 'securable').query;
    expect(q.type).toBeUndefined();
  });

  it('同一个 id 只出现一次', () => {
    // 星团珠宝的一条小点词缀在交易站是一条 stat、两行文本，物品上是分开的
    // 两行，两行都会匹配到它。重复的筛选交易站会当成「要有两条这个词条」，
    // 直接搜不到东西。
    const card: QueryCard = {
      ...base, rarity: 'RARE',
      rows: [
        { on: true, id: 'enchant.stat_3948993189|1', cmp: 'min', value: null },
        { on: true, id: 'enchant.stat_3948993189|1', cmp: 'min', value: null },
        { on: true, id: 'explicit.stat_other', cmp: 'min', value: 5 },
      ],
    };
    const f = buildQuery(card, 'securable').query.stats[0].filters;
    expect(f.map((x) => x.id)).toEqual(['enchant.stat_3948993189|1', 'explicit.stat_other']);
  });

  it('没勾的行和没匹配上的行都不进筛选', () => {
    const card: QueryCard = {
      ...base, rarity: 'RARE',
      rows: [
        { on: false, id: 'explicit.stat_a', cmp: 'min', value: 1 },
        { on: true, id: null, cmp: 'min', value: 1 },
        { on: true, id: 'explicit.stat_c', cmp: 'min', value: null },
      ],
    };
    const f = buildQuery(card, 'securable').query.stats[0].filters;
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({ id: 'explicit.stat_c', disabled: false });   // 无数值词条不带 value
  });
});

describe('URL', () => {
  it('赛季进路径，查询进 q 参数', () => {
    const q = buildQuery({ rarity: 'RARE', name: 'x', base: 'Slink Gloves', baseUnknown: false, rows: [] }, 'securable');
    const url = tradeUrl('Allflame', q);
    expect(url.startsWith('https://www.pathofexile.com/trade/search/Allflame?q=')).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split('?q=')[1]!))).toEqual(q);
  });

  it('赛季名要转义', () => {
    expect(tradeUrl('Hardcore Allflame', buildQuery({ rarity: 'RARE', name: 'x', base: 'y', baseUnknown: false, rows: [] }, 'any')))
      .toContain('/search/Hardcore%20Allflame?');
  });

  it('赛季空着退回 Standard', () => {
    expect(tradeUrl('   ', buildQuery({ rarity: 'RARE', name: 'x', base: 'y', baseUnknown: false, rows: [] }, 'any')))
      .toContain('/search/Standard?');
  });
});
