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

1. 下载 `index.html`，双击用浏览器打开（Chrome / Edge / Firefox 均可）
2. 在别人的 PoB 里：`Import/Export` → `Generate` → 复制那串长字符
3. 粘进输入框 → 点「生成」

> **注意**：pobb.in / pob.cool 的**链接**不行，浏览器跨域读不到，必须粘贴**代码本身**。

### 界面上的四个全局参数

| 参数              | 说明                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| 赛季              | 写进 URL 路径，例如 `Allflame`、`Standard`                            |
| 挂单              | 对应交易站 `status`，默认「一口价」(`securable`)                      |
| **容差 %**        | 数值下限 = 原件数值 × 容差。默认 80% —— 原件 +134 生命就搜 ≥107      |
| 每件最多筛几条    | 稀有装备默认自动勾选前 N 条可识别词条，默认 4                         |

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

这是唯一有难度的一环。内嵌了 7,731 条对照表（`data/stat-lut.tsv`），**三级匹配**：

| 级别 | 做法                       | 解决的问题                                                      |
| ---- | -------------------------- | --------------------------------------------------------------- |
| 1    | 数字 → `#` 后精确匹配      | `+134 to maximum Life` → `+# to maximum Life`                    |
| 2    | 原文精确匹配               | `1 Added Passive Skill is Feed the Fury` —— 交易站保留字面数字   |
| 3    | 抽掉全部数字的规范键       | `8% chance to gain Phasing for 4 seconds on Kill` —— 混合型      |
| 3b   | 单复数容错                 | `Has 1 Abyssal Socket` ↔ `Has # Abyssal Sockets`                 |

只用第 1 级时未识别 56 条；加到三级后降到 18 条。
第 3 级规范键的碰撞率实测 **39 / 7731 = 0.5%**，碰撞的基本都是「本地 vs 全局格挡」这类本就有歧义的词条。

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
稀有/魔法词条 : 154
未识别        : 18
识别率        : 88%
生成的链接数  : 44
```

传奇装备识别率视作 100% —— 它们按名字 + 底子搜，词条识别与否不影响结果。

---

## 已知限制

- **星团珠宝的小点词缀**（`Added Small Passive Skills grant: ...`）识别不了。
  它们在交易站属于 `enchant.*` 类型且带选项索引，当前对照表只收了 `explicit` / `implicit` / `fractured`。
  **这是下一步最值得补的一块。**
- **药剂附魔**（`Used when Charges reach full`）同上，不过本来也没必要搜。
- **传奇的多行词条**会被拆成两行导致识别失败 —— 无影响，传奇按名字搜。
- 只支持粘贴代码，**不支持直接吃 pobb.in 链接**（浏览器同源策略）。想支持得加一个转发用的后端或浏览器扩展。
- 未识别的词条在界面上标红、勾选框禁用，**不会静默丢弃**。

---

## 从源码构建

```bash
# 1) 从本地 PoB 安装目录提取词条对照表
tools/extract-lut.sh "/d/Path of Building Community"

# 2) 把对照表注入模板，产出 index.html
./build.sh

# 3) 无头回归测试（需要装了 Chrome 或 Edge）
powershell -ExecutionPolicy Bypass -File test/headless-test.ps1
```

### 目录结构

```
.
├── index.html                  # 构建产物，可直接双击（约 550 KB）
├── build.sh                    # 注入对照表 → index.html
├── src/
│   └── app.template.html       # 应用本体，含 __LUT__ 占位符
├── data/
│   └── stat-lut.tsv            # 词条文本 -> 交易站 stat hash（7,731 条）
├── tools/
│   └── extract-lut.sh          # 从 PoB 的 TradeSiteStats.lua 重新生成对照表
├── test/
│   ├── headless-test.ps1       # 无头回归测试
│   └── sample-build.pobcode    # 测试用 PoB 代码
└── docs/
    └── trade-api-notes.md      # 交易站查询格式笔记
```

改代码请改 `src/app.template.html`，**不要直接改 `index.html`**（会被下次构建覆盖）。

### 赛季更新后

GGG 加了新词条时，重跑第 1、2 步即可：先更新 PoB 到最新版，再执行 `extract-lut.sh` + `build.sh`。

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
