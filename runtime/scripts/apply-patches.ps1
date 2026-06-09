param(
    [Parameter(Mandatory = $true)]
    [string]$UpstreamPath,

    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$runtimeRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$lockPath = Join-Path $runtimeRoot "upstream.lock.json"
$seriesPath = Join-Path $runtimeRoot "patches\series"
$patchRoot = Join-Path $runtimeRoot "patches"
$resolvedUpstream = Resolve-Path $UpstreamPath
$upstreamLock = Get-Content -Raw -Path $lockPath | ConvertFrom-Json

$actualCommit = (& git -C $resolvedUpstream rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "无法读取上游 Git commit：$resolvedUpstream"
}

if ($actualCommit -ne $upstreamLock.commit) {
    throw "上游 commit 不匹配。期望 $($upstreamLock.commit)，实际 $actualCommit"
}

$patches = Get-Content -Path $seriesPath |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") }

if (-not $patches) {
    Write-Host "补丁队列为空，上游 commit 校验通过。"
    exit 0
}

foreach ($patch in $patches) {
    $patchPath = Join-Path $patchRoot $patch
    if (-not (Test-Path -LiteralPath $patchPath)) {
        throw "series 中的补丁不存在：$patchPath"
    }

    Write-Host "检查补丁：$patch"
    & git -C $resolvedUpstream apply --check --whitespace=error-all $patchPath
    if ($LASTEXITCODE -ne 0) {
        throw "补丁检查失败：$patch"
    }

    if (-not $CheckOnly) {
        Write-Host "应用补丁：$patch"
        & git -C $resolvedUpstream apply --whitespace=error-all $patchPath
        if ($LASTEXITCODE -ne 0) {
            throw "补丁应用失败：$patch"
        }
    }
}

if ($CheckOnly) {
    Write-Host "全部补丁检查通过。"
} else {
    Write-Host "全部补丁应用完成。"
}
