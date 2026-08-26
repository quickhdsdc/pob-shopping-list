# 开发进度

给我们自己看的。README 是给用户和外人看的，那份里不写「还没做」和「踩过的坑」。

最后更新：2026-08-26

---

## 现在能跑的东西

| | |
| --- | --- |
| 网站 | https://poe-shopping-list.pob-shopping-list.workers.dev |
| 代码 | https://github.com/quickhdsdc/pob-shopping-list （公开，MIT）|
| 部署 | `npm run deploy` 一条命令，Cloudflare Workers 免费额度 |
| 测试 | 119 个单测 + 2 个浏览器冒烟测试 |

**识别率**（非传奇词条，实测两套真实 build）：

| build | 词条数 | 未识别 | 识别率 |
| --- | --- | --- | --- |
| `test/ninja-build.pobcode` | 67 | 0 | **100%** |
| `test/sample-build.pobcode` | 149 | 1 | **99%** |

样例里剩的那一条是 `Curse Enemies with Punishment on Hit`（必定触发版）。交易站只有
`#% chance to` 那版，**是另一个词条**，硬匹配过去会生成错的查询。故意不匹配，界面上标红。

---

## 做完了

- [x] PoB 分享码解码（`base64url(zlib(XML))`，poe.ninja / PoB 生成的都吃）
- [x] 物品文本解析、槽位还原（含深渊插槽、天赋树珠宝孔）
- [x] 词条 → 交易站 stat id 的多档匹配
- [x] 底子物品还原（魔法装备要从带词缀的全名里剥出底子）
- [x] 容差、默认勾选、查询组装、URL 生成
- [x] TypeScript 模块化 + Vite 构建，`src/core/` 全是纯函数
- [x] 两种产物：托管版 `dist/` + 双击即用的单文件 `index.html`
- [x] Cloudflare Worker：`/api/leagues`（自动填当前赛季）、`/api/import`（pobb.in / pastebin 链接导入）
- [x] 对照表改从官方 `api/trade/data/*` 提取，不再依赖本地装 PoB
- [x] 界面英文化，卡片双列，统计条

## 没做

- [ ] **中英切换。** 文案已经集中在 `src/copy.ts`，加一个同形状的中文对象 + 一个切换控件即可。
- [ ] **装备图标接进界面。** 数据表已生成（`data/icons.tsv`），链路已查证，还没接进 UI ——
      等界面重做时一起做。约束见下面「图标」一节。
- [ ] **界面重新设计。** 现在这版是我按现有视觉语言改的，用户评价「有点丑」。
      设计简报见 [design-brief.md](design-brief.md)。
- [ ] **GitHub Actions 自动部署 + 定时更新对照表。** 两张表都从官方接口拉、不需要认证，
      定时任务跑得动。自动部署需要建一个 Cloudflare API token（Actions 里开不了浏览器做 OAuth）。
- [ ] **估价 / 总价。** 明确不做，见下面「定调」。
- [ ] 更多导入源（pob.cool、poeplanner）—— 目前只支持 pobb.in 和 pastebin。

---

## 定调（改主意之前先看这个）

2026-08-26 拍板，后续所有取舍都建立在这上面：

- **只做 PoE1 国际服。** 不碰 PoE2，也不碰国服（`poe.game.qq.com` 是另一套中文词条表）。
- **轻后端。** Worker 只做链接导入代理和赛季列表缓存。**明确不做批量估价** ——
  那意味着要碰 GGG 的 trade API，要 OAuth、限流队列、运维和政策风险。
  代价是这个工具告诉你要买哪些东西，但不告诉你要花多少钱。
- **免费 + 捐赠**变现，跟 poe.ninja 一个路子。不上广告、不做付费增值。

---

## 踩过的坑（别再踩一遍）

这些都是**线上实测才暴露的**，本地测试全绿。共同点：交易站对错误的查询**不报错**。

### 1. 命名空间不能靠猜

`<命名空间>.stat_<hash>` 里，不是每个 hash 在每个命名空间都存在。星团珠宝的
`Adds # Passive Skills` 只有 `explicit` 和 `enchant`，没有 `implicit`。按词条在物品文本里的
位置盲拼前缀，拼出 `implicit.stat_3086156145` —— 这个 id 不存在，交易站显示成
"Unavailable Stat"，**不报错**，搜索结果整个不对。

现在对照表存三列（文本 / hash / 该 hash 实际支持的命名空间），猜的那个不在列表里就退到
`enchant`。`test/stats.test.ts` 有一条不变式测试，把对照表**每一条**在两种位置下都跑一遍。

