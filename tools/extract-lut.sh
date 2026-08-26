#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 从本地 Path of Building Community 安装目录提取「词条文本 -> 交易站 stat」
# 对照表，输出到 data/stat-lut.tsv
#
# 数据来源：PoB 的 Data/TradeSiteStats.lua，它本身是官方
#           https://www.pathofexile.com/api/trade/data/stats 的镜像。
#
# 输出三列：  文本 \t hash \t 可用的命名空间（逗号分隔）
#
# 为什么要第三列：交易站的 stat id 形如 <命名空间>.stat_<hash>，
# 而**不是每个 hash 在每个命名空间里都存在**。星团珠宝的
# 「Adds # Passive Skills」只有 explicit 和 enchant 两种，没有 implicit；
# 早期版本按词条在物品文本里的位置盲目拼前缀，拼出 implicit.stat_3086156145
# 这种不存在的 id，交易站上显示成 "Unavailable Stat"，还不报错。
#
# 用法：
#   tools/extract-lut.sh "/d/Path of Building Community"
#   tools/extract-lut.sh                 # 不带参数时用下面的默认路径
# ---------------------------------------------------------------------------
set -euo pipefail

POB_DIR="${1:-/d/Path of Building Community}"
SRC="$POB_DIR/Data/TradeSiteStats.lua"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
OUT="$OUT_DIR/stat-lut.tsv"

if [[ ! -f "$SRC" ]]; then
  echo "找不到 $SRC" >&2
  echo "请把 PoB 安装目录作为第一个参数传进来，例如：" >&2
  echo "  $0 \"/d/Path of Building Community\"" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# TradeSiteStats.lua 里成对出现：
#   ["id"]   = "explicit.stat_3299347043",
#   ["text"] = "+# to maximum Life",
awk '
  /\["id"\] = "/   { id=$0; sub(/^[^"]*"id"\] = "/,"",id);   sub(/",?$/,"",id) }
  /\["text"\] = "/ { t=$0;  sub(/^[^"]*"text"\] = "/,"",t);  sub(/",?$/,"",t)
                     if (id != "") { print id "\t" t; id="" } }
' "$SRC" \
| awk -F'\t' '
    # 只留装备上真会出现的命名空间。带 | 的是「一个 id + 选项索引」结构
    # （比如具体是哪条星团小点词缀），需要界面上能选，暂不支持。
    $1 ~ /^(explicit|implicit|fractured|enchant|crafted)[.]stat_[0-9]+$/ {
      ns = $1; sub(/[.]stat_.*$/,"",ns)
      h  = $1; sub(/^[a-z]+[.]stat_/,"",h)
      # 过长的多为地图/传奇专属整段文本，装备词条匹配用不上
      if (length($2) <= 110 && $2 != "") print $2 "\t" ns "\t" h
    }' \
| sort -u \
| awk -F'\t' '
    # 同一段文本可能对应多个 hash（Adds # Passive Skills 就有两个）。
    # 取「支持的命名空间最多」的那个 hash —— 它覆盖面最广，最可能是
    # 玩家真正想搜的那一条。
    {
      key = $1 SUBSEP $3
      if (key in ns) { ns[key] = ns[key] "," $2; n[key]++ }
      else           { ns[key] = $2;             n[key] = 1; }
      if (n[key] > best[$1]) { best[$1] = n[key]; hash[$1] = $3 }
    }
    END {
      for (t in hash) {
        k = t SUBSEP hash[t]
        # 固定命名空间顺序，让产物可复现，也让运行时的兜底顺序确定
        out = ""
        split("explicit,implicit,fractured,enchant,crafted", order, ",")
        for (i = 1; i <= 5; i++) {
          if (index("," ns[k] ",", "," order[i] ",") > 0) {
            out = (out == "" ? order[i] : out "," order[i])
          }
        }
        print t "\t" hash[t] "\t" out
      }
    }' \
| sort \
> "$OUT"

echo "已写出 $OUT"
echo "  条目数：$(wc -l < "$OUT")"
echo "  字节数：$(wc -c < "$OUT")"
echo "  含 enchant 的条目：$(awk -F'\t' '$3 ~ /enchant/' "$OUT" | wc -l)"
