import { describe, expect, it } from 'vitest';

import { extractCandidates, findPobCode, resolveImportUrl } from '../worker/import.js';
import { toPayload } from '../worker/leagues.js';
import { sampleCode } from './helpers.js';

describe('导入链接的解析', () => {
  it('pobb.in 的 build 页转成 /raw', () => {
    expect(resolveImportUrl('https://pobb.in/abc123')).toEqual({
      ok: true, fetchUrl: 'https://pobb.in/abc123/raw', source: 'pobb.in',
    });
  });

  it('已经是 /raw 的原样用，不会变成 /raw/raw', () => {
    expect(resolveImportUrl('https://pobb.in/abc123/raw')).toMatchObject({
      fetchUrl: 'https://pobb.in/abc123/raw',
    });
  });

  it('www. 前缀和结尾斜杠都容忍', () => {
    expect(resolveImportUrl('https://www.pobb.in/abc123/')).toMatchObject({
      fetchUrl: 'https://pobb.in/abc123/raw',
    });
  });

  it('pastebin 转成 /raw/<id>', () => {
    expect(resolveImportUrl('https://pastebin.com/AbC123')).toMatchObject({
      fetchUrl: 'https://pastebin.com/raw/AbC123', source: 'pastebin.com',
    });
    expect(resolveImportUrl('https://pastebin.com/raw/AbC123')).toMatchObject({
      fetchUrl: 'https://pastebin.com/raw/AbC123',
    });
  });

  it('认得但取不到的站，让用户去点「复制代码」', () => {
    expect(resolveImportUrl('https://poe.ninja/poe1/builds/char/xxx')).toEqual({
      ok: false, reason: 'use-code-instead', host: 'poe.ninja',
    });
  });

  it('白名单之外的域名一律拒绝', () => {
    // 这个端点会替调用方去抓 URL，不锁死白名单就是个 SSRF 跳板
    for (const evil of [
      'https://example.com/whatever',
      'https://169.254.169.254/latest/meta-data/',
      'https://localhost/admin',
      'https://pobb.in.evil.com/abc',
    ]) {
      expect(resolveImportUrl(evil)).toMatchObject({ ok: false, reason: 'unsupported-host' });
    }
  });

  it('非 https 一律拒绝', () => {
    expect(resolveImportUrl('http://pobb.in/abc123')).toEqual({ ok: false, reason: 'not-https' });
    expect(resolveImportUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'not-https' });
    expect(resolveImportUrl('ftp://pobb.in/abc')).toEqual({ ok: false, reason: 'not-https' });
  });

  it('把 userinfo 伪装成白名单域名的骗不过去', () => {
    // https://pobb.in@evil.com/x 的真实主机是 evil.com
    expect(resolveImportUrl('https://pobb.in@evil.com/x')).toEqual({
      ok: false, reason: 'unsupported-host', host: 'evil.com',
    });
  });

  it('多段路径拒掉，只认单段 id', () => {
    expect(resolveImportUrl('https://pobb.in/abc/def')).toEqual({ ok: false, reason: 'bad-url' });
    expect(resolveImportUrl('https://pobb.in/')).toEqual({ ok: false, reason: 'bad-url' });
  });

  it('路径穿越会被 URL 规范化掉，落回同域的另一个 id', () => {
    // new URL 会把 /abc/../../etc 规范成 /etc —— 主机没变，最多 404，不是漏洞
    expect(resolveImportUrl('https://pobb.in/abc/../../etc')).toMatchObject({
      ok: true, fetchUrl: 'https://pobb.in/etc/raw',
    });
  });

  it('压根不是 URL', () => {
    expect(resolveImportUrl('不是 URL')).toEqual({ ok: false, reason: 'bad-url' });
  });
});

describe('从响应里挑出 PoB 代码', () => {
  const code = sampleCode();

  it('整个响应体就是代码时直接命中', async () => {
    expect(await findPobCode(code)).toBe(code);
  });

  it('前后有空白也认', async () => {
    expect(await findPobCode(`\n  ${code}  \n`)).toBe(code);
  });

  it('从 HTML 里捞得出来', async () => {
    expect(await findPobCode(`<html><body><pre id="code">${code}</pre></body></html>`)).toBe(code);
  });

  it('不是 PoB 代码就返回 null，不硬塞', async () => {
    // 长得像 base64 但解不开的东西不能当代码返回给前端
    expect(await findPobCode('<html><body>404 Not Found</body></html>')).toBeNull();
    expect(await findPobCode('a'.repeat(400))).toBeNull();
  });

  it('候选有上限，不会被一个满是长串的页面拖死', () => {
    const junk = Array.from({ length: 100 }, (_, i) => 'x'.repeat(300) + i).join('\n');
    expect(extractCandidates(junk).length).toBeLessThanOrEqual(14);
  });
});

describe('赛季列表的整理', () => {
  const raw = [
    { id: 'Standard', category: { id: 'Standard' }, rules: [] },
    { id: 'Hardcore', category: { id: 'Standard' }, rules: [{ id: 'Hardcore' }] },
    { id: 'Allflame', category: { id: 'Allflame', current: true }, rules: [] },
    { id: 'Hardcore Allflame', category: { id: 'Allflame', current: true }, rules: [{ id: 'Hardcore' }] },
  ];

  it('当前赛季取 current 为真且没有 rules 的那条', () => {
    // Hardcore Allflame 的 category.current 也是真，只能靠 rules 区分
    expect(toPayload(raw).current).toBe('Allflame');
  });

  it('列表原样保留，带上 rules', () => {
    const p = toPayload(raw);
    expect(p.leagues).toHaveLength(4);
    expect(p.leagues[3]).toEqual({ id: 'Hardcore Allflame', current: true, rules: ['Hardcore'] });
  });

  it('没有当前赛季时退回 Standard', () => {
    expect(toPayload([{ id: 'Standard', rules: [] }]).current).toBe('Standard');
  });

  it('接口返回垃圾时不炸', () => {
    expect(toPayload(null)).toEqual({ leagues: [], current: 'Standard' });
    expect(toPayload('nope')).toEqual({ leagues: [], current: 'Standard' });
    expect(toPayload([{ nope: 1 }, { id: 42 }, { id: 'OK' }]).leagues).toEqual([
      { id: 'OK', current: false, rules: [] },
    ]);
  });
});
