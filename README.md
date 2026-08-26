# PoB 采购单生成器

把别人的 Path of Building 配装，一键变成一整套国际服交易站搜索链接。

粘贴一段 PoB 代码 → 每件装备一张卡片 → 每条词条一个可调的数值下限 → 点开就是搜索结果。

**纯前端单文件，双击即用。不需要后端、不需要联网、不上传任何数据。**

---

## 这个工具解决什么问题

PoB 本身有一个交易站功能（Items 页 → `Trade for these items`），但它和这个工具的目标**完全相反**：

|              | PoB 自带                                   | 本工具                                    |
| ------------ | ------------------------------------------ | ----------------------------------------- |
| 输入         | **你自己**的 build                         | **别人**的 PoB 代码                       |
| 在算什么     | 每条候选词条对**你当前面板**的增益         | 目标装备**实际有哪些词条**                |
| 输出         | 加权搜索，帮你找升级件                     | 逐件复刻搜索，帮你照着买                  |
| 可调参数     | 权重（偏 DPS 还是偏 EHP）                  | **容差**（能接受原件的百分之多少）        |
| 一次出几条   | 一个槽位点一次                             | **一键出全部**                            |
| 分享         | 对方得装 PoB 并导入                        | 发个文件/链接就行                         |

PoB 的权重是**把候选词条塞进 build 重算一遍**测出来的真实增益，做「优化自己的 build」时比任何手工权重都准。
但你把别人的 PoB 塞进去，它给你的是「怎么升级这套配装」，而不是「这套配装要花多少钱买齐」——
后者才是抄作业时需要的东西。

---

## 快速开始

1. 打开网站，或者下载 `index.html` 双击用浏览器打开（Chrome / Edge / Firefox 均可）
2. 拿到别人的 build：
   - PoB 里 `Import/Export` → `Generate` → 复制那串长字符
   - poe.ninja 的 build 页点「Copy build code」
   - 或者直接贴 **pobb.in / pastebin 的链接**（网站版才有，离线版没有后端）
3. 粘进输入框 → 点「生成」

### 界面上的四个全局参数

| 参数              | 说明                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| 赛季              | 写进 URL 路径。网站版会自动填成当前赛季，下拉里是官网的实时赛季列表   |
| 挂单              | 对应交易站 `status`，默认「一口价」(`securable`)                      |
| **容差 %**        | 数值门槛 = 原件数值 × 容差。默认 80% —— 原件 +134 生命就搜 ≥107      |
| 每件最多筛几条    | 稀有装备默认自动勾选 N 条可识别词条（词缀优先于植入），默认 4          |

每张卡片里，**每条词条都有独立的勾选框和数值输入框**，可以逐条改。
传奇装备默认不勾任何词条（按名字 + 底子搜就够精确了），勾上则可以额外限定数值范围。

---

## 它是怎么工作的

### 1. 解码 PoB 代码

PoB 的分享码是 `base64url( zlib( XML ) )`。浏览器原生 API 就能解，无第三方依赖：

```js
const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const stream = new Blob([bytes]).stream()
  .pipeThrough(new DecompressionStream('deflate'));
const xml = new TextDecoder().decode(await new Response(stream).arrayBuffer());
```

然后 `DOMParser` 解析 XML，从 `<Items>` 取物品文本、从 `<ItemSet><Slot>` 和 `<Sockets><Socket>`
还原每件装备在哪个槽位（含深渊插槽和天赋树珠宝孔）。

### 2. 词条文本 → 交易站 stat id

这是唯一有难度的一环。内嵌了 7,980 条对照表（`data/stat-lut.tsv`，直接从官方 `api/trade/data/stats` 提取），**三级匹配**：

