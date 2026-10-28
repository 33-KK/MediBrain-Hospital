param(
    [switch]$Dependencies,
    [string]$Kubeconfig = (Join-Path $PSScriptRoot '../../kubeconfig-prod.utf8'),
    [string]$Context = 'kind-medibrain-prod'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Kubeconfig -PathType Leaf)) {
    throw "找不到项目 kubeconfig：$Kubeconfig"
}
$Kubeconfig = (Resolve-Path -LiteralPath $Kubeconfig).Path
$targets = @(@{ Service = 'medibrain-web'; Local = 8090; Remote = 80 })
if ($Dependencies) {
    $targets += @(
        @{ Service = 'medibrain-mongo'; Local = 27017; Remote = 27017 },
        @{ Service = 'medibrain-redis'; Local = 6379; Remote = 6379 },
        @{ Service = 'medibrain-neo4j'; Local = 7688; Remote = 7687 }
    )
}
foreach ($target in $targets) {
    $listener = Get-NetTCPConnection -LocalPort $target.Local -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        $expectedContext = '(?:^|\s)--context\s+"?' + [regex]::Escape($Context) + '"?(?:\s|$)'
        $expectedKubeconfig = '(?:^|\s)--kubeconfig\s+"?' + [regex]::Escape($Kubeconfig) + '"?(?:\s|$)'
        if ($existing.Name -ne 'kubectl.exe' -or $existing.CommandLine -notlike "*service/$($target.Service)*" -or $existing.CommandLine -notlike '*--address 127.0.0.1*' -or $existing.CommandLine -notmatch $expectedContext -or $existing.CommandLine -notmatch $expectedKubeconfig) {
            throw "端口 $($target.Local) 已被其他程序占用，未修改该程序。"
        }
        $healthy = $true
        if ($target.Service -eq 'medibrain-web') {
            try { $null = Invoke-WebRequest "http://127.0.0.1:$($target.Local)/api/health/live" -UseBasicParsing -TimeoutSec 2 }
            catch { $healthy = $false }
        }
        if ($healthy) {
            Write-Output "$($target.Service): localhost:$($target.Local) 已运行"
            continue
        }
        # A service port-forward may still own its socket while its old Pod
        # terminates. Restart only the matching kubectl process we verified.
        $sameProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.ProcessId)" -ErrorAction SilentlyContinue
        if ($sameProcess -and $sameProcess.CreationDate -eq $existing.CreationDate -and $sameProcess.Name -eq 'kubectl.exe' -and $sameProcess.CommandLine -eq $existing.CommandLine) {
            Stop-Process -Id $sameProcess.ProcessId -ErrorAction SilentlyContinue
        }
    }
    $arguments = @('--kubeconfig', ('"{0}"' -f $Kubeconfig), '--context', $Context, 'port-forward', '-n', 'medibrain', "service/$($target.Service)", "$($target.Local):$($target.Remote)", '--address', '127.0.0.1')
    $taskProcess = Start-Process kubectl -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput "$env:TEMP/medibrain-access-$($target.Local).out.log" -RedirectStandardError "$env:TEMP/medibrain-access-$($target.Local).err.log"
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($taskProcess.HasExited) { throw "$($target.Service) 转发退出，请检查临时目录内对应日志。" }
        if (Get-NetTCPConnection -LocalPort $target.Local -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "$($target.Service) 端口转发尚未就绪。" }
    Write-Output "$($target.Service): localhost:$($target.Local) 已启动"
}
Write-Output '访问 http://localhost:8090；Pod 重建或电脑重启后，可再次运行本脚本。'
