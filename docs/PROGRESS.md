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
- [ ] **装备图标。** 见下面「图标那件事」。
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

## 图标那件事

想在词条左边显示装备图标。**素材不是开源的** —— PoE 的物品美术版权归 GGG。

实际情况：GGG 的 fan site 政策允许粉丝站展示这些图，社区站（poe.ninja、awakened-poe-trade）
的通行做法是直接引用 `web.poecdn.com` 上的图。官方交易站**搜索结果**里带 icon URL，
但我们需要的是「底子 → 图标」的映射表，那个官方端点不给，得靠社区数据集（比如 RePoE）。

两个现实约束：

- 引用 poecdn 会给**离线单文件版**开一个洞 —— 那一版的卖点就是不发任何网络请求。
- 把图打包进仓库是另一回事：那是重新分发 GGG 的美术资源，跟引用不是一码事。

所以要做的话，路线是：社区数据集拿映射表 → 托管版引用 poecdn → 离线版不显示图标。
动手前先把 GGG 的 fan site 政策读一遍。
