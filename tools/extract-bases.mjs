/**
 * 从官方交易站接口提取底子物品表。
 *
 *   https://www.pathofexile.com/api/trade/data/items
 *
 * 存在的理由：魔法装备在 PoB 里只有一行带词缀的全名
 * （Flagellant's Quicksilver Flask of Incision），而交易站的 type 只认底子
 * 本身。有了这张表才能剥出 Quicksilver Flask。
 *
 * 以前从本地 PoB 的 Data/Bases/*.lua 提取，现在跟词条表一样直接问官方 ——
 * 不再依赖本地装没装 PoB，也就能放进定时任务里自动更新。
 *
 * 接口里 name 为空的条目就是底子，带 name 的是传奇（传奇按名字搜，用不上这表）。
 *
 * 输出三列：  底子名 \t 分类 \t 保留列
 *
 * 用法：  node tools/extract-bases.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ITEMS_API = 'https://www.pathofexile.com/api/trade/data/items';
const OUT = fileURLToPath(new URL('../data/bases.tsv', import.meta.url));

/** GGG 的 API 政策要求带一个能认出是谁的 User-Agent */
const USER_AGENT = 'poe-shopping-list/0.2 (+https://poe-shopping-list.pob-shopping-list.workers.dev)';

/**
 * 只收 build 里真会出现的装备分组。
 *
 * 卡片、通货、宝石、地图、尸体这些也在同一个接口里，收进来只会让「从全名里
 * 找底子」多出一堆假阳性 —— 比如某个通货的名字恰好是某件装备名字的一部分。
 */
const EQUIPMENT_GROUPS = new Set([
  'Accessories',
  'Armour',
  'Flasks',
  'Jewels',
  'Weapons',
  'Tincture',
  'Graft',
]);

const res = await fetch(ITEMS_API, { headers: { 'user-agent': USER_AGENT } });
if (!res.ok) throw new Error(`官方接口返回 ${res.status}`);
const body = await res.json();

const seen = new Map();
const skippedGroups = [];

for (const group of body.result ?? []) {
  const label = group.label;
  if (!EQUIPMENT_GROUPS.has(label)) {
    skippedGroups.push(label);
    continue;
  }
  for (const entry of group.entries ?? []) {
    // 带 name 的是传奇，type 才是底子
    if (entry.name) continue;
    const type = entry.type;
    if (typeof type !== 'string' || !type) continue;
    if (!seen.has(type)) seen.set(type, label);
  }
}

const lines = [...seen]
  .map(([name, label]) => `${name}\t${label}\t`)
  .sort();

await writeFile(OUT, lines.join('\n') + '\n', 'utf8');

console.log(`已写出 ${OUT}`);
console.log(`  底子条目：${lines.length}`);
console.log(`  跳过的分组：${skippedGroups.join(', ')}`);
