/**
 * 两张对照表的加载。
 *
 * 表加起来 600 KB 上下，塞进 JS bundle 会拖慢首屏，所以走 publicDir 当静态资源
 * 单独取，交给 CDN 缓存。`?v=` 是给赛季更新用的破缓存参数。
 */

import { type BaseIndex, buildBaseIndex } from './core/bases.js';
import { buildStatIndex, type StatIndex } from './core/stats.js';

export interface Tables {
  readonly stats: StatIndex;
  readonly bases: BaseIndex;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch ${url} (HTTP ${res.status})`);
  return res.text();
}

/**
 * 单文件离线版把两张表内联成 `<script type="text/plain">`，
 * 直接双击打开时没有服务器可 fetch。有内联的就用内联的。
 */
function inlined(id: string): string | null {
  return document.getElementById(id)?.textContent ?? null;
}

async function table(id: string, file: string, version: string): Promise<string> {
  return inlined(id) ?? (await fetchText(`${file}?v=${encodeURIComponent(version)}`));
}

export async function loadTables(version: string): Promise<Tables> {
  const [lut, bases] = await Promise.all([
    table('lut', 'stat-lut.tsv', version),
    table('bases', 'bases.tsv', version),
  ]);
  return { stats: buildStatIndex(lut), bases: buildBaseIndex(bases) };
}
