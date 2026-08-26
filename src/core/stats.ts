/**
 * 词条文本 -> 交易站 stat id 的匹配。
 *
 * 对照表（data/stat-lut.tsv）是「文本 \t hash」两列，文本里的可变数字写成 `#`。
 * explicit / implicit / fractured 三类共用同一个 hash，只是前缀不同，
 * 所以表里只存 hash，前缀由词条在物品文本里的位置决定。
 */

export interface StatEntry {
  /** 对照表里的文本，可变数字是 `#` */
  readonly text: string;
  /** 不带命名空间前缀的 hash */
  readonly hash: string;
  /**
   * 这个 hash **实际存在**于哪些命名空间，按固定优先级排好。
   *
   * 交易站的 id 是 `<命名空间>.stat_<hash>`，而不是每个 hash 在每个命名空间
   * 里都有。星团珠宝的「Adds # Passive Skills」只有 explicit 和 enchant，
   * 没有 implicit —— 按词条位置盲目拼前缀会拼出不存在的 id，交易站上显示成
   * "Unavailable Stat"，而且不报错。
   */
  readonly namespaces: readonly string[];
}

export interface StatIndex {
  readonly entries: readonly StatEntry[];
  /** 数字全换成 `#` 之后的文本 -> entries 下标 */
  readonly byNorm: ReadonlyMap<string, number>;
  /** 原文 -> entries 下标（交易站有些词条保留字面数字） */
  readonly byRaw: ReadonlyMap<string, number>;
  /** 抽掉全部数字和标点、只剩小写字母的规范键 -> entries 下标 */
  readonly byKey: ReadonlyMap<string, number>;
  /** 再削掉每个词的复数 s 之后的键 -> entries 下标，最松的一档 */
  readonly byDeplural: ReadonlyMap<string, number>;
}

/** 数字全部换成 `#`：`+134 to maximum Life` -> `+# to maximum Life` */
export function normalizeNumbers(text: string): string {
  return text.replace(/\d+(\.\d+)?/g, '#');
}

/** 抽掉数字和标点的规范键，用于混合型词条的兜底匹配 */
export function canonicalKey(text: string): string {
  return text.toLowerCase().replace(/[0-9#.]+/g, '').replace(/[^a-z]/g, '');
}

/**
 * 最松的一档键：削掉每个词的复数 s，再丢掉冠词和系动词。
 *
 * 交易站的文本用 `#` 占位，整句就按占位符写成复数，物品上写的是单数：
 *
 * | 物品 | 交易站 |
 * | --- | --- |
 * | `Gain 3 Charges when you are Hit by an Enemy` | `Gain # Charge when you are Hit by an Enemy` |
 * | `1 Added Passive Skill is a Jewel Socket` | `# Added Passive Skills are Jewel Sockets` |
 *
 * 差异在句子中间，只削词尾的容错兜不住；第二例还差一组 is a / are。
 *
 * 只削长度 4 以上的词，别把 has 之类削坏。不规则复数（Enemy/Enemies）不管 ——
 * 那种情况两边通常一致。实测这一档的碰撞率 0.63%，而且它只在前面几档全落空
 * 时才用得上。
 */
const STOPWORDS = new Set(['is', 'are', 'a', 'an', 'the']);

export function depluralKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9#.]+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join('');
}

/** 剥掉 PoB 的 `{crafted}` / `{fractured}` 之类前缀标记 */
export function stripTag(line: string): string {
  return line.replace(/^\{[^}]*\}\s*/, '').trim();
}

/**
 * 交易站给**本地**词条加了 ` (Local)` 后缀，用来跟同名的全局词条区分 ——
 * 护甲上的「#% 增加护甲」是本地的，天赋树上的是全局的，两者 hash 不同。
 * 物品文本里没有这个后缀，所以查表时得自己补上试一次。
 */
const LOCAL_SUFFIX = ' (Local)';
const LOCAL_SUFFIX_RE = / \(Local\)$/;

