/**
 * 赛季列表。
 *
 * 界面上的赛季以前是手填的 —— 赛季一换，整站生成的链接全部失效。
 * 这里从 GGG 的公开端点取，`category.current` 就是「当前挑战赛季」的权威标记。
 *
 * 那个端点按 IP 限流（X-Rate-Limit-Ip: 5:5:10,10:10:30,15:10:300），
 * 一个 Worker 上的所有用户共用出口 IP，所以**必须缓存**，一小时取一次绰绰有余。
 */

export const LEAGUES_API = 'https://www.pathofexile.com/api/leagues?type=main&realm=pc';

/** GGG 返回的字段远不止这些，只声明用得上的 */
export interface GggLeague {
  readonly id?: unknown;
  readonly category?: { readonly id?: unknown; readonly current?: unknown } | null;
  readonly rules?: readonly { readonly id?: unknown }[] | null;
}

export interface League {
  readonly id: string;
  /** 是不是当前挑战赛季（软核那条） */
  readonly current: boolean;
  /** Hardcore / NoParties / HardMode */
  readonly rules: string[];
}

export interface LeaguesPayload {
  readonly leagues: League[];
  /** 界面的默认赛季：当前挑战赛季的软核版，取不到就退回 Standard */
  readonly current: string;
}

export function toPayload(raw: unknown): LeaguesPayload {
  const list = Array.isArray(raw) ? (raw as GggLeague[]) : [];
  const leagues: League[] = [];

  for (const l of list) {
    if (typeof l?.id !== 'string' || !l.id) continue;
    const rules = Array.isArray(l.rules)
      ? l.rules.map((r) => r?.id).filter((id): id is string => typeof id === 'string')
      : [];
    leagues.push({ id: l.id, current: l.category?.current === true, rules });
  }

  // 当前赛季的软核版：category.current 为真、且没有任何 rules 的那一条。
  // Hardcore Allflame / HC SSF Allflame 的 category.current 也是真，靠 rules 区分。
  const current = leagues.find((l) => l.current && l.rules.length === 0)?.id ?? 'Standard';
  return { leagues, current };
}
