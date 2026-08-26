<#
  离线单文件测试：用 file:// 加载仓库根目录的 index.html（npm run build:single 的产物），
  确认「下载下来双击就能用」这条路还通 —— 两张对照表内联在页面里，不发任何网络请求。

  这一条是 vitest 和 test/smoke.ps1 都覆盖不到的：smoke.ps1 跑的是 HTTP 下的
  dist/，走的是 fetch 分支；这里走的是内联分支。

  用法：  npm run build:single; powershell -ExecutionPolicy Bypass -File test\offline.ps1
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$index = Join-Path $root 'index.html'
$sample = Join-Path $PSScriptRoot 'sample-build.pobcode'

if (-not (Test-Path $index))  { throw "缺少 index.html —— 先跑 npm run build:single" }
if (-not (Test-Path $sample)) { throw "缺少 test/sample-build.pobcode" }

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
<script type="module">
(async function(){
  var out = function(o){ document.getElementById('R').textContent = JSON.stringify(o); };
  try{
    var go = document.getElementById('go');
    for(var i = 0; i < 200 && go.disabled; i++) await new Promise(function(r){ setTimeout(r, 50); });
    if(go.disabled) return out({error: 'tables never loaded: ' + document.getElementById('status').textContent});

    document.getElementById('code').value = document.getElementById('TC').textContent.trim();
    go.click();
    for(var j = 0; j < 200 && document.querySelectorAll('.card').length === 0; j++) {
      await new Promise(function(r){ setTimeout(r, 50); });
    }

    var cards = document.querySelectorAll('.card'), urls = 0;
    cards.forEach(function(c){
      var o = window.open, u = null;
      window.open = function(x){ u = x; };
      c.querySelector('.acts button').click();
      window.open = o;
      if(u && u.indexOf('https://www.pathofexile.com/trade/search/') === 0) urls++;
    });
    out({ cards: cards.length, urls: urls,
          status: document.getElementById('status').textContent.slice(0, 60) });
  }catch(e){ out({error: String(e)}); }
})();
</script>
"@

$tmp = Join-Path $env:TEMP ("pobshop-offline-" + [guid]::NewGuid().ToString('N') + ".html")
Set-Content $tmp -Value ($html -replace '</body>', ($harness + "`n</body>")) -Encoding utf8

# Chrome 会往 stderr 写无害的警告，PowerShell 在 $ErrorActionPreference='Stop' 下
# 会把它包成 NativeCommandError 直接终止脚本，所以用 Start-Process 落盘。
$domOut = Join-Path $env:TEMP ("pobshop-dom-" + [guid]::NewGuid().ToString('N') + ".html")
$errOut = Join-Path $env:TEMP ("pobshop-err-" + [guid]::NewGuid().ToString('N') + ".log")
try {
  Start-Process -FilePath $browser -NoNewWindow -Wait `
    -ArgumentList @('--headless=new','--disable-gpu','--no-sandbox',
                    '--virtual-time-budget=30000','--dump-dom',
                    ("file:///" + $tmp.Replace('\','/'))) `
    -RedirectStandardOutput $domOut -RedirectStandardError $errOut | Out-Null
  $dom = Get-Content $domOut -Raw -Encoding utf8
} finally {
  Remove-Item $tmp, $domOut, $errOut -ErrorAction SilentlyContinue
}

if ($dom -notmatch '(?s)<pre id="R">(.*?)</pre>') { throw "没拿到测试结果，页面可能没渲染" }
$r = [System.Net.WebUtility]::HtmlDecode($matches[1]) | ConvertFrom-Json
if ($r.error) { throw "页面报错: $($r.error)" }

Write-Host "渲染出的卡片 : $($r.cards)"
Write-Host "生成的链接数 : $($r.urls)"
Write-Host "状态栏       : $($r.status)"

$fail = @()
if ($r.cards -lt 40)      { $fail += "卡片数 < 40" }
if ($r.urls -ne $r.cards) { $fail += "链接数与卡片数不符" }

if ($fail.Count) { Write-Host "`nFAIL: $($fail -join '; ')" -ForegroundColor Red; exit 1 }
Write-Host "`nPASS" -ForegroundColor Green
