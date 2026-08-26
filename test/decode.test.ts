import { describe, expect, it } from 'vitest';

import { decodePobCode, PobError } from '../src/core/pob.js';
import { sampleCode } from './helpers.js';

describe('PoB 分享码解码', () => {
  it('解得出 XML', async () => {
    const xml = await decodePobCode(sampleCode());
    expect(xml).toContain('<PathOfBuilding>');
    expect(xml).toContain('<Items');
  });

  it('容忍中间的换行和空格（从网页复制常带）', async () => {
    const chopped = sampleCode().replace(/(.{40})/g, '$1\n');
    expect(await decodePobCode(chopped)).toContain('<PathOfBuilding>');
  });

  const rejects = async (code: string, expected: string) => {
    await expect(decodePobCode(code)).rejects.toMatchObject({ code: expected });
  };

  it('空输入', () => rejects('   ', 'empty'));
  it('给的是链接而不是代码', () => rejects('https://pobb.in/abc123', 'is-url'));
  it('不是合法 base64', () => rejects('!!!! 不是 base64 !!!!', 'bad-base64'));
  it('是 base64 但解不开', () => rejects('aGVsbG8gd29ybGQ=', 'inflate-failed'));

  it('抛的是带错误码的 PobError，文案留给 UI', async () => {
    await expect(decodePobCode('')).rejects.toBeInstanceOf(PobError);
  });
});
