<#
  浏览器冒烟测试：起一个静态服务器跑 dist/，用 Chrome/Edge 无头加载真实页面，
  喂进 test/sample-build.pobcode，确认它真的跑得起来。

  逻辑本身由 vitest 覆盖（npm test）。这里只验证 vitest 碰不到的那一层：
  页面能不能启动、两张对照表 fetch 得到吗、卡片渲染得出来吗、链接生成得对吗。

  用法：  npm run build; powershell -ExecutionPolicy Bypass -File test\smoke.ps1
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$sample = Join-Path $PSScriptRoot 'sample-build.pobcode'
$port = 4173

if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "缺少 dist/ —— 先跑 npm run build" }
if (-not (Test-Path $sample)) { throw "缺少 test/sample-build.pobcode" }

$browser = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "没找到 Chrome 或 Edge" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $node)) { throw "没找到 node" }

# 页面在真实 HTTP 下才 fetch 得到对照表（file:// 会被 CORS 拦掉），
# 所以起一个只会读 dist/ 的最小静态服务器。
$serverJs = Join-Path $env:TEMP ("pobshop-serve-" + [guid]::NewGuid().ToString('N') + ".mjs")
$serverSrc = @'
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const dist = process.argv[2];
const port = Number(process.argv[3]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.tsv': 'text/tab-separated-values' };

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(dist, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[\\/])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log('ready'));
'@
Set-Content $serverJs -Value $serverSrc -Encoding utf8

$code = (Get-Content $sample -Raw).Trim()
$page = Get-Content (Join-Path $dist 'index.html') -Raw -Encoding utf8

$harness = @"
<script id="TC" type="text/plain">$code</script>
<pre id="R">PENDING</pre>
<script type="module">
(async function(){
  var out = function(o){ document.getElementById('R').textContent = JSON.stringify(o); };
  try{
    // Wait for the stat tables - the Build button is enabled once they load
    var go = document.getElementById('go');
    for (var i = 0; i < 200 && go.disabled; i++) await new Promise(function(r){ setTimeout(r, 50); });
    if (go.disabled) return out({error: 'tables never loaded: ' + document.getElementById('status').textContent});

    document.getElementById('code').value = document.getElementById('TC').textContent.trim();
    go.click();
    for (var j = 0; j < 200 && document.querySelectorAll('.card').length === 0; j++) {
      await new Promise(function(r){ setTimeout(r, 50); });
    }

    // The embedded base table is the authority for checking generated types
    var known = {};
    (await (await fetch('bases.tsv')).text()).split('\n').forEach(function(l){
      var n = l.split('\t')[0];
      if (n) known[n] = 1;
    });

    var cards = document.querySelectorAll('.card');
    var urls = 0, badType = 0;
    cards.forEach(function(c){
      var o = window.open, u = null;
      window.open = function(x){ u = x; };
      c.querySelector('.acts button').click();
      window.open = o;
      if (!u || u.indexOf('https://www.pathofexile.com/trade/search/') !== 0) return;
      urls++;
      var q = JSON.parse(decodeURIComponent(u.split('?q=')[1])).query;
      if (q.type && !known[q.type]) badType++;
    });

    // The UI is English now - no CJK should survive into the rendered page.
    var pageText = document.body.innerText;
    var cjk = 0, cjkSample = "";
    for (var k = 0; k < pageText.length; k++) {
      var code = pageText.charCodeAt(k);
      if (code >= 0x4e00 && code <= 0x9fff) {
        cjk++;
        if (!cjkSample) cjkSample = pageText.slice(Math.max(0, k - 20), k + 30);
      }
    }

    out({ cards: cards.length, urls: urls, badType: badType, cjk: cjk, cjkSample: cjkSample,
          status: document.getElementById('status').textContent.slice(0, 60) });
  }catch(e){ out({error: String(e)}); }
})();
</script>
"@

$smoke = Join-Path $dist '__smoke.html'
Set-Content $smoke -Value ($page -replace '</body>', ($harness + "`n</body>")) -Encoding utf8

$srvOut = Join-Path $env:TEMP ("pobshop-srv-" + [guid]::NewGuid().ToString('N') + ".log")
$domOut = Join-Path $env:TEMP ("pobshop-dom-" + [guid]::NewGuid().ToString('N') + ".html")
$errOut = Join-Path $env:TEMP ("pobshop-err-" + [guid]::NewGuid().ToString('N') + ".log")
$server = $null
try {
  $server = Start-Process -FilePath $node -ArgumentList @($serverJs, $dist, $port) `
                          -NoNewWindow -PassThru -RedirectStandardOutput $srvOut -RedirectStandardError $errOut

  $up = $false
  foreach ($i in 1..50) {
    try {
      Invoke-WebRequest "http://127.0.0.1:$port/index.html" -UseBasicParsing -TimeoutSec 2 | Out-Null
      $up = $true; break
    } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $up) { throw "静态服务器没起来，看 $srvOut" }

  Start-Process -FilePath $browser -NoNewWindow -Wait `
    -ArgumentList @('--headless=new','--disable-gpu','--no-sandbox',
                    '--virtual-time-budget=30000','--dump-dom',
                    "http://127.0.0.1:$port/__smoke.html") `
    -RedirectStandardOutput $domOut -RedirectStandardError $errOut | Out-Null
  $dom = Get-Content $domOut -Raw -Encoding utf8
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $smoke, $serverJs, $srvOut, $domOut, $errOut -ErrorAction SilentlyContinue
}

if ($dom -notmatch '(?s)<pre id="R">(.*?)</pre>') { throw "没拿到测试结果，页面可能没渲染" }
$r = [System.Net.WebUtility]::HtmlDecode($matches[1]) | ConvertFrom-Json
if ($r.error) { throw "页面报错: $($r.error)" }

Write-Host "渲染出的卡片   : $($r.cards)"
Write-Host "生成的链接数   : $($r.urls)"
Write-Host "底子不存在的   : $($r.badType)"
Write-Host "残留的汉字     : $($r.cjk)$(if ($r.cjk -gt 0) { "  ->  $($r.cjkSample)" })"
Write-Host "状态栏         : $($r.status)"

$fail = @()
if ($r.cards -lt 40)      { $fail += "卡片数 < 40" }
if ($r.urls -ne $r.cards) { $fail += "链接数与卡片数不符" }
if ($r.badType -ne 0)     { $fail += "有 $($r.badType) 件装备的 type 不是合法底子" }
if ($r.cjk -ne 0)         { $fail += "界面上还有 $($r.cjk) 个汉字没翻译" }

if ($fail.Count) { Write-Host "`nFAIL: $($fail -join '; ')" -ForegroundColor Red; exit 1 }
Write-Host "`nPASS" -ForegroundColor Green
