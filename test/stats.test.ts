import { describe, expect, it } from 'vitest';

import {
  buildStatIndex,
  canonicalKey,
  extractValues,
  matchMod,
  normalizeNumbers,
  stripTag,
} from '../src/core/stats.js';
import { stats } from './helpers.js';

describe('文本规范化', () => {
  it('把数字换成 #', () => {
    expect(normalizeNumbers('+134 to maximum Life')).toBe('+# to maximum Life');
    expect(normalizeNumbers('Adds 12 to 20 Physical Damage')).toBe('Adds # to # Physical Damage');
  });

  it('规范键只留小写字母', () => {
    expect(canonicalKey('8% chance to gain Phasing for 4 seconds on Kill'))
      .toBe(canonicalKey('12% chance to gain Phasing for 3 seconds on Kill'));
  });

  it('剥掉 PoB 的花括号标记', () => {
    expect(stripTag('{crafted}+20 to maximum Life')).toBe('+20 to maximum Life');
    expect(stripTag('{fractured}{crafted}x')).toBe('{crafted}x');   // 只剥一层
    expect(stripTag('+20 to maximum Life')).toBe('+20 to maximum Life');
  });
});

describe('按位置取值', () => {
  it('只取对照表里写成 # 的那些位置', () => {
    // 这条如果按「抓出所有数字」处理，8 和 4 会被混为一谈
    const vals = extractValues(
      '#% chance to gain Phasing for 4 seconds on Kill',
      '8% chance to gain Phasing for 4 seconds on Kill',
    );
    expect(vals).toEqual([8]);
  });

  it('反推不出来时退回抓所有数字', () => {
    expect(extractValues('完全对不上的文本', '+134 to maximum Life')).toEqual([134]);
  });

  it('认得负数', () => {
    expect(extractValues('# to Total Mana Cost of Skills', '-13 to Total Mana Cost of Skills'))
      .toEqual([-13]);
  });
});

describe('对照表匹配', () => {
  const idx = stats();

  it('第 1 级：数字归一化后精确匹配', () => {
    const m = matchMod(idx, { line: '+134 to maximum Life', implicit: false });
    expect(m.id).toBe('explicit.stat_3299347043');
    expect(m.value).toBe(134);
  });

  it('植入词条换前缀，hash 不变', () => {
    const e = matchMod(idx, { line: '+134 to maximum Life', implicit: false });
    const i = matchMod(idx, { line: '+134 to maximum Life', implicit: true });
    expect(i.id).toBe('implicit.stat_3299347043');
    expect(e.id!.split('stat_')[1]).toBe(i.id!.split('stat_')[1]);
  });

  it('Adds A to B 取平均 —— 交易站也是这么算的', () => {
    const m = matchMod(idx, { line: 'Adds 10 to 20 Physical Damage', implicit: false });
    expect(m.value).toBe(15);
  });

  it('单复数容错', () => {
    expect(matchMod(idx, { line: 'Has 1 Abyssal Socket', implicit: false }).id).toBeTruthy();
  });

  it('匹配不上时不瞎猜', () => {
    const m = matchMod(idx, { line: 'Totally Not A Real Mod At All', implicit: false });
    expect(m).toEqual({ id: null, value: null });
  });

  it('无数值词条给出 id 但没有数值', () => {
    const m = matchMod(idx, { line: 'Can be modified while Corrupted', implicit: true });
    expect(m.id).toBe('implicit.stat_1161337167');
    expect(m.value).toBeNull();
  });

  it('本地词条：物品文本不带 (Local)，对照表带', () => {
    // 交易站用 (Local) 后缀区分护甲上的「增加护甲」和天赋树上的同名词条
    const m = matchMod(idx, { line: '63% increased Armour and Evasion', implicit: false });
    expect(m.id).toBe('explicit.stat_2451402625');
    expect(m.value).toBe(63);   // 取值时 (Local) 后缀要摘掉，否则反推正则对不上
  });

  it('reduced 翻译成 increased 的负值', () => {
    // 交易站没有「#% reduced Amount Recovered」，只有 increased 的负值版
    const m = matchMod(idx, { line: '66% reduced Amount Recovered', implicit: false });
    expect(m.id).toBe('explicit.stat_700317374');
    expect(m.value).toBe(-66);
  });

  it('less 翻译成 more 的负值', () => {
    const m = matchMod(idx, { line: '38% less Duration', implicit: false });
    expect(m.value).toBeLessThan(0);
  });

  it('对照表里本来就有的 reduced 词条，不会被翻译抢走', () => {
    // 对照表里有一百多条带 reduced 的词条，极性翻译只能在直接查不到时兜底
    const m = matchMod(idx, { line: '10% reduced Mana Cost of Skills', implicit: false });
    expect(m.value).toBe(10);   // 正值 —— 说明走的是直接匹配，没被翻译成 -10
  });

  it('对照表里带「#% chance to」前缀的，写死 100% 的那版认不出来', () => {
    // 已知缺口，不是回归：手套上的 `Curse Enemies with Punishment on Hit` 是
    // 必定触发版，对照表里只有 `#% chance to Curse Enemies with Punishment on Hit`。
    // 规范键带上了 chanceto 三个词，对不上。留个测试盯着，将来补上了这里会红。
    expect(matchMod(idx, { line: 'Curse Enemies with Punishment on Hit', implicit: true }).id).toBeNull();
  });
});

describe('索引构建', () => {
  it('跳过残缺行', () => {
    const idx = buildStatIndex('没有制表符\n\n+# to maximum Life\t3299347043\n带空 hash 的\t\n');
    expect(idx.entries).toHaveLength(1);
  });

  it('同一个键撞上时保留先来的', () => {
    const idx = buildStatIndex('+# to X\taaa\n+# to X\tbbb\n');
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries[idx.byNorm.get('+# to X')!]!.hash).toBe('aaa');
  });
});
