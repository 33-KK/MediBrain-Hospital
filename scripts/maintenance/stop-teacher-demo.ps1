$ErrorActionPreference = 'Stop'
$demoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoStatePath = Join-Path $demoRoot 'data/demo/tunnel-state.json'
if (-not (Test-Path -LiteralPath $demoStatePath)) {
    Write-Output '当前没有记录在运行的老师演示隧道。'
    return
}
$demoState = Get-Content -LiteralPath $demoStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
$demoBinary = if ($demoState.provider -eq 'cpolar') {
    [IO.Path]::GetFullPath((Join-Path $demoRoot 'data/tools/cpolar-3.3.12/cpolar.exe'))
} else {
    [IO.Path]::GetFullPath((Join-Path $demoRoot 'data/tools/cloudflared-2026.10.0.exe'))
}
$demoProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoState.processId)" -ErrorAction SilentlyContinue
if (-not $demoProcess) {
    Write-Output '演示隧道已停止，本机项目可继续使用。'
    return
}
if ($demoProcess.ExecutablePath -ne $demoBinary -or $demoProcess.CreationDate.ToUniversalTime().ToString('o') -ne $demoState.createdAt -or $demoProcess.CommandLine -notlike '*127.0.0.1:8090*') {
    throw '进程身份与演示记录不符，未停止其他程序。'
}
Stop-Process -Id $demoProcess.ProcessId
Write-Output '老师演示公网链接已关闭，本机网页、Docker 和数据库继续运行。'
