# 交易站查询格式笔记

这些是实现过程中从 Path of Building Community 源码和官方 API 里核实过的细节，
记下来省得下次再翻一遍。

## 数据从哪来：只信官方端点

两张对照表都从官方拉，**不要从 PoB 的 `Data/TradeSiteStats.lua` 提取**：

| 表 | 端点 |
| --- | --- |
| 词条 -> stat id | `https://www.pathofexile.com/api/trade/data/stats` |
| 底子物品 | `https://www.pathofexile.com/api/trade/data/items` |

PoB 那份文件是这个接口的镜像，**会过期**。实测它缺了
`While a Pinnacle Atlas Boss is in your Presence, #% chance to Unnerve Enemies for 4 seconds on Hit`
（官方有 `implicit.stat_4018420421`），界面上标红说识别不了，实际交易站搜得到。
官方 18183 条 stat，筛掉带选项索引和过长的之后剩 7980 条。

底子表同理：`items` 端点里 `name` 为空的条目就是底子，**那里的名字就是交易站
真正接受的 `type`**。PoB 的 `Data/Bases/*.lua` 里有 `Energy Blade One Handed`
这种内部命名，写进 `type` 搜不出任何东西。

另外这两个端点都不需要认证，所以数据更新可以放进定时任务，不依赖本地装没装 PoB。

---

## URL 形状

```
https://www.pathofexile.com/trade/search/<赛季>?q=<urlencode(JSON)>
```

来源：`Classes/TradeQuery.lua`

```lua
local encodedUrl = s_format("https://www.pathofexile.com/trade/search/%s?q=%s",
                            self.pbLeague, urlEncode(exactQueryStr))
```

赛季名要用**英文**原名（`Allflame`、`Standard`、`Hardcore`…）。

实测 Chrome 地址栏能吃下约 32 KB 的 URL，塞 164 个筛选项编码后约 10 KB，安全。

---

## `status`：挂单类型

界面选项和 API 值的对应关系，来自 `Classes/TradeQuery.lua` 与 `Classes/TradeQueryGenerator.lua`
里两个同名数组的**下标一一对应**：

| 交易站界面                  | API 值          |
| --------------------------- | --------------- |
| Instant buyout（一口价）    | `securable`     |
| 一口价 + 当面交易           | `available`     |
| 在线（本赛季）              | `onlineleague`  |
| 在线（全部）                | `online`        |
| 全部（含离线）              | `any`           |

---

## 三种 stat 组

`query.stats` 是一个数组，每个元素是一组筛选，**组与组之间是「且」**。

### `and` —— 全部必须命中

```jsonc
{ "type": "and", "filters": [
    { "id": "explicit.stat_3299347043", "value": { "min": 110 } }
]}
```

### `count` —— N 个里至少命中 M 个

```jsonc
{ "type": "count", "value": { "min": 2 }, "filters": [ /* 候选 */ ] }
```

用于「随机词条」类物品。两组 `count` 可以叠：
一组要求「至少 1 个高价值词条」，另一组要求「两条都在有用清单里」。
**第二组的清单要包含第一组**，否则「两条都是高价值」的极品会被误排除。

### `weight` —— 加权排序

```jsonc
{ "type": "weight", "value": { "min": 150 }, "filters": [
    { "id": "explicit.stat_3299347043", "value": { "weight": 3 } }
]}
```

配套要改排序和引擎：

```jsonc
"sort":   { "statgroup.0": "desc" },
"engine": "new"
```

得分 = **权重 × 词条实际数值**。所以权重要按「每一点值多少」定，
否则 `+40 生命`（数值 40）会碾压 `+12% 暴伤`（数值 12）。

PoB 自己的权重来自 `TradeQueryGenerator.lua`：

```lua
local meanStatDiff = WeightedRatioOutputs(baseOutput, output, statWeights) * 1000 - baseStatValue
```

即**把候选词条塞进 build 重算一遍**，用真实的 DPS/EHP 差值当权重。
可选的优化目标共 50 个，见 `Modules/Data.lua` 的 `data.powerStatList`。

