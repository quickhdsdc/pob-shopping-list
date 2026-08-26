/**
 * 从分享链接里取回 PoB 代码。
 *
 * 存在的理由：大多数人分享的是链接不是代码，而浏览器跨域读不到 pobb.in。
 * 这一步必须在服务端做。
 *
 * 安全上只做一件事但要做死：**只允许白名单里的域名**。
 * 一个能替调用方抓任意 URL 的端点就是一个 SSRF 跳板。
 */

import { decodePobCode } from '../src/core/pob.js';

export type ResolveFailure =
  /** 压根不是个 URL */
  | { readonly ok: false; readonly reason: 'bad-url' }
  /** 只收 https */
  | { readonly ok: false; readonly reason: 'not-https' }
  /** 认得这个站，但拿不到原始代码，让用户自己复制 */
  | { readonly ok: false; readonly reason: 'use-code-instead'; readonly host: string }
  /** 不认识的域名 */
  | { readonly ok: false; readonly reason: 'unsupported-host'; readonly host: string };

export type ResolveResult =
  | { readonly ok: true; readonly fetchUrl: string; readonly source: string }
  | ResolveFailure;

/** 能直接取到原始代码的站：给一个 URL，返回该抓哪个地址 */
const RESOLVERS: Record<string, (url: URL) => string | null> = {
  // pobb.in 的每个 build 都有一个 /raw，返回纯代码
  'pobb.in': (url) => {
    const id = url.pathname.replace(/^\/+/, '').replace(/\/raw\/?$/, '').replace(/\/+$/, '');
    return /^[A-Za-z0-9_-]+$/.test(id) ? `https://pobb.in/${id}/raw` : null;
  },
  // PoB 自己的导入也支持 pastebin
  'pastebin.com': (url) => {
    const id = url.pathname.replace(/^\/+/, '').replace(/^raw\//, '').replace(/\/+$/, '');
    return /^[A-Za-z0-9]+$/.test(id) ? `https://pastebin.com/raw/${id}` : null;
  },
};

/** 认得但取不到的站 —— 这些站界面上都有「复制代码」按钮，直接让用户用那个 */
const COPY_CODE_HOSTS = new Set(['poe.ninja', 'pob.cool', 'poeplanner.com', 'maxroll.gg']);

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function resolveImportUrl(raw: string): ResolveResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'bad-url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };

  const host = bareHost(url.hostname);
  const resolver = RESOLVERS[host];
  if (resolver) {
    const fetchUrl = resolver(url);
    return fetchUrl ? { ok: true, fetchUrl, source: host } : { ok: false, reason: 'bad-url' };
  }
  if (COPY_CODE_HOSTS.has(host)) return { ok: false, reason: 'use-code-instead', host };
  return { ok: false, reason: 'unsupported-host', host };
}

/** PoB 代码是 base64url，够长才可能是真的 */
const CODE_RUN = /[A-Za-z0-9_-]{200,}={0,2}/g;

/**
 * 从抓回来的响应里挑出可能是 PoB 代码的片段。
 *
 * 先试整个响应体（pobb.in/raw、pastebin/raw 都是纯代码），
 * 再从 HTML 里捞长 base64url 串当候选。顺序就是可信度顺序。
 */
export function extractCandidates(body: string): string[] {
  const out: string[] = [];
  const whole = body.trim();
  if (whole) out.push(whole);
  for (const m of body.matchAll(CODE_RUN)) {
    if (m[0] !== whole) out.push(m[0]);
    if (out.length > 12) break;
  }
  return out;
}

/**
 * 挑出真正解得开的那一个。
 *
 * 不靠「看着像 base64」判断 —— 直接解压出来看是不是 PoB 存档，
 * 这样返回给前端的一定是能用的代码。
 */
export async function findPobCode(body: string): Promise<string | null> {
  for (const candidate of extractCandidates(body)) {
    try {
      const xml = await decodePobCode(candidate);
      if (xml.includes('<PathOfBuilding')) return candidate;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}
