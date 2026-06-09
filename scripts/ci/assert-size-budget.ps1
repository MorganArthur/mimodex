param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [double]$MaxMiB,

    [string]$Label = "产物"
)

$ErrorActionPreference = "Stop"

if ($MaxMiB -le 0) {
    throw "MaxMiB 必须大于 0。"
}

if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label 不存在：$Path"
}

$item = Get-Item -LiteralPath $Path
if ($item.PSIsContainer) {
    $bytes = (
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File |
            Measure-Object -Property Length -Sum
    ).Sum
} else {
    $bytes = $item.Length
}

if ($null -eq $bytes) {
    $bytes = 0
}

$actualMiB = [math]::Round($bytes / 1MB, 2)
$maxBytes = $MaxMiB * 1MB
$displayPath = $item.FullName

Write-Host "$Label 大小：$actualMiB MiB；上限：$MaxMiB MiB；路径：$displayPath"

if ($bytes -gt $maxBytes) {
    throw "$Label 超出体积预算：$actualMiB MiB > $MaxMiB MiB"
}

Write-Host "$Label 体积预算检查通过。"
