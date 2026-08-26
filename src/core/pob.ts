/**
 * PoB 分享码的解码。
 *
 * 分享码是 `base64url(zlib(XML))`。poe.ninja / pobb.in「复制 build 代码」
 * 给的也是同一个东西，只是 zlib 压缩等级不同（`eNr…` vs `eJz…`），
 * DecompressionStream('deflate') 两种都吃。
 *
 * 这个模块**刻意不碰 DOM** —— Cloudflare Worker 里的链接导入要复用它，
 * 而 Worker 运行时没有 DOMParser。解析 XML 的部分在 core/build.ts。
 */

export type PobErrorCode =
  | 'empty'
  | 'is-url'
  | 'bad-base64'
  | 'no-decompression'
  | 'inflate-failed'
  | 'bad-xml'
  | 'no-items';

/** 文案留给调用方，核心只给错误码 —— 将来要出英文版时不用改这里 */
export class PobError extends Error {
  readonly code: PobErrorCode;
  constructor(code: PobErrorCode) {
    super(code);
    this.name = 'PobError';
    this.code = code;
  }
}

export async function decodePobCode(code: string): Promise<string> {
  const cleaned = code.trim().replace(/\s+/g, '');
  if (!cleaned) throw new PobError('empty');
  if (/^https?:\/\//i.test(cleaned)) throw new PobError('is-url');

  const b64 = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new PobError('bad-base64');
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));

  if (typeof DecompressionStream === 'undefined') throw new PobError('no-decompression');
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  } catch {
    throw new PobError('inflate-failed');
  }
}