| 级别 | 做法                       | 解决的问题                                                      |
| ---- | -------------------------- | --------------------------------------------------------------- |
| 1    | 数字 → `#` 后精确匹配      | `+134 to maximum Life` → `+# to maximum Life`                    |
| 2    | 原文精确匹配               | `1 Added Passive Skill is Feed the Fury` —— 交易站保留字面数字   |
| 3    | 抽掉全部数字的规范键       | `8% chance to gain Phasing for 4 seconds on Kill` —— 混合型      |
| 3b   | 单复数容错                 | `Has 1 Abyssal Socket` ↔ `Has # Abyssal Sockets`                 |

第 3 级规范键的碰撞率实测约 **0.5%**，碰撞的基本都是「本地 vs 全局格挡」这类本就有歧义的词条。

匹配上之后还得挑**命名空间**：id 的形状是 `<命名空间>.stat_<hash>`，而不是每个 hash
在每个命名空间里都存在。星团珠宝的 `Adds # Passive Skills` 只有 `explicit` 和
`enchant`，没有 `implicit` —— 早期版本按词条位置盲目拼前缀，拼出的 id 交易站**不报错**，
只是显示成 "Unavailable Stat"，搜索结果整个不对。所以对照表存三列（文本 / hash /
该 hash 实际支持的命名空间），猜的那个不在列表里就退到 `enchant`。
细节见 [docs/trade-api-notes.md](docs/trade-api-notes.md)。

### 2b. 魔法装备的底子

魔法装备在 PoB 里只有一行名字 —— `Flagellant's Quicksilver Flask of Incision` ——
而交易站的 `type` 只认底子本身。内嵌了 1,088 条底子物品表（`data/bases.tsv`，从官方 `api/trade/data/items` 提取 ——
那里的名字就是交易站真正接受的底子名），按名字从长到短做词边界匹配，
剥出 `Quicksilver Flask`（`Large Cluster Jewel` 会优先于 `Cluster Jewel`）。

认不出来的底子**宁可不写 `type`**，让搜索宽一点，也不写个不存在的底子搜出空结果；
界面上会标红提示。

### 3. 按位置取值

命中对照表后，用对照表文本反推正则（`#` → `([+-]?\d+(?:\.\d+)?)`）去匹配原始词条行，
按**位置**捕获数值。这样 `8% chance to gain Phasing for 4 seconds on Kill` 不会把 8 和 4 平均掉。
`Adds A to B` 这类两个数的取平均 —— 与交易站的算法一致。

### 4. 生成查询

```jsonc
{
  "query": {
    "status": { "option": "securable" },
    "name": "Spinesnatch",              // 传奇：名字 + 底子
    "type": "Fleshripper",
    "stats": [{ "type": "and", "filters": [
      { "id": "explicit.stat_3299347043", "value": { "min": 107 } }
    ]}]
  },
  "sort": { "price": "asc" }
}
```

URL 形如 `https://www.pathofexile.com/trade/search/<赛季>?q=<urlencoded JSON>`。

---

## 实测数据

用一套 44 件装备的深渊珠宝叠层配装（`test/sample-build.pobcode`）跑：

```
装备数        : 44
稀有/魔法词条 : 149
未识别        : 12
识别率        : 92%
生成的链接数  : 44
```

传奇装备识别率视作 100% —— 它们按名字 + 底子搜，词条识别与否不影响结果。

除了这几个数，`test/build.test.ts` 还盯着三类曾经真出过的错，每一类都有专门的回归用例：

| 曾经的错 | 后果 | 现在的断言 |
| --- | --- | --- |
| 魔法装备拿带词缀的全名当底子 | 44 件里 13 件搜出空结果 | 没有一件装备的 `type` 是交易站不存在的底子 |
| 容差取整把小数值压成 `0` | `min: 0` 等于没筛 | 没有一条筛选的数值是 `0` |
| 默认按文本顺序勾前 N 条 | 影响力植入把真正的词缀挤掉 | 没有一件非传奇装备只勾中了植入词条 |

---

## 后端（就两个只读端点）

主体还是纯前端。后端只有一个 Cloudflare Worker，存在的理由是浏览器办不到的两件事：