/**
 * 物品上写 `reduced` / `less`，交易站统一记成 `increased` / `more` 的负值：
 * 「66% reduced Amount Recovered」在交易站是「#% increased Amount Recovered」= -66。
 *
 * 只在直接查不到时才走这条 —— 对照表里本来就有一百多条带 reduced 的词条，
 * 抢在它们前面翻译会把正确的匹配挤掉。
 */
function flipPolarity(text: string): string | null {
  if (/\breduced\b/.test(text)) return text.replace(/\breduced\b/, 'increased');
  if (/\bless\b/.test(text)) return text.replace(/\bless\b/, 'more');
  return null;
}

/**
 * 物品文本用冠词表示「一个」，交易站统一写成带数字的复数形式：
 * 「You can apply an additional Curse」对应「You can apply # additional Curses」。
 *
 * 换成 1 之后既能走单复数容错命中，取值也能拿到 1。
 */
function articleToOne(text: string): string | null {
  const out = text.replace(/\b[Aa]n?\b/g, '1');
  return out === text ? null : out;
}

export function buildStatIndex(tsv: string): StatIndex {
  const entries: StatEntry[] = [];
  const byNorm = new Map<string, number>();
  const byRaw = new Map<string, number>();
  const byKey = new Map<string, number>();
  const byDeplural = new Map<string, number>();

  for (const line of tsv.split('\n')) {
    const [text, hash, ns] = line.split('\t');
    if (!text || !hash) continue;
    const namespaces = (ns ?? '').trim().split(',').filter(Boolean);
    if (namespaces.length === 0) continue;
    const idx = entries.push({ text, hash: hash.trim(), namespaces }) - 1;
    // 先来的优先：对照表已按字典序去重，同一个键撞上时保留第一个
    if (!byRaw.has(text)) byRaw.set(text, idx);
    const n = normalizeNumbers(text);
    if (!byNorm.has(n)) byNorm.set(n, idx);
    const k = canonicalKey(text);
    if (!byKey.has(k)) byKey.set(k, idx);
    const d = depluralKey(text);
    if (!byDeplural.has(d)) byDeplural.set(d, idx);
  }
  return { entries, byNorm, byRaw, byKey, byDeplural };
}

/**
 * 用命中的对照表文本反推正则，**按位置**捕获数值。
 *
 * 这样 `8% chance to gain Phasing for 4 seconds on Kill` 不会把 8 和 4 混为一谈 ——
 * 只有对照表里写成 `#` 的那些位置才是变量。反推失败时退回「抓出所有数字」。
 */
