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

  it('冠词当 1：an additional Curse ↔ # additional Curses', () => {
    // 物品上是「an additional Curse」（冠词 + 单数），交易站是
    // 「# additional Curses」（数字 + 复数），差了一个冠词和一个复数 s。
    const m = matchMod(idx, { line: 'You can apply an additional Curse', implicit: true });
    expect(m.id).toBe('implicit.stat_30642521');
    expect(m.value).toBe(1);
  });

  it('PoB 镜像缺的新词条，官方源里有', () => {
    // 这条曾经识别不了 —— 不是匹配逻辑的问题，是对照表当时从 PoB 的
    // TradeSiteStats.lua 提取，那份镜像过期了。现在直接从官方接口拉。
    const m = matchMod(idx, {
      line: 'While a Pinnacle Atlas Boss is in your Presence, 85% chance to Unnerve Enemies for 4 seconds on Hit',
      implicit: true,
    });
    expect(m.id).toBe('implicit.stat_4018420421');
    expect(m.value).toBe(85);
  });

  it('星团珠宝的小点词缀：带选项索引的 id', () => {
    // 这两条曾经标红说识别不了 —— 提取时把所有带 | 的 id 全跳过了。
    // 它们其实不需要任何额外交互：text 本身就是完整文本。
    const trap = matchMod(idx, {
      line: 'Added Small Passive Skills grant: 12% increased Trap Damage',
      implicit: true,
    });
    expect(trap.id).toBe('enchant.stat_3948993189|33');
    expect(trap.value).toBeNull();   // 数值烤进选项里了，没有门槛可调
  });

  it('多行 stat 的每一行都认得，且指向同一个 id', () => {
    // 一条小点词缀同时给陷阱和地雷伤害，交易站记成一条 stat、两行文本，
    // 物品文本里却是分开的两行
    const mine = matchMod(idx, {
      line: 'Added Small Passive Skills grant: 12% increased Mine Damage',
      implicit: true,
    });
    expect(mine.id).toBe('enchant.stat_3948993189|33');

    const axe = matchMod(idx, {
      line: 'Added Small Passive Skills grant: Axe Attacks deal 12% increased Damage with Hits and Ailments',
      implicit: true,
    });
    const sword = matchMod(idx, {
      line: 'Added Small Passive Skills grant: Sword Attacks deal 12% increased Damage with Hits and Ailments',
      implicit: true,
    });
    expect(axe.id).toBe(sword.id);
  });

  it('原文精确匹配排在归一化前面', () => {
    // 小点词缀里同一效果有多个数值版本，归一化之后是同一个键。
    // 先归一化就会挑错选项 —— 而挑错的 id 在交易站上一样不报错。
    const raw = 'Added Small Passive Skills grant: 10% increased Attack Damage';
    const m = matchMod(idx, { line: raw, implicit: true });
    const entry = idx.entries[idx.byRaw.get(raw)!]!;
    expect(m.id).toBe(`enchant.stat_${entry.hash}`);
  });

  it('对照表里带「#% chance to」前缀的，写死 100% 的那版认不出来', () => {
    // 已知缺口，不是回归：手套上的 `Curse Enemies with Punishment on Hit` 是
    // 必定触发版，对照表里只有 `#% chance to Curse Enemies with Punishment on Hit`。
    // 规范键带上了 chanceto 三个词，对不上。留个测试盯着，将来补上了这里会红。
    expect(matchMod(idx, { line: 'Curse Enemies with Punishment on Hit', implicit: true }).id).toBeNull();
  });
});

describe('命名空间', () => {
  const idx = stats();

  it('植入位置的词条，hash 有 implicit 就用 implicit', () => {
    expect(matchMod(idx, { line: '+134 to maximum Life', implicit: true }).id)
      .toBe('implicit.stat_3299347043');
  });

  it('植入位置但 hash 没有 implicit 时，退到 enchant', () => {
    // 交易站上这条真出过问题：星团珠宝的「Adds 5 Passive Skills」在物品文本的
    // Implicits: 区段里，按位置拼成 implicit.stat_3086156145 —— 这个 id 不存在，
    // 交易站显示 "Unavailable Stat" 而且不报错。它实际只有 explicit 和 enchant。
    const m = matchMod(idx, { line: 'Adds 5 Passive Skills', implicit: true });
    expect(m.id).toBe('enchant.stat_3086156145');
    expect(m.value).toBe(5);
  });

  it('词缀位置的同一条词条用 explicit', () => {
    expect(matchMod(idx, { line: 'Adds 5 Passive Skills', implicit: false }).id)
      .toBe('explicit.stat_3086156145');
  });

  it('只存在于 enchant 的词条，两种位置都给 enchant', () => {
    // 药剂附魔，之前整条被提取脚本过滤掉，根本匹配不上
    expect(matchMod(idx, { line: 'Used when Charges reach full', implicit: true }).id)
      .toBe('enchant.stat_3287581721');
    expect(matchMod(idx, { line: 'Used when Charges reach full', implicit: false }).id)
      .toBe('enchant.stat_3287581721');
  });

  it('生成的「命名空间.hash」组合在对照表里一定真实存在', () => {
    // 这才是要守的不变式：交易站认不认这个 id。
    // 不能拿遍历到的 entry 去比 —— 匹配可能经规范键或 (Local) 那条路
    // 命中另一条同义 entry，那是允许的。
    const known = new Map<string, Set<string>>();
    for (const e of idx.entries) {
      const set = known.get(e.hash) ?? new Set<string>();
      for (const ns of e.namespaces) set.add(ns);
      known.set(e.hash, set);
    }

    let checked = 0;
    for (const entry of idx.entries) {
      for (const implicit of [true, false]) {
        const id = matchMod(idx, { line: entry.text.replace(/#/g, '1'), implicit }).id;
        if (!id) continue;
        const [ns, stat] = id.split('.');
        expect(known.get(stat!.replace(/^stat_/, ''))).toContain(ns);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);   // 确认真的遍历过了
  });
});

describe('索引构建', () => {
  it('跳过残缺行', () => {
    const idx = buildStatIndex(
      '没有制表符\n\n+# to maximum Life\t3299347043\texplicit\n带空 hash 的\t\texplicit\n没有命名空间的\t123\t\n',
    );
    expect(idx.entries).toHaveLength(1);
  });

  it('同一个键撞上时保留先来的', () => {
    const idx = buildStatIndex('+# to X\taaa\texplicit\n+# to X\tbbb\texplicit\n');
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries[idx.byNorm.get('+# to X')!]!.hash).toBe('aaa');
  });

  it('命名空间列拆成数组', () => {
    const idx = buildStatIndex('+# to X\taaa\texplicit,enchant\n');
    expect(idx.entries[0]!.namespaces).toEqual(['explicit', 'enchant']);
  });
});
