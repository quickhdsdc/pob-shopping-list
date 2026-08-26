/**
 * 从官方交易站接口提取「词条文本 -> stat hash + 命名空间」对照表。
 *
 *   https://www.pathofexile.com/api/trade/data/stats
 *
 * 以前是从本地 PoB 安装目录的 Data/TradeSiteStats.lua 提取的 —— 那份是这个
 * 接口的镜像，会过期。实测它缺了「While a Pinnacle Atlas Boss is in your
 * Presence, #% chance to Unnerve Enemies...」这类新词条，导致界面上标红说
 * 识别不了，其实交易站搜得到。直接问权威源，顺带也不再依赖本地装没装 PoB。
 *
 * 输出三列：  文本 \t hash \t 可用的命名空间（逗号分隔）
 *
 * 用法：  node tools/extract-lut.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STATS_API = 'https://www.pathofexile.com/api/trade/data/stats';
const OUT = fileURLToPath(new URL('../data/stat-lut.tsv', import.meta.url));

/** GGG 的 API 政策要求带一个能认出是谁的 User-Agent */
const USER_AGENT = 'poe-shopping-list/0.2 (+https://poe-shopping-list.pob-shopping-list.workers.dev)';

/** 装备上真会出现的命名空间，顺序即运行时的兜底优先级 */
const NAMESPACES = ['explicit', 'implicit', 'fractured', 'enchant', 'crafted'];

/**
 * 太长的基本是地图词缀或传奇专属的整段文本，装备词条匹配用不上，
 * 留着只会让对照表变大、规范键碰撞变多。
 */
const MAX_TEXT_LENGTH = 110;

/**
 * hash 可以带选项索引：`enchant.stat_3948993189|33` 是星团珠宝的一条小点词缀。
 * 这类**不是**「一个 stat 配一个下拉框」—— 每条的 text 本身就是完整文本，
 * 当普通词条收就行，界面上不需要任何额外交互。
 */
const STAT_ID = /^([a-z]+)\.stat_(\d+(?:\|\d+)*)$/;

const res = await fetch(STATS_API, { headers: { 'user-agent': USER_AGENT } });
if (!res.ok) throw new Error(`官方接口返回 ${res.status}`);
const body = await res.json();

/** text -> hash -> Set(命名空间) */
const byText = new Map();
let total = 0;
let skippedOption = 0;
let multiLine = 0;

for (const group of body.result ?? []) {
  for (const entry of group.entries ?? []) {
    total++;
    const { id, text } = entry;
    if (typeof id !== 'string' || typeof text !== 'string' || !text) continue;

    // 真正带下拉选项的（entry.option 是一个候选列表）需要界面上能选具体哪一项。
    // 实测这 88 条全是 pseudo.*，本来就在我们要的命名空间之外。
    if (entry.option) {
      skippedOption++;
      continue;
    }

    const m = STAT_ID.exec(id);
    if (!m) continue;
    const [, ns, hash] = m;
    if (!NAMESPACES.includes(ns)) continue;

    // 有些词条的 text 是多行的：一条小点词缀同时给陷阱和地雷伤害，交易站记成
    // 一条 stat、两行文本，而 PoB 的物品文本里是分开的两行。每行都当作这个 id
    // 的别名收进去，两行才都认得出来（TSV 也塞不下换行）。
    const lines = text.split('\n');
    if (lines.length > 1) multiLine++;
    for (const line of lines) {
      const key = line.trim();
      if (!key || key.length > MAX_TEXT_LENGTH) continue;
      let byHash = byText.get(key);
      if (!byHash) byText.set(key, (byHash = new Map()));
      const set = byHash.get(hash) ?? new Set();
      set.add(ns);
      byHash.set(hash, set);
    }
  }
}

const lines = [];
for (const [text, byHash] of byText) {
  // 同一段文本可能对应多个 hash。取支持的命名空间最多的那个 —— 它覆盖面
  // 最广，最可能是玩家真正想搜的那一条。
  let bestHash = null;
  let bestSet = null;
  for (const [hash, set] of byHash) {
    if (!bestSet || set.size > bestSet.size) {
      bestHash = hash;
      bestSet = set;
    }
  }
  const ns = NAMESPACES.filter((n) => bestSet.has(n)).join(',');
  lines.push(`${text}\t${bestHash}\t${ns}`);
}
lines.sort();

await writeFile(OUT, lines.join('\n') + '\n', 'utf8');

const withEnchant = lines.filter((l) => l.split('\t')[2].includes('enchant')).length;
const withOptionIndex = lines.filter((l) => l.split('\t')[1].includes('|')).length;
console.log(`已写出 ${OUT}`);
console.log(`  官方 stat 总数：${total}`);
console.log(`  跳过（带下拉选项）：${skippedOption}`);
console.log(`  多行文本拆成别名：${multiLine}`);
console.log(`  写出条目：${lines.length}`);
console.log(`  其中含 enchant：${withEnchant}`);
console.log(`  其中带选项索引：${withOptionIndex}`);
