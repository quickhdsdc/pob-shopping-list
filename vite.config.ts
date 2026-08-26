/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// root 放在 src/：Vite 的入口 HTML 必须在 root 里，而仓库根目录的 index.html
// 还是老的单文件产物（build.sh 生成的），两者不能撞车。
// data/ 直接当 publicDir，两张对照表会原样出现在站点根路径下。
export default defineConfig({
  root: 'src',
  publicDir: '../data',
  define: {
    // 对照表是静态资源，走 CDN 缓存；赛季更新后靠这个查询参数破缓存
    __DATA_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  test: {
    include: ['../test/**/*.test.ts'],
    environment: 'node',
  },
});
