#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 从本地 Path of Building Community 安装目录提取「底子物品名 -> 类别」对照表，
# 输出到 data/bases.tsv
#
# 用途有两个：
#   1) 魔法装备的名字是「前缀 + 底子 + of 后缀」，交易站的 type 只认底子。
#      有了这张表才能从 "Flagellant's Quicksilver Flask of Incision" 里
#      还原出 "Quicksilver Flask"。
#   2) type / subType 可以映射成交易站的 type_filters.category。
#
# 数据来源：PoB 的 Data/Bases/*.lua（GGG 物品数据的镜像）。
#
# 用法：
#   tools/extract-bases.sh "/d/Path of Building Community"
#   tools/extract-bases.sh                 # 不带参数时用下面的默认路径
# ---------------------------------------------------------------------------
set -euo pipefail

POB_DIR="${1:-/d/Path of Building Community}"
SRC_DIR="$POB_DIR/Data/Bases"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
OUT="$OUT_DIR/bases.tsv"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "找不到 $SRC_DIR" >&2
  echo "请把 PoB 安装目录作为第一个参数传进来，例如：" >&2
  echo "  $0 \"/d/Path of Building Community\"" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Bases/*.lua 的形状：
#   itemBases["Small Life Flask"] = {
#       type = "Flask",
#       subType = "Life",
#   ...
# 每条底子取 name / type / subType 三个字段，遇到下一个 itemBases[...] 就落盘。
awk '
  function flush(){
    if (name != "") print name "\t" type "\t" sub_
    name=""; type=""; sub_=""
  }
  /^itemBases\[/ {
    flush()
    line=$0
    sub(/^itemBases\["/,"",line); sub(/"\].*$/,"",line)
    name=line
    next
  }
  name != "" && /^[ \t]*type = "/    { t=$0; sub(/^[^"]*"/,"",t); sub(/".*$/,"",t); type=t; next }
  name != "" && /^[ \t]*subType = "/ { t=$0; sub(/^[^"]*"/,"",t); sub(/".*$/,"",t); sub_=t; next }
  END { flush() }
' "$SRC_DIR"/*.lua \
| awk -F'\t' '$1 != "" && $2 != ""' \
| sort -u \
| awk -F'\t' '!seen[$1]++' \
> "$OUT"

echo "已写出 $OUT"
echo "  条目数：$(wc -l < "$OUT")"
echo "  字节数：$(wc -c < "$OUT")"
