/**
 * 交易站查询的组装。
 *
 * 全是纯函数：输入是「一件装备 + 用户勾了哪几条、门槛填多少」，
 * 输出是查询对象和 URL。不碰 DOM，方便单测。
 * 格式细节见 docs/trade-api-notes.md。
 */

import { type ItemMod, isUniqueRarity } from './items.js';
import { type ModMatch } from './stats.js';

/** 交易站的挂单类型 */
export type TradeStatus = 'securable' | 'available' | 'onlineleague' | 'online' | 'any';

/** 数值门槛的方向：正数越大越好用 min，负数越负越好用 max */
export type Cmp = 'min' | 'max';

export function cmpFor(value: number | null): Cmp {
  return value !== null && value < 0 ? 'max' : 'min';
}

/**
 * 按容差算数值门槛。
 *
 * 整数向零取整，但**不塌成 0**：`+1 to Maximum Frenzy Charges` 乘 80% 是 0.8，
 * 取 0 的话这条筛选等于没写。小数（`0.8% 暴击`）保留两位，交易站吃得下小数。
 */
export function tolValue(value: number, tolerance: number): number {
  if (value === 0) return 0;
  const x = value * tolerance;
  if (Number.isInteger(value)) {
    return value > 0 ? Math.max(1, Math.floor(x)) : Math.min(-1, Math.ceil(x));
  }
  return Math.round(x * 100) / 100;
}

/**
 * 默认勾哪几条词条。
 *
 * 传奇一条不勾 —— 名字加底子已经够精确了，再筛数值只会把便宜的排除掉。
 * 其余按「词缀优先于植入」挑前 N 条：决定一件稀有装贵不贵的通常是词缀，
 * 按文本顺序取会让影响力植入把真正的词缀挤掉。
 */
export function autoSelect(
  mods: readonly ItemMod[],
  matches: readonly ModMatch[],
  maxMods: number,
  rarity: string,
): Set<number> {
  if (isUniqueRarity(rarity)) return new Set();
  const picked = mods
    .map((_, i) => i)
    .filter((i) => matches[i]?.id)
    .sort((a, b) => {
      const ia = mods[a]?.implicit ? 1 : 0;
      const ib = mods[b]?.implicit ? 1 : 0;
      return ia - ib || a - b;
    })
    .slice(0, maxMods);
  return new Set(picked);
}

/** 一行词条在界面上的当前状态 */
export interface FilterRow {
  readonly on: boolean;
  readonly id: string | null;
  readonly cmp: Cmp;
  /** 用户填的门槛，空着是 null */
  readonly value: number | null;
}

export interface QueryCard {
  readonly rarity: string;
  readonly name: string;
  readonly base: string;
  readonly baseUnknown: boolean;
  readonly rows: readonly FilterRow[];
}

export interface StatFilter {
  id: string;
  disabled: false;
  value?: { min: number } | { max: number };
}

export interface TradeQuery {
  query: {
    status: { option: TradeStatus };
    stats: [{ type: 'and'; filters: StatFilter[] }];
    name?: string;
    type?: string;
    filters?: { type_filters: { filters: { rarity: { option: string } } } };
  };
  sort: { price: 'asc' };
}

export function buildQuery(card: QueryCard, status: TradeStatus): TradeQuery {
  const filters: StatFilter[] = [];
  // 同一个 id 只能出现一次：星团珠宝的一条小点词缀在交易站是一条 stat、
  // 两行文本（陷阱伤害 + 地雷伤害），物品上是分开的两行，两行都会匹配到它。
  // 重复的筛选交易站会当成「要有两条这个词条」，直接搜不到东西。
  const seen = new Set<string>();
  for (const r of card.rows) {
    if (!r.on || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const f: StatFilter = { id: r.id, disabled: false };
    if (r.value !== null && Number.isFinite(r.value)) {
      f.value = r.cmp === 'max' ? { max: r.value } : { min: r.value };
    }
    filters.push(f);
  }

  const q: TradeQuery = {
    query: { status: { option: status }, stats: [{ type: 'and', filters }] },
    sort: { price: 'asc' },
  };

  if (isUniqueRarity(card.rarity)) {
    q.query.name = card.name;
    q.query.type = card.base;
  } else {
    // 底子没认出来就不写 type：搜得宽总好过搜出空结果
    if (!card.baseUnknown) q.query.type = card.base;
    q.query.filters = {
      type_filters: { filters: { rarity: { option: card.rarity === 'MAGIC' ? 'magic' : 'nonunique' } } },
    };
  }
  return q;
}

export const TRADE_BASE_URL = 'https://www.pathofexile.com/trade/search';

export function tradeUrl(league: string, q: TradeQuery): string {
  const lg = league.trim() || 'Standard';
  return `${TRADE_BASE_URL}/${encodeURIComponent(lg)}?q=${encodeURIComponent(JSON.stringify(q))}`;
}
