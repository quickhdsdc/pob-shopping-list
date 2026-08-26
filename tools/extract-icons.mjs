/**
 * 提取「底子物品名 -> 图标 URL」对照表。
 *
 * 图是 GGG 自己 CDN 上的游戏美术，粉丝站（poedb、poe.ninja）用的都是同一批：
 *
 *   https://web.poecdn.com/image/Art/2DItems/Armours/Gloves/GlovesDex4.png
 *
 * 缺的一环是「底子名 -> 美术路径」，**官方端点不给**。社区数据集 RePoE 从游戏
 * 文件里扒出来了，每条底子带一个 visual_identity.dds_file，把 .dds 换成 .png
 * 拼上 CDN 前缀就是图。
 *
 * ⚠ RePoE 已经没人维护：原仓库停在 2022，这个分支停在 2024-12 且已归档，
 * 实测覆盖我们底子表的 93.4%（缺 72 条，主要是护身符和移植物）。所以：
 *   - 界面上**取不到图标时布局不能塌**
 *   - 产物提交进仓库，网站运行时不依赖 RePoE，仓库哪天消失也只是新底子没图
 *
 * 输出两列：  底子名 \t 美术路径（不含 CDN 前缀和扩展名）
 *
 * 用法：  node tools/extract-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REPOE = 'https://raw.githubusercontent.com/lvlvllvlvllvlvl/RePoE/master/RePoE/data/base_items.json';
const BASES = fileURLToPath(new URL('../data/bases.tsv', import.meta.url));
const OUT = fileURLToPath(new URL('../data/icons.tsv', import.meta.url));

/** 运行时拼成 `${ICON_CDN}${path}.png`，这个前缀在 src 里也有一份 */
export const ICON_CDN = 'https://web.poecdn.com/image/';

const res = await fetch(REPOE, { headers: { 'user-agent': 'poe-shopping-list/0.2' } });
if (!res.ok) throw new Error(`RePoE 返回 ${res.status}`);
const items = await res.json();

/** 底子名 -> 美术路径（去掉 .dds 后缀） */
const art = new Map();
for (const entry of Object.values(items)) {
  const name = entry?.name;
  const dds = entry?.visual_identity?.dds_file;
  if (typeof name !== 'string' || typeof dds !== 'string') continue;
  if (!dds.startsWith('Art/')) continue;
  if (!art.has(name)) art.set(name, dds.replace(/\.dds$/i, ''));
}

// 只留我们底子表里真会用到的，别把 3700 条无关的都塞进产物
const wanted = (await readFile(BASES, 'utf8'))
  .split('\n')
  .map((l) => l.split('\t')[0]?.trim())
  .filter(Boolean);

const lines = [];
const missing = [];
for (const name of wanted) {
  const path = art.get(name);
  if (path) lines.push(`${name}\t${path}`);
  else missing.push(name);
}
lines.sort();

await writeFile(OUT, lines.join('\n') + '\n', 'utf8');

console.log(`已写出 ${OUT}`);
console.log(`  底子表条目：${wanted.length}`);
console.log(`  有图标的：${lines.length}（${((lines.length / wanted.length) * 100).toFixed(1)}%）`);
console.log(`  没图标的：${missing.length} —— 界面上要能优雅降级`);
if (missing.length) console.log(`    例如：${missing.slice(0, 6).join('、')}`);
