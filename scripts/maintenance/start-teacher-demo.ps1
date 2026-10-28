$ErrorActionPreference = 'Stop'
$demoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoDir = Join-Path $demoRoot 'data/demo'
$demoStatePath = Join-Path $demoDir 'tunnel-state.json'
$demoBinary = Join-Path $demoRoot 'data/tools/cloudflared-2026.10.0.exe'
$demoHashExpected = '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'

function Test-DemoEndpoint([string]$url) {
    # Windows curl uses the normal TLS certificate checks. Do not use -k.
    $demoStatus = & curl.exe --silent --max-time 10 --output NUL --write-out '%{http_code}' ($url + '/api/health/live')
    $script:demoLastHttpStatus = [string]$demoStatus
    $script:demoLastCurlExit = $LASTEXITCODE
    return ($LASTEXITCODE -eq 0 -and $demoStatus -eq '200')
}

& (Join-Path $PSScriptRoot 'start-local-access.ps1')
if (-not (Test-Path -LiteralPath $demoBinary)) {
    throw '缺少已校验的 cloudflared 工具，请先完成演示工具安装。'
}
if ((Get-FileHash -LiteralPath $demoBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $demoHashExpected) {
    throw 'cloudflared SHA-256 校验失败，未启动公网分享。'
}
New-Item -ItemType Directory -Path $demoDir -Force | Out-Null

if (Test-Path -LiteralPath $demoStatePath) {
    $demoPrevious = Get-Content -LiteralPath $demoStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $demoExisting = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoPrevious.processId)" -ErrorAction SilentlyContinue
    if ($demoExisting -and $demoExisting.ExecutablePath -eq $demoBinary -and $demoExisting.CreationDate.ToUniversalTime().ToString('o') -eq $demoPrevious.createdAt) {
        if (-not (Test-DemoEndpoint $demoPrevious.url)) { throw '已记录的演示隧道暂不可访问，请检查网络或停止后重新启动。' }
        Write-Output "老师演示链接已运行：$($demoPrevious.url)"
        Write-Output "普通账号文件：$(Join-Path $demoDir 'teacher-access.txt')"
        return
    }
}

& node (Join-Path $PSScriptRoot 'prepare-teacher-account.cjs')
if ($LASTEXITCODE -ne 0) { throw '普通演示账号准备失败，未开启公网分享。' }

$demoOut = Join-Path $demoDir 'tunnel.out.log'
$demoErr = Join-Path $demoDir 'tunnel.err.log'
$demoArguments = @('--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:8090', '--protocol', 'auto')
$demoProcess = Start-Process -FilePath $demoBinary -ArgumentList $demoArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $demoOut -RedirectStandardError $demoErr
$demoStarted = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoProcess.Id)"
try {
    $demoUrl = $null
    for ($demoAttempt = 0; $demoAttempt -lt 60; $demoAttempt++) {
        if ($demoProcess.HasExited) { throw '公网隧道已退出，请查看 data/demo/tunnel.err.log。' }
        $demoLog = Get-Content -LiteralPath $demoErr -Raw -ErrorAction SilentlyContinue
        $demoMatch = [regex]::Match([string]$demoLog, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($demoMatch.Success) { $demoUrl = $demoMatch.Value; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $demoUrl) { throw '暂未取得临时公网地址，请检查网络连接和隧道日志。' }
    $demoReady = $false
    for ($demoAttempt = 0; $demoAttempt -lt 40; $demoAttempt++) {
        if (Test-DemoEndpoint $demoUrl) { $demoReady = $true; break }
        if ($demoProcess.HasExited) { throw '公网隧道已退出，请查看 data/demo/tunnel.err.log。' }
        Start-Sleep -Milliseconds 1500
    }
    if (-not $demoReady) { throw "临时地址尚不能访问本机项目（HTTP $script:demoLastHttpStatus，curl $script:demoLastCurlExit），未将它标记为可用链接。" }
    $demoState = @{
        processId = $demoProcess.Id
        createdAt = $demoStarted.CreationDate.ToUniversalTime().ToString('o')
        binary = $demoBinary
        url = $demoUrl
        verifiedAt = [DateTime]::UtcNow.ToString('o')
    }
    $demoState | ConvertTo-Json | Set-Content -LiteralPath $demoStatePath -Encoding UTF8
    $demoUrl | Set-Content -LiteralPath (Join-Path $demoDir 'teacher-demo-link.txt') -Encoding UTF8
    Write-Output "老师演示链接：$demoUrl"
    Write-Output "普通账号文件：$(Join-Path $demoDir 'teacher-access.txt')"
    Write-Output '电脑、Docker 和项目需要保持运行；结束时执行 stop-teacher-demo.ps1。'
} catch {
    $demoCurrent = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoProcess.Id)" -ErrorAction SilentlyContinue
    if ($demoCurrent -and $demoCurrent.ExecutablePath -eq $demoBinary -and $demoCurrent.CreationDate -eq $demoStarted.CreationDate) {
        Stop-Process -Id $demoProcess.Id -ErrorAction SilentlyContinue
    }
    throw
}
