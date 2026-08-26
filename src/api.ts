/**
 * 跟自家 Worker 说话的那一层。
 *
 * 两个端点都是「有更好，没有也能用」：单文件离线版直接双击打开时
 * 根本没有服务器，这里统一降级 —— 赛季退回手填，链接导入退回提示粘贴代码。
 */

export interface League {
  readonly id: string;
  readonly current: boolean;
  readonly rules: readonly string[];
}

export interface LeaguesPayload {
  readonly leagues: readonly League[];
  readonly current: string;
}

/** 取不到就返回 null —— 调用方据此保持「赛季手填」的老行为 */
export async function fetchLeagues(): Promise<LeaguesPayload | null> {
  try {
    const res = await fetch('api/leagues');
    if (!res.ok) return null;
    const data = (await res.json()) as LeaguesPayload;
    if (!Array.isArray(data.leagues) || data.leagues.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

export class ImportError extends Error {}

/** 看起来像不像一个分享链接 —— 是的话就该走导入而不是当代码解 */
export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/**
 * 让 Worker 去把链接背后的 PoB 代码取回来。
 *
 * 失败时抛 ImportError，消息直接可以显示给用户 —— Worker 那边已经
 * 按站点给了具体建议（比如「poe.ninja 请用页面上的复制代码按钮」）。
 */
export async function importFromUrl(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`api/import?url=${encodeURIComponent(url.trim())}`);
  } catch {
    throw new ImportError('Link import needs the hosted version — paste the build code instead.');
  }

  let data: { code?: string; error?: string };
  try {
    data = (await res.json()) as { code?: string; error?: string };
  } catch {
    throw new ImportError(`Import failed (HTTP ${res.status}).`);
  }

  if (!res.ok || !data.code) {
    throw new ImportError(data.error ?? `Import failed (HTTP ${res.status}).`);
  }
  return data.code;
}