### 2. PoB 的数据镜像会过期

对照表最早从本地 PoB 的 `Data/TradeSiteStats.lua` 提取 —— 那是官方接口的镜像，滞后。
实测缺了 `While a Pinnacle Atlas Boss is in your Presence, #% chance to Unnerve Enemies...`，
界面上标红说识别不了，其实交易站搜得到。

**只信官方端点。** 底子表同理：PoB 里有 `Energy Blade One Handed` 这种内部命名，
写进 `type` 搜不出任何东西。

### 3. 带管道符的 id 不需要特殊处理

`enchant.stat_3948993189|33` 我一开始判断成「一个 stat 配一个下拉框」，提取时全跳过，
星团珠宝的小点词缀因此长期识别不了。**判断是错的** —— 那是 1798 条各自独立的词条，
`text` 本身就是完整文本。真正需要下拉框的是带 `option` 字段的 88 条，全是 `pseudo.*`。

### 4. 有些 stat 的 text 是多行的

一条小点词缀同时给陷阱和地雷伤害，交易站记成一条 stat、两行文本，PoB 的物品文本里却是
分开的两行。每行都要当作这个 id 的别名收进对照表（TSV 也塞不下换行）。相应地
**同一个 id 在一次查询里只能出现一次** —— 重复的筛选交易站会当成「要有两条这个词条」。

### 5. 单复数差异在句子中间

物品 `Gain 3 Charges when you are Hit by an Enemy`，交易站 `Gain # Charge when...`（单数）。
只削词尾 s 的容错兜不住。最松那档改成每个词都削复数、再丢掉 `is/are/a/an/the`。
实测碰撞率 0.63%，而且只在前面几档全落空时才用得上。

### 6. 匹配顺序：原文精确必须排在归一化前面

星团珠宝的小点词缀里同一效果有多个数值版本（`10%` / `12% increased Attack Damage` 是
不同选项），归一化之后是同一个键。先归一化就会挑错选项。

### 7. 老测试自己是错的

最早那个无头测试靠 CSS 类名首字母判断稀有度，`RELIC` 和 `RARE` 都是 `R`，把遗物药剂
算成了稀有装备，识别率报的 88% 其实该是 90%。**测试的口径也要当代码审。**

---

## 数据更新流程

赛季更新、GGG 加了新词条或新底子时：

```bash
npm run data             # 从官方 api/trade/data/* 重建两张表
npm test                 # 识别率有回归会红
npm run build:single
npm run deploy
```

不需要本地装 PoB。界面上出现「Base type unknown」的红字，就是底子表该更新了。

---

## 图标：链路已查证，数据表已生成

粉丝站（poedb、poe.ninja、poe.re）的图标**不是开源素材，也不是他们自己画的** ——
就是引 GGG 官方 CDN 上的游戏美术。poedb 略有不同，它转存到自己的 `cdn.poedb.tw`，
但路径结构完全一样，都是游戏文件里的内部美术路径。

```
https://web.poecdn.com/image/Art/2DItems/Armours/Gloves/GlovesDex4.png   → 200 image/png
```

缺的一环是「底子名 → 美术路径」，**官方端点不给**。社区数据集 RePoE 从游戏文件里
扒出来了，每条底子带一个 `visual_identity.dds_file`，`.dds` 换 `.png` 拼上 CDN 前缀即可。

已经做好了：`tools/extract-icons.mjs` → `data/icons.tsv`（1016 条，60 KB）。

### 三个必须记住的约束

1. **RePoE 没人维护了。** 原仓库停在 2022（缺我们 14% 的底子），在用的这个分支停在
   2024-12 **且已归档**，覆盖 **93.4%** —— 缺 72 条，主要是护身符和移植物这些新品类。
   所以界面上**取不到图标时布局不能塌**。好在产物提交进仓库，网站运行时不依赖 RePoE。
2. **只有底子的图，传奇没有。** 传奇装备在游戏里有专属美术，RePoE 的 `base_items` 里
   没有。目前传奇卡片只能显示它底子的图（Shroud of the Lightless 会显示普通 Carnal Armour
   的图）。要做对得再找一份传奇美术的映射。
3. **离线单文件版会失去图标。** 那一版的卖点就是零网络请求，引 poecdn 等于开了个洞。
   决定是：托管版显示图标，离线版不显示 —— 这也正是「没图标不能塌」的另一个理由。

动手接进界面前，先把 GGG 的 fan site 政策读一遍：**引用**和**重新分发**是两回事，
我们走的是引用。