| 端点 | 干什么 | 为什么非得有服务端 |
| --- | --- | --- |
| `GET /api/leagues` | 当前赛季列表和默认赛季 | 官网那个端点没有 CORS 头，浏览器直接读不到 |
| `GET /api/import?url=` | 从分享链接取回 PoB 代码 | 同上，跨域 |

赛季以前是手填的 `Allflame` —— 赛季一换，整站生成的链接全部失效。现在从官网的
`api/leagues` 取，`category.current` 是当前挑战赛季的权威标记（软核那条靠 `rules` 为空区分）。
那个端点按 IP 限流（`5:5:10,10:10:30,15:10:300`），一个 Worker 上所有用户共用出口 IP，
所以结果在边缘缓存一小时。

链接导入**锁死域名白名单**（目前是 pobb.in 和 pastebin）。一个能替调用方抓任意 URL
的端点就是个 SSRF 跳板，这条在 `test/worker.test.ts` 里有专门的用例盯着。
抓回来的内容不靠「看着像 base64」判断，而是**真解压出来看是不是 PoB 存档**，
所以返回给前端的一定是能用的代码。

**刻意不做的事**：不碰 GGG 的 trade API。不估价、不代查、不需要 OAuth，
因此没有限流队列、没有运维负担、没有合规风险。代价是这个工具告诉你要买哪些东西，
但不告诉你要花多少钱。

两个端点都是「有更好，没有也能用」：离线单文件版拿不到它们，赛季退回手填、
链接导入退回提示粘贴代码，其余功能一模一样。

---

## 已知限制

- **星团珠宝的小点词缀**（`Added Small Passive Skills grant: ...`）识别不了。
  它们的 id 带选项索引（`enchant.stat_3948993189|49`，索引表示具体是哪一条小点词缀），
  需要界面上能选，提取时直接跳过了。**这是下一步最值得补的一块。**
- **传奇的多行词条**会被拆成两行导致识别失败 —— 无影响，传奇按名字搜。
- **链接导入只支持 pobb.in 和 pastebin**。poe.ninja / pob.cool / poeplanner / maxroll
  这些站取不到原始代码，界面上会提示去点它们自己的「复制代码」按钮。
  离线单文件版没有后端，链接导入不可用。
- **数值方向只按正负判断**：负数（`-13 技能法力消耗`）越负越好，用上限 `max`；
  正数用下限 `min`。像「20% 增加属性需求」这种正数但越小越好的词条会填成下限，需要手动改。
  真要做对得有一份「哪些词条越小越好」的清单。
- 未识别的词条在界面上标红、勾选框禁用，**不会静默丢弃**。

---

## 从源码构建

需要 Node 20 以上。

```bash
npm install

npm run dev              # 前端开发服务器（没有 /api，赛季和链接导入自动降级）
npm run worker:dev       # 连 Worker 一起跑，本地就有 /api/leagues 和 /api/import
npm test                 # 单元 + 集成测试（113 个用例，不需要浏览器）
npm run build            # 产出 dist/
npm run build:single     # 再把一切压成根目录的 index.html
npm run deploy           # 部署到 Cloudflare（需要先 wrangler login）
```

两种产物，同一份源码：

| 产物 | 用途 | 大小 |
| --- | --- | --- |
| `dist/` + Worker | 部署上线。HTML 只有 2 KB，两张对照表当静态资源单独取，交给 CDN 缓存 | 584 KB（其中 569 KB 是可缓存的对照表） |
| `index.html` | 下载下来双击即用的离线版，对照表内联在页面里，不发任何网络请求 | 587 KB |

### 测试

```bash
npm test                 # 逻辑：解码、解析、匹配、查询组装（vitest，快）
npm run test:smoke       # dist/ 在真实 HTTP 下能不能跑起来（需要 Chrome/Edge）
npm run test:offline     # 单文件版在 file:// 下能不能跑起来（需要 Chrome/Edge）
```

