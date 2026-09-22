[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\release\echovip-headless-source.zip')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryDir = (git -C $projectDir rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repositoryDir)) {
    throw '当前项目不在 Git 仓库中'
}
$projectRelative = [System.IO.Path]::GetRelativePath($repositoryDir, $projectDir).Replace('\', '/')
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$releaseDir = Split-Path -Parent $resolvedOutput

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
Push-Location $projectDir
try {
    npm run privacy:check
    if ($LASTEXITCODE -ne 0) { throw '发布隐私检查失败' }
    if ($projectRelative -eq '.') {
        git -C $repositoryDir archive --format=zip --prefix=echovip-headless/ --output=$resolvedOutput HEAD
    }
    else {
        git -C $repositoryDir archive --format=zip --prefix=echovip-headless/ --output=$resolvedOutput "HEAD:$projectRelative"
    }
    if ($LASTEXITCODE -ne 0) { throw 'Git 发布包生成失败' }
    Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256 | Format-List
}
finally {
    Pop-Location
}
