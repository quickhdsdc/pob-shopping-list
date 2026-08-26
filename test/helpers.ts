import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { type BaseIndex, buildBaseIndex } from '../src/core/bases.js';
import { buildStatIndex, type StatIndex } from '../src/core/stats.js';

function repoUrl(rel: string): URL {
  return new URL('../' + rel, import.meta.url);
}

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(repoUrl(rel)), 'utf8');
}

let statsCache: StatIndex | undefined;
let basesCache: BaseIndex | undefined;

export function stats(): StatIndex {
  return (statsCache ??= buildStatIndex(repoFile('data/stat-lut.tsv')));
}

export function bases(): BaseIndex {
  return (basesCache ??= buildBaseIndex(repoFile('data/bases.tsv')));
}

export function sampleCode(): string {
  return repoFile('test/sample-build.pobcode').trim();
}

/**
 * 用 node:zlib 解码。
 *
 * 刻意不走 decodePobCode ——jsdom 环境下 Blob 是 jsdom 自己的实现，
 * 跟 DecompressionStream 拼不到一起。浏览器那条解码路径由 decode.test.ts
 * 在 node 环境下单独测。
 */
export function xmlFromCode(code: string): string {
  const b64 = code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
}

export function sampleXml(): string {
  return xmlFromCode(sampleCode());
}

export interface RealBuild {
  readonly name: string;
  readonly code: string;
}

/** test/ 下所有 .pobcode，丢一个新文件进去就自动纳入回归 */
export function realBuilds(): RealBuild[] {
  const dir = fileURLToPath(repoUrl('test'));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.pobcode'))
    .sort()
    .map((name) => ({ name, code: repoFile('test/' + name).trim() }));
}
