$ErrorActionPreference = 'Stop'
$demoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoDir = Join-Path $demoRoot 'data/demo'
New-Item -ItemType Directory -Path $demoDir -Force | Out-Null
Write-Output '登录 https://dashboard.cpolar.com/，在“验证”页面复制认证令牌。'
Write-Output '仅在下面的本机输入框粘贴；输入内容不会显示，也不会作为进程参数传递。'
$demoSecureToken = Read-Host 'cpolar 认证令牌' -AsSecureString
$demoTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($demoSecureToken)
try {
    $demoTokenText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($demoTokenPointer).Trim()
    if ($demoTokenText.Length -lt 16 -or $demoTokenText -match '[\r\n]') {
        throw '令牌格式无效，未更新配置。'
    }
    $demoYamlToken = $demoTokenText.Replace("'", "''")
    $demoYaml = @(
        "authtoken: '$demoYamlToken'",
        'console_ui: false',
        'inspect_db_size: -1',
        'web_addr: 127.0.0.1:8093'
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $demoDir 'cpolar.yml'), $demoYaml, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output '认证配置已保存到项目忽略的 data/demo/cpolar.yml，未显示令牌。'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($demoTokenPointer)
    $demoTokenText = $null
    $demoYamlToken = $null
    $demoYaml = $null
    $demoSecureToken.Dispose()
}
