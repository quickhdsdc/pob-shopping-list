/**
 * Cloudflare Worker：静态站点 + 两个只读端点。
 *
 *   GET /api/leagues          当前赛季列表（缓存 1 小时）
 *   GET /api/import?url=...   从分享链接取回 PoB 代码（缓存 10 分钟）
 *
 * 刻意**不碰** GGG 的 trade API —— 不估价、不代查、不需要 OAuth，
 * 因此没有限流队列和合规负担。见 README 的「已知限制」。
 *
 * 其余路径交给 Static Assets（wrangler.jsonc 里的 assets 配置）。
 */

import { findPobCode, resolveImportUrl } from './import.js';
import { LEAGUES_API, type LeaguesPayload, toPayload } from './leagues.js';

/** GGG 的 API 政策要求带一个能认出是谁的 User-Agent */
const USER_AGENT =
  'poe-shopping-list/0.2 (+https://poe-shopping-list.pob-shopping-list.workers.dev)';

const LEAGUES_TTL = 3600;
const IMPORT_TTL = 600;

/** 抓回来的东西最多读这么多，防止有人拿个大文件把 Worker 撑爆 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400',
} as const;

function json(body: unknown, init: { status?: number; ttl?: number } = {}): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    ...CORS,
  };
  if (init.ttl) headers['cache-control'] = `public, max-age=${init.ttl}`;
  else headers['cache-control'] = 'no-store';
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, { status });
}

async function upstream(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** 读响应体，超过上限就截断 —— 不信任 content-length */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function handleLeagues(): Promise<Response> {
  let res: Response;
  try {
    res = await upstream(LEAGUES_API);
  } catch {
    return fail(502, '连不上官网的赛季接口');
  }
  if (!res.ok) {
    // 429 原样透出去，让前端知道是被限流而不是坏了
    return fail(res.status === 429 ? 429 : 502, `官网赛季接口返回 ${res.status}`);
  }

  let payload: LeaguesPayload;
  try {
    payload = toPayload(await res.json());
  } catch {
    return fail(502, '官网赛季接口返回的不是预期格式');
  }
  if (payload.leagues.length === 0) return fail(502, '官网赛季接口返回了空列表');

  return json(payload, { ttl: LEAGUES_TTL });
}

const IMPORT_ERRORS: Record<string, string> = {
  'bad-url': '这不是一个能识别的分享链接',
  'not-https': '只支持 https 链接',
  'unsupported-host': '不认识这个站点，请直接粘贴 PoB 代码',
};

async function handleImport(url: URL): Promise<Response> {
  const target = url.searchParams.get('url');
  if (!target) return fail(400, '缺少 url 参数');

  const resolved = resolveImportUrl(target);
  if (!resolved.ok) {
    if (resolved.reason === 'use-code-instead') {
      return fail(400, `${resolved.host} 取不到原始代码，请用它页面上的「复制代码」按钮`, {
        reason: resolved.reason,
        host: resolved.host,
      });
    }
    return fail(400, IMPORT_ERRORS[resolved.reason] ?? '无法识别的链接', {
      reason: resolved.reason,
    });
  }

  let res: Response;
  try {
    res = await upstream(resolved.fetchUrl);
  } catch {
    return fail(502, `连不上 ${resolved.source}`);
  }
  if (!res.ok) return fail(res.status === 404 ? 404 : 502, `${resolved.source} 返回 ${res.status}`);

  const code = await findPobCode(await readCapped(res));
  if (!code) return fail(422, `从 ${resolved.source} 取回的内容里没找到 PoB 代码`);

  return json({ code, source: resolved.source }, { ttl: IMPORT_TTL });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    // HEAD 跟 GET 走同一条路 —— 浏览器、监控探针和各种代理都会发 HEAD，
    // 运行时会自己把响应体去掉。
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, '只支持 GET');
    }

    // 边缘缓存：赛季接口有 IP 限流，同一个 Worker 上所有用户共用出口 IP，
    // 不缓存的话稍微有点量就会被 429。
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let response: Response;
    if (url.pathname === '/api/leagues') response = await handleLeagues();
    else if (url.pathname === '/api/import') response = await handleImport(url);
    else return fail(404, '没有这个端点');

    if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
