#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 从本地 Path of Building Community 安装目录提取「词条文本 -> 交易站 stat hash」
# 对照表，输出到 data/stat-lut.tsv
#
# 数据来源：PoB 的 Data/TradeSiteStats.lua，它本身是官方
#           https://www.pathofexile.com/api/trade/data/stats 的镜像。
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
# 抽出 (id, text)，只保留 explicit / implicit / fractured 三类（装备上真会出现的），
# 去掉 stat 前缀只留 hash —— 这三类共用同一个 hash，运行时按词条所在区段补前缀。
awk '
  /\["id"\] = "/   { id=$0; sub(/^[^"]*"id"\] = "/,"",id);   sub(/",?$/,"",id) }
  /\["text"\] = "/ { t=$0;  sub(/^[^"]*"text"\] = "/,"",t);  sub(/",?$/,"",t)
                     if (id != "") { print id "\t" t; id="" } }
' "$SRC" \
| awk -F'\t' '
    $1 ~ /^(explicit|implicit|fractured)[.]stat_/ {
      h=$1; sub(/^[a-z]+[.]stat_/,"",h)
      # 过长的多为地图/传奇专属整段文本，装备词条匹配用不上
      if (length($2) <= 110 && $2 != "") print $2 "\t" h
    }' \
| sort -u \
| awk -F'\t' '!seen[$1]++' \
> "$OUT"

echo "已写出 $OUT"
echo "  条目数：$(wc -l < "$OUT")"
echo "  字节数：$(wc -c < "$OUT")"
