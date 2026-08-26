/**
 * 把 vite build 的产物压成一个自包含的 HTML —— 下载下来双击就能用，不联网、不上传。
 *
 * 做四件事：把 CSS 和 JS 内联进去、把两张对照表当 <script type="text/plain"> 附上、
 * 去掉 <link>/<script src>、写到仓库根目录的 index.html。
 *
 * 用法：  npm run build:single      （会先跑一遍 npm run build）
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = new URL('../', import.meta.url);
const at = (rel) => fileURLToPath(new URL(rel, repo));

/** 内联进 <script> 的内容里如果出现 </script>，HTML 解析器会当场截断 */
const safe = (text) => text.replaceAll('</script', '<\\/script');

const html = await readFile(at('dist/index.html'), 'utf8');

const cssHref = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
const jsSrc = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
if (!cssHref || !jsSrc) {
  throw new Error('在 dist/index.html 里找不到 CSS 或 JS 的引用，vite 的产物格式变了？');
}

const [css, js, lut, bases] = await Promise.all([
  readFile(at('dist/' + cssHref.replace(/^\//, '')), 'utf8'),
  readFile(at('dist/' + jsSrc.replace(/^\//, '')), 'utf8'),
  readFile(at('data/stat-lut.tsv'), 'utf8'),
  readFile(at('data/bases.tsv'), 'utf8'),
]);

// 替换值一律用函数返回 —— 字符串形式的替换会把内容里的 `$&` `$1` 当成
// 反向引用展开。打包后的 JS 里就有 `'\\$&'`（stats.ts 转义正则用的），
// 用字符串形式会把整个被替换掉的 <script src=...> 原样塞回来。
const single = html
  .replace(/<link[^>]+rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
  .replace(
    /<script[^>]+type="module"[^>]+src="[^"]+"[^>]*><\/script>/,
    () =>
      [
        `<script id="lut" type="text/plain">\n${safe(lut)}\n</script>`,
        `<script id="bases" type="text/plain">\n${safe(bases)}\n</script>`,
        `<script type="module">\n${safe(js)}\n</script>`,
      ].join('\n'),
  );

// 直接找那两个文件名，别用「有没有 src=」这种模糊判断 ——
// 内联进来的 JS 里本来就可能出现 src= 这样的字面量。
for (const ref of [cssHref, jsSrc]) {
  if (single.includes(ref)) throw new Error(`没内联干净，${ref} 还在页面里`);
}

const out = at('index.html');
await writeFile(out, single, 'utf8');
console.log(`已写出 ${out}`);
console.log(`  字节数：${Buffer.byteLength(single, 'utf8')}`);
