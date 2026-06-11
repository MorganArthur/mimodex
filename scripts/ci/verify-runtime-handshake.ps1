param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimePath,

    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

if ($TimeoutSeconds -le 0) {
    throw "TimeoutSeconds 必须大于 0。"
}

$resolvedRuntime = (Resolve-Path -LiteralPath $RuntimePath).Path
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $resolvedRuntime
$startInfo.WorkingDirectory = Split-Path -Parent $resolvedRuntime
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$started = $false

try {
    if (-not $process.Start()) {
        throw "Runtime 进程启动失败。"
    }
    $started = $true

    $initialize = @{
        id = 1
        method = "initialize"
        params = @{
            clientInfo = @{
                name = "mimodex_ci"
                title = "Mimodex CI"
                version = "0.1.0"
            }
            capabilities = $null
        }
    } | ConvertTo-Json -Compress -Depth 5

    $process.StandardInput.WriteLine($initialize)
    $process.StandardInput.Flush()
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

    while ([DateTime]::UtcNow -lt $deadline) {
        $remainingMs = [math]::Max(
            1,
            [int][math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        )
        $readTask = $process.StandardOutput.ReadLineAsync()
        if (-not $readTask.Wait($remainingMs)) {
            throw "等待 Runtime initialize 响应超时。"
        }

        $line = $readTask.Result
        if ($null -eq $line) {
            $stderr = $process.StandardError.ReadToEnd()
            throw "Runtime 在 initialize 响应前退出。stderr：$stderr"
        }
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        $message = $line | ConvertFrom-Json
        if ($message.id -ne 1) {
            continue
        }
        if ($null -eq $message.result) {
            throw "Runtime initialize 返回失败：$line"
        }

        foreach ($field in @("userAgent", "codexHome", "platformFamily", "platformOs")) {
            if ([string]::IsNullOrWhiteSpace($message.result.$field)) {
                throw "Runtime initialize 响应缺少字段 $field：$line"
            }
        }

        $process.StandardInput.WriteLine('{"method":"initialized"}')
        $process.StandardInput.Flush()
        Write-Host "Runtime initialize 握手验证通过：$($message.result.platformOs) / $($message.result.userAgent)"
        return
    }

    throw "等待 Runtime initialize 响应超时。"
} finally {
    if ($started -and -not $process.HasExited) {
        $process.Kill($true)
        $process.WaitForExit()
    }
    $process.Dispose()
}