export function extractValues(lutText: string, rawLine: string): number[] {
  // 对照表里的 (Local) 后缀物品文本上没有，反推正则前得摘掉
  const esc = lutText.replace(LOCAL_SUFFIX_RE, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = '^' + esc.replace(/#/g, '([+-]?\\d+(?:\\.\\d+)?)') + '$';
  try {
    const m = new RegExp(pat).exec(rawLine);
    if (m) return m.slice(1).map(Number);
  } catch {
    /* 对照表文本里有诡异字符导致正则编不出来，走下面的兜底 */
  }
  return (rawLine.match(/\d+(\.\d+)?/g) ?? []).map(Number);
}

export interface ModMatch {
  /** 形如 `explicit.stat_3299347043`，没匹配上是 null */
  readonly id: string | null;
  /** 交易站要填的数值，无数值词条是 null */
  readonly value: number | null;
}

const NO_MATCH: ModMatch = { id: null, value: null };

/**
 * 在对照表里查一条词条，按可信度从高到低试：
 * 原文 -> 归一化原文 -> 补 (Local) 后缀 -> 规范键 -> 规范键补 local -> 单复数容错
 *
 * 原文精确匹配排在归一化前面，是因为星团珠宝那批带选项索引的词条里，
 * 同一个效果有多个数值版本（10% / 12% increased Attack Damage 是不同的选项），
 * 归一化之后它们是同一个键，先归一化就会挑错选项 —— 而挑错的 id 在交易站上
 * 一样不报错，只是搜出来的东西不对。
 */
function lookupExact(index: StatIndex, raw: string): StatEntry | null {
  const norm = normalizeNumbers(raw);
  const key = canonicalKey(raw);
  const tries = [
    index.byRaw.get(raw),
    index.byNorm.get(norm),
    index.byNorm.get(norm + LOCAL_SUFFIX),
    index.byKey.get(key),
    index.byKey.get(key + 'local'),
    // Has 1 Abyssal Socket ↔ Has # Abyssal Sockets
    index.byKey.get(key + 's'),
    key.endsWith('s') ? index.byKey.get(key.slice(0, -1)) : undefined,
    // 复数 s 在句子中间的：Gain 3 Charges ↔ Gain # Charge
    index.byDeplural.get(depluralKey(raw)),
  ];
  for (const idx of tries) {
    if (idx !== undefined) return index.entries[idx] ?? null;
  }
  return null;
}

interface Hit {
  readonly entry: StatEntry;
  /** 实际拿去取值的文本，可能是把 reduced 翻译成 increased 之后的 */
  readonly text: string;
  /** 翻译过极性的话，取出来的数值要取反 */
  readonly negate: boolean;
}

/**
 * 按可信度从高到低试几种改写：原文 -> 冠词换成 1 -> 极性翻译。
 * 改写只在前一种查不到时才试，避免抢掉本来就正确的匹配。
 */
function lookup(index: StatIndex, raw: string): Hit | null {
  const candidates: { text: string; negate: boolean }[] = [{ text: raw, negate: false }];

  const withOne = articleToOne(raw);
  if (withOne) candidates.push({ text: withOne, negate: false });

  const flipped = flipPolarity(raw);
  if (flipped) candidates.push({ text: flipped, negate: true });

  for (const { text, negate } of candidates) {
    const entry = lookupExact(index, text);
    if (entry) return { entry, text, negate };
  }
  return null;
}

/**
 * 词条位置猜出来的命名空间不存在时的退路。
 *
 * enchant 排第一：物品文本的 `Implicits:` 区段里除了真植入词条，还塞着附魔
 * （星团珠宝的「Adds # Passive Skills」、药剂的「Used when Charges reach full」），
 * 它们在交易站属于 enchant。
 */
const NAMESPACE_FALLBACK = ['enchant', 'explicit', 'fractured', 'implicit', 'crafted'] as const;

/** 按词条在物品文本里的位置猜一个命名空间，猜的那个不存在就退而求其次 */
export function namespaceFor(entry: StatEntry, implicit: boolean): string | null {
  const wanted = implicit ? 'implicit' : 'explicit';
  if (entry.namespaces.includes(wanted)) return wanted;
  for (const ns of NAMESPACE_FALLBACK) {
    if (entry.namespaces.includes(ns)) return ns;
  }
  return null;
}

export function matchMod(
  index: StatIndex,
  mod: { readonly line: string; readonly implicit: boolean },
): ModMatch {
  const raw = stripTag(mod.line);
  const hit = lookup(index, raw);
  if (!hit) return NO_MATCH;

  const ns = namespaceFor(hit.entry, mod.implicit);
  if (!ns) return NO_MATCH;

  let vals = extractValues(hit.entry.text, hit.text);
  // 最松那档会把冠词当停用词丢掉，于是「an additional Curse」直接命中了
  // 「# additional Curses」，走不到「冠词换成 1」那步，数值就丢了。
  // 命中了但取不到值、而对照表文本里明明有 `#` 时，再用换过冠词的文本取一次。
  if (vals.length === 0 && hit.entry.text.includes('#')) {
    const withOne = articleToOne(hit.text);
    if (withOne) vals = extractValues(hit.entry.text, withOne);
  }
  let value: number | null = null;
  // `Adds A to B` 这类两个数取平均 —— 交易站也是这么算的
  if (vals.length >= 2) value = ((vals[0] ?? 0) + (vals[1] ?? 0)) / 2;
  else if (vals.length === 1) value = vals[0] ?? null;
  if (value !== null && hit.negate) value = -value;

  return { id: `${ns}.stat_${hit.entry.hash}`, value };
}
