import { describe, expect, it } from 'vitest';

import { baseFromName, buildBaseIndex } from '../src/core/bases.js';
import { bases } from './helpers.js';

describe('底子还原', () => {
  const idx = bases();

  it('魔法装备的全名剥成底子', () => {
    // 这是曾经的 1 号 bug：直接拿全名当 type，交易站搜出空结果
    expect(baseFromName(idx, "Flagellant's Quicksilver Flask of Incision")).toBe('Quicksilver Flask');
    expect(baseFromName(idx, 'Stalwart Hypnotic Eye Jewel of Potency')).toBe('Hypnotic Eye Jewel');
    expect(baseFromName(idx, 'Stalwart Murderous Eye Jewel of the Assassin')).toBe('Murderous Eye Jewel');
  });

  it('本来就是底子的原样返回', () => {
    expect(baseFromName(idx, 'Slink Gloves')).toBe('Slink Gloves');
  });

  it('长底子优先于短底子', () => {
    expect(baseFromName(idx, 'Large Cluster Jewel')).toBe('Large Cluster Jewel');
    expect(baseFromName(idx, 'Fine Large Cluster Jewel of Potency')).toBe('Large Cluster Jewel');
  });

  it('认不出来返回 null，绝不硬猜', () => {
    expect(baseFromName(idx, 'Nonexistent Fictional Doodad')).toBeNull();
  });

  it('只按词边界匹配，不切词', () => {
    const small = buildBaseIndex('Ring\tRing\t\n');
    expect(baseFromName(small, 'Herring')).toBeNull();
    expect(baseFromName(small, 'Herring Ring')).toBe('Ring');
  });
});

describe('底子表构建', () => {
  it('跳过缺列的行，并按长度倒序', () => {
    const idx = buildBaseIndex('Cluster Jewel\tJewel\tCluster\n只有一列\nLarge Cluster Jewel\tJewel\tCluster\n');
    expect(idx.byName.size).toBe(2);
    expect(idx.byLengthDesc[0]!.name).toBe('Large Cluster Jewel');
  });
});
