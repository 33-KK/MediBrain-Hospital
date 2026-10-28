$ErrorActionPreference = 'Stop'
$demoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoDir = Join-Path $demoRoot 'data/demo'
$demoStatePath = Join-Path $demoDir 'tunnel-state.json'
$demoBinary = [IO.Path]::GetFullPath((Join-Path $demoRoot 'data/tools/cpolar-3.3.12/cpolar.exe'))
$demoConfigPath = Join-Path $demoDir 'cpolar.yml'

function Test-DemoEndpoint([string]$url) {
    $demoStatus = & curl.exe --silent --max-time 10 --output NUL --write-out '%{http_code}' ($url + '/api/health/live')
    return ($LASTEXITCODE -eq 0 -and $demoStatus -eq '200')
}

if (-not (Test-Path -LiteralPath $demoBinary)) { throw '缺少 cpolar 演示工具。' }
$demoSignature = Get-AuthenticodeSignature -LiteralPath $demoBinary
if ($demoSignature.Status -ne 'Valid' -or $demoSignature.SignerCertificate.Subject -notlike '*Beijing Jiaxun Technology*') {
    throw 'cpolar 官方数字签名校验失败，未启动分享。'
}
if (-not (Test-Path -LiteralPath $demoConfigPath)) { throw '请先运行 configure-teacher-demo.ps1，在本机配置免费账号令牌。' }
$demoConfiguration = [IO.File]::ReadAllText($demoConfigPath)
if ($demoConfiguration -notmatch '(?m)^authtoken:\s*[^\r\n]{16,}') {
    throw '请先运行 configure-teacher-demo.ps1，在本机配置免费账号令牌。'
}
$demoConfiguration = $null
& (Join-Path $PSScriptRoot 'start-local-access.ps1')

if (Test-Path -LiteralPath $demoStatePath) {
    $demoPrevious = Get-Content -LiteralPath $demoStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $demoExisting = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoPrevious.processId)" -ErrorAction SilentlyContinue
    if ($demoExisting -and $demoExisting.ExecutablePath -eq $demoPrevious.binary -and $demoExisting.CreationDate.ToUniversalTime().ToString('o') -eq $demoPrevious.createdAt) {
        if (-not (Test-DemoEndpoint $demoPrevious.url)) { throw '已有演示隧道暂不可访问，请检查网络或停止后重新启动。' }
        Write-Output "老师演示链接已运行：$($demoPrevious.url)"
        return
    }
}
if (Get-NetTCPConnection -LocalPort 8093 -State Listen -ErrorAction SilentlyContinue) {
    throw '本机 8093 端口已被占用，未停止其他程序。'
}
& node (Join-Path $PSScriptRoot 'prepare-teacher-account.cjs')
if ($LASTEXITCODE -ne 0) { throw '普通演示账号准备失败，未开启分享。' }
$demoOut = Join-Path $demoDir 'cpolar.out.log'
$demoErr = Join-Path $demoDir 'cpolar.err.log'
$demoArguments = @('http', '-config', $demoConfigPath, '-region', 'cn', '-proto', 'https', '-redirect-https', 'true', '-inspect-addr', '127.0.0.1:8093', '-log', 'stdout', '-log-level', 'INFO', '127.0.0.1:8090')
$demoProcess = Start-Process -FilePath $demoBinary -ArgumentList $demoArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $demoOut -RedirectStandardError $demoErr
$demoStarted = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoProcess.Id)"
try {
    $demoUrl = $null
    for ($demoAttempt = 0; $demoAttempt -lt 60; $demoAttempt++) {
        if ($demoProcess.HasExited) { throw 'cpolar 已退出，请检查账号认证或网络状态。' }
        $demoLog = (Get-Content -LiteralPath $demoOut -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $demoErr -Raw -ErrorAction SilentlyContinue)
        $demoMatches = [regex]::Matches([string]$demoLog, 'https://[a-z0-9.-]+\.cpolar\.(?:cn|top|io|com)')
        foreach ($demoMatch in $demoMatches) {
            if (Test-DemoEndpoint $demoMatch.Value) { $demoUrl = $demoMatch.Value; break }
        }
        if ($demoUrl) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $demoUrl) { throw '尚未取得验证通过的公网链接，未将地址标记为可用。' }
    @{
        processId = $demoProcess.Id
        createdAt = $demoStarted.CreationDate.ToUniversalTime().ToString('o')
        binary = $demoBinary
        provider = 'cpolar'
        url = $demoUrl
        verifiedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $demoStatePath -Encoding UTF8
    $demoUrl | Set-Content -LiteralPath (Join-Path $demoDir 'teacher-demo-link.txt') -Encoding UTF8
    Write-Output "老师演示链接：$demoUrl"
    Write-Output "普通账号文件：$(Join-Path $demoDir 'teacher-access.txt')"
    Write-Output '结束演示后执行 stop-teacher-demo.ps1。'
} catch {
    $demoCurrent = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoProcess.Id)" -ErrorAction SilentlyContinue
    if ($demoCurrent -and $demoCurrent.ExecutablePath -eq $demoBinary -and $demoCurrent.CreationDate -eq $demoStarted.CreationDate) {
        Stop-Process -Id $demoProcess.Id -ErrorAction SilentlyContinue
    }
    throw
}
