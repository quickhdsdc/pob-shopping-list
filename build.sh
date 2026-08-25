#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 把 data/stat-lut.tsv 注入 src/app.template.html，产出可直接双击打开的 index.html
#
# 用法：  ./build.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TPL="$ROOT/src/app.template.html"
LUT="$ROOT/data/stat-lut.tsv"
OUT="$ROOT/index.html"

[[ -f "$TPL" ]] || { echo "缺少 $TPL" >&2; exit 1; }
[[ -f "$LUT" ]] || { echo "缺少 $LUT —— 先跑 tools/extract-lut.sh" >&2; exit 1; }

# 模板里的 __LUT__ 占位符整行替换成 <script id="lut"> + 表内容 + </script>。
# 注意闭合标签必须拼接写出，否则 awk 脚本自身会被 HTML 解析器截断。
awk -v LUT="$LUT" '
  /__LUT__/ {
    print "<script id=\"lut\" type=\"text/plain\">"
    while ((getline line < LUT) > 0) print line
    print "</scr" "ipt>"
    next
  }
  { print }
' "$TPL" > "$OUT"

if grep -q '__LUT__' "$OUT"; then
  echo "注入失败：占位符仍在" >&2
  exit 1
fi

echo "已构建 $OUT"
echo "  对照表条目：$(wc -l < "$LUT")"
echo "  产物字节数：$(wc -c < "$OUT")"
