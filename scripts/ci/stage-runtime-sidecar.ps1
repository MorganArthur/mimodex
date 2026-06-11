param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeTargetDir,

    [Parameter(Mandatory = $true)]
    [string]$TauriDir
)

$ErrorActionPreference = "Stop"

$resolvedRuntimeTarget = (Resolve-Path -LiteralPath $RuntimeTargetDir).Path
$resolvedTauriDir = (Resolve-Path -LiteralPath $TauriDir).Path
$binariesDir = Join-Path $resolvedTauriDir "binaries"
$resourcesDir = Join-Path $binariesDir "codex-resources"

$files = @(
    @{
        Source = Join-Path $resolvedRuntimeTarget "codex-app-server.exe"
        Destination = Join-Path $binariesDir "mimodex-runtime-x86_64-pc-windows-msvc.exe"
    },
    @{
        Source = Join-Path $resolvedRuntimeTarget "codex-command-runner.exe"
        Destination = Join-Path $resourcesDir "codex-command-runner.exe"
    },
    @{
        Source = Join-Path $resolvedRuntimeTarget "codex-windows-sandbox-setup.exe"
        Destination = Join-Path $resourcesDir "codex-windows-sandbox-setup.exe"
    }
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file.Source -PathType Leaf)) {
        throw "Runtime 构建产物不存在：$($file.Source)"
    }
}

New-Item -ItemType Directory -Force -Path $binariesDir, $resourcesDir | Out-Null

foreach ($file in $files) {
    Copy-Item -LiteralPath $file.Source -Destination $file.Destination -Force
    $item = Get-Item -LiteralPath $file.Destination
    $sizeMiB = [math]::Round($item.Length / 1MB, 2)
    Write-Host "已暂存 $($item.Name)：$sizeMiB MiB -> $($item.FullName)"
}

Write-Host "Mimodex Runtime sidecar 与 Windows 沙箱辅助程序暂存完成。"
