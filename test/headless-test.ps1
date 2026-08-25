<#
  无头回归测试：用 Chrome/Edge 渲染 index.html，喂进 test/sample-build.pobcode，
  断言解析结果达标（装备数、词条识别率、链接可生成）。

  用法：  powershell -ExecutionPolicy Bypass -File test\headless-test.ps1
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$index = Join-Path $root 'index.html'
$sample = Join-Path $PSScriptRoot 'sample-build.pobcode'

if (-not (Test-Path $index))  { throw "缺少 index.html —— 先跑 ./build.sh" }
if (-not (Test-Path $sample)) { throw "缺少 test/sample-build.pobcode" }

# 找一个 Chromium 内核浏览器
$browser = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "没找到 Chrome 或 Edge" }

$code = (Get-Content $sample -Raw).Trim()
$html = Get-Content $index -Raw -Encoding utf8

$harness = @"
<script id="TC" type="text/plain">$code</script>
<pre id="R">PENDING</pre>
<script>
(async function(){
  try{
    document.getElementById('code').value = document.getElementById('TC').textContent.trim();
    await window.__run();
    await new Promise(function(r){ setTimeout(r, 600); });
    var cards = document.querySelectorAll('.card');
    var bad = 0, tot = 0, urls = 0;
    cards.forEach(function(c){
      var isU = c.querySelector('.iname').className.indexOf('U') >= 0;
      if(!isU){ bad += c.querySelectorAll('td.txt.nomatch').length;
                tot += c.querySelectorAll('td.txt').length; }
      var o = window.open, u = null;
      window.open = function(x){ u = x; };
      c.querySelector('.acts button').click();
      window.open = o;
      if(u && u.indexOf('https://www.pathofexile.com/trade/search/') === 0) urls++;
    });
    document.getElementById('R').textContent = JSON.stringify({
      cards: cards.length, modsNonUnique: tot, unmatched: bad, urls: urls
    });
  }catch(e){ document.getElementById('R').textContent = JSON.stringify({error: e.message}); }
})();
</script>
"@

$tmp = Join-Path $env:TEMP ("pobshop-test-" + [guid]::NewGuid().ToString('N') + ".html")
Set-Content $tmp -Value ($html -replace '</body>', ($harness + "`n</body>")) -Encoding utf8

# 注意：不要用 `& $browser ... 2>$null | Out-String`。
# Chrome 会往 stderr 写无害的扩展加载警告，PowerShell 会把它包成 NativeCommandError，
# 在 $ErrorActionPreference='Stop' 下直接终止脚本。用 Start-Process 落盘最稳。
$outFile = Join-Path $env:TEMP ("pobshop-dom-" + [guid]::NewGuid().ToString('N') + ".html")
$errFile = Join-Path $env:TEMP ("pobshop-err-" + [guid]::NewGuid().ToString('N') + ".log")
try {
  $uri = "file:///" + $tmp.Replace('\','/')
  $args = @('--headless=new','--disable-gpu','--no-sandbox',
            '--virtual-time-budget=25000','--dump-dom', $uri)
  Start-Process -FilePath $browser -ArgumentList $args -NoNewWindow -Wait `
                -RedirectStandardOutput $outFile -RedirectStandardError $errFile | Out-Null
  $dom = Get-Content $outFile -Raw -Encoding utf8
} finally {
  Remove-Item $tmp, $outFile, $errFile -ErrorAction SilentlyContinue
}

if ($dom -notmatch '(?s)<pre id="R">(.*?)</pre>') { throw "没拿到测试结果，页面可能没渲染" }
$json = [System.Net.WebUtility]::HtmlDecode($matches[1])
$r = $json | ConvertFrom-Json

if ($r.error) { throw "页面 JS 报错: $($r.error)" }

$rate = [math]::Round((1 - $r.unmatched / $r.modsNonUnique) * 100)
Write-Host "装备数        : $($r.cards)"
Write-Host "稀有/魔法词条 : $($r.modsNonUnique)"
Write-Host "未识别        : $($r.unmatched)"
Write-Host "识别率        : $rate%"
Write-Host "生成的链接数  : $($r.urls)"

$fail = @()
if ($r.cards -lt 40)          { $fail += "装备数 < 40" }
if ($r.urls -ne $r.cards)     { $fail += "链接数与装备数不符" }
if ($rate -lt 80)             { $fail += "识别率 < 80%" }

if ($fail.Count) { Write-Host "`nFAIL: $($fail -join '; ')" -ForegroundColor Red; exit 1 }
Write-Host "`nPASS" -ForegroundColor Green