---

## `filters` 里的非词条条件

```jsonc
"filters": {
  "type_filters": { "filters": {
      "category": { "option": "armour.boots" },
      "rarity":   { "option": "nonunique" }
  }},
  "misc_filters": { "filters": {
      "corrupted":     { "option": "true" },
      "intangibility": { "max": 10 }
  }}
}
```

分类字符串来自 `Classes/TradeHelpers.lua` 的 `getTradeCategory`：

```
armour.chest / armour.helmet / armour.gloves / armour.boots / armour.shield / armour.quiver
accessory.amulet / accessory.ring / accessory.belt
weapon.bow / weapon.staff / weapon.oneaxe / weapon.twoaxe / weapon.wand / weapon.dagger / weapon.claw …
jewel / jewel.abyss / jewel.base
```

`misc_filters.intangibility`（Allflame 赛季的物品属性，min/max 数值型）
是查官方 `https://www.pathofexile.com/api/trade/data/filters` 得到的，
PoB 的数据文件里没有这个筛选项。

**想确认某个筛选叫什么，直接查那个 filters 端点**，它是权威来源。

---

## 带选项索引的 stat

有些 stat 是「一个 id + 一个选项」的结构，id 形如：

```
explicit.stat_4089743927|2|131
                        │ └── 选项：具体是哪个辅助宝石（131 = Trinity）
                        └──── 变体：1 头盔 / 2 手套 / 3 鞋子 / 4 天赋树
```

这类词条**槽位也是随机的**，抄配装时要注意匹配正确的变体，
否则会买到「辅助头盔内技能」而你的技能在手套里。

---

## 值的取法

- 单个数值：直接用
- `Adds A to B` 这种两个数：**交易站按平均值筛**，所以填 `(A+B)/2`
- 混合型 `8% chance to ... for 4 seconds`：只有一部分数字是变量。
  用对照表文本反推正则按位置捕获，不能简单取所有数字的平均。

---

## 命名空间前缀：不能靠猜

stat id 的形状是 `<命名空间>.stat_<hash>`。很多词条确实是几个命名空间共用一个
hash，只换前缀：

```
explicit.stat_3527617737   Has # Abyssal Sockets
implicit.stat_3527617737   Has # Abyssal Sockets
fractured.stat_3527617737  Has # Abyssal Sockets
```

**但不是每个 hash 在每个命名空间里都存在**，这一点最早被我漏掉，代价是一个
线上 bug：

```
Adds # Passive Skills   ->  explicit.stat_3086156145   ✓ 存在
                            enchant.stat_3086156145    ✓ 存在
                            implicit.stat_3086156145   ✗ 不存在
```

星团珠宝的「Adds 5 Passive Skills」写在物品文本的 `Implicits:` 区段里。按位置
拼前缀就拼出了 `implicit.stat_3086156145` —— 交易站**不报错**，只是把这条筛选
显示成 "Unavailable Stat"，然后整个搜索的结果就不对了。这种错比搜不到更难发现。

所以对照表存三列：`文本 	 hash 	 该 hash 实际支持的命名空间`。运行时按词条
位置猜一个（植入区段猜 `implicit`，其余猜 `explicit`），**猜的那个不在支持列表里
就退到 `enchant`** —— 物品文本的植入区段里除了真植入词条，还塞着附魔：

| 写在 `Implicits:` 区段里，但交易站算 enchant | 出现在 |
| --- | --- |
| `Adds # Passive Skills` | 星团珠宝 |
| `Used when Charges reach full` | 药剂附魔 |

`test/stats.test.ts` 里有一条不变式测试，把对照表**每一条**词条在两种位置下都跑
一遍，断言生成的 `命名空间.hash` 组合真实存在。

### 带选项索引的还是不支持

`enchant.stat_3948993189|5` 这种「一个 id + 选项索引」的结构（具体是哪条星团小点
词缀）需要界面上能选，提取时直接跳过了。星团珠宝的
`Added Small Passive Skills grant: ...` 至今识别不了，就是这个原因。