三层各管一段：`npm test` 覆盖 `src/core/` 的全部逻辑，另外两个只验证它碰不到的
「页面真的启动得起来吗、对照表真的加载得到吗」—— 一个走 fetch 分支，一个走内联分支。

### 目录结构

```
.
├── index.html                  # build:single 的产物，双击即用（约 590 KB，别手改）
├── wrangler.jsonc              # Cloudflare Worker 配置
├── src/
│   ├── index.html              # Vite 入口
│   ├── main.ts                 # 页面装配：读控件、跑流程、报状态
│   ├── ui.ts                   # 卡片渲染和勾选状态
│   ├── api.ts                  # 跟自家 Worker 说话，取不到就降级
│   ├── data.ts                 # 两张对照表的加载（内联优先，否则 fetch）
│   ├── styles.css
│   └── core/                   # 纯逻辑，不碰 DOM，单测都打在这一层
│       ├── pob.ts              # 分享码解码（不碰 DOM，Worker 也复用它）
│       ├── build.ts            # build XML -> 装备清单（要 DOMParser）
│       ├── items.ts            # 物品文本解析
│       ├── stats.ts            # 词条文本 -> 交易站 stat id
│       ├── bases.ts            # 底子物品表
│       └── query.ts            # 容差、默认勾选、查询组装、URL
├── worker/
│   ├── index.ts                # 路由 + 边缘缓存 + CORS
│   ├── leagues.ts              # 赛季列表
│   └── import.ts               # 分享链接 -> PoB 代码（含域名白名单）
├── data/
│   ├── stat-lut.tsv            # 词条文本 -> stat hash + 命名空间（7,980 条）
│   └── bases.tsv               # 底子物品名 -> 类别（1,088 条）
├── tools/
│   ├── extract-lut.mjs         # 从官方 api/trade/data/stats 重建词条表
│   ├── extract-bases.mjs       # 从官方 api/trade/data/items 重建底子表
│   └── build-single.mjs        # 把 dist/ 压成单文件
├── test/
│   ├── *.test.ts               # vitest
│   ├── smoke.ps1               # dist/ 的浏览器冒烟测试
│   ├── offline.ps1             # 单文件版的浏览器冒烟测试
│   └── sample-build.pobcode    # 测试用 PoB 代码
└── docs/
    └── trade-api-notes.md      # 交易站查询格式笔记
```

### 赛季更新后

GGG 加了新词条或新底子时：

```bash
npm run data             # 从官方接口重建两张表
npm run build:single     # 重新构建
npm test
```

两张表都直接从官方 `api/trade/data/*` 拉，**不需要本地装 PoB**，所以这一步
可以放进定时任务自动跑。

界面上出现「底子没认出来」的红字，就是底子表该更新了。

---

## 数据来源与许可

本项目代码以 MIT 许可发布，见 [LICENSE](LICENSE)。

`data/stat-lut.tsv` 由 [Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding)
的 `Data/TradeSiteStats.lua` 提取而来，该文件本身是官方
`https://www.pathofexile.com/api/trade/data/stats` 的镜像。

> Path of Building Community — Copyright (c) 2016 David Gowor，MIT License。
> 完整许可见 [NOTICE](NOTICE)。

游戏数据版权归 Grinding Gear Games 所有。本项目与 GGG 无隶属关系。

---

## English summary

**PoB Shopping List Generator** — paste someone else's Path of Building export code,
get one official-trade-site search link per item.

This is the inverse of PoB's built-in trade feature: PoB weights candidate mods by how much
they'd improve *your* build (re-running the full calculation per mod), which is the right tool
for *upgrading your own gear*. This tool reads the *target* items' actual mods and generates
searches to *reproduce* them — with an adjustable tolerance, because buying an exact copy is
rarely affordable.

Single self-contained HTML file. No backend, no network calls, nothing uploaded.
Open `index.html` and paste a PoB code.

Measured on a 44-item build: 88% mod-recognition rate on rare/magic items, 100% on uniques
(matched by name + base type). Known gap: cluster-jewel `enchant.*` mods.
