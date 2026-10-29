[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 3091
)

$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$launcherProtocol = 2
$narrativeRevision = 'sewer-rest-v3'

function Resolve-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'node.exe was not found on PATH. Install Node.js and open a new terminal.'
}

function Get-ExistingFeituPreview {
  param([int]$PreviewPort)
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$PreviewPort/api/health" -TimeoutSec 2
    if (
      $health.status -eq 'PASS' -and
      $health.productShell -eq 'DeepSeek Harness' -and
      $health.runtimeContract -eq 'feitu-world/v1' -and
      $health.contentId -eq 'one-line-last-train'
    ) { return $health }
  } catch {}
  return $null
}

if ($env:CODEX_SANDBOX_NETWORK_DISABLED) {
  throw 'This launcher is running inside the Codex network sandbox. Close this window and double-click the launcher in File Explorer so DeepSeek can use the normal Windows network.'
}

$requestedPort = $Port
$selectedPort = $null
$lastCandidate = [Math]::Min(65535, $requestedPort + 9)
for ($candidate = $requestedPort; $candidate -le $lastCandidate; $candidate += 1) {
  $existingPreview = Get-ExistingFeituPreview -PreviewPort $candidate
  if ($existingPreview) {
    if ([int]$existingPreview.launcherProtocol -eq $launcherProtocol -and $existingPreview.narrativeRevision -eq $narrativeRevision) {
      Write-Host "Current Feitu World preview is already running on port $candidate. Reusing it." -ForegroundColor Green
      Write-Host "Opening http://127.0.0.1:$candidate/preview.html" -ForegroundColor Cyan
      Start-Process "http://127.0.0.1:$candidate/preview.html"
      return
    }
    Write-Host "Older Feitu World preview detected on port $candidate. It will not be reused." -ForegroundColor Yellow
    continue
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    $selectedPort = $candidate
    break
  }
}

if ($null -eq $selectedPort) {
  throw "No free preview port was found from $requestedPort through $lastCandidate. Close an old preview and try again."
}

$Port = $selectedPort
if ($Port -ne $requestedPort) {
  Write-Host "Starting the current preview on free port $Port." -ForegroundColor Yellow
}

if (-not $env:DEEPSEEK_API_KEY) {
  $secureKey = Read-Host 'Enter the DeepSeek API Key (hidden and used only by this process)' -AsSecureString
  $env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
}
if (-not $env:DEEPSEEK_API_KEY) { throw 'No DeepSeek API Key was provided. Preview startup was cancelled.' }

$node = Resolve-NodeExecutable
$env:FEITU_PORT = "$Port"
Write-Host "Starting Feitu World preview: http://127.0.0.1:$Port/preview.html" -ForegroundColor Cyan
Write-Host 'Close this window or press Ctrl+C to stop the preview.' -ForegroundColor DarkGray

$server = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $packageRoot -NoNewWindow -PassThru
try {
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if ($server.HasExited) { throw "Preview process failed with exit code $($server.ExitCode)." }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
      if ($health.status -eq 'PASS' -and [int]$health.launcherProtocol -eq $launcherProtocol -and $health.narrativeRevision -eq $narrativeRevision) { break }
    } catch {}
  }
  if (-not $health -or $health.status -ne 'PASS' -or [int]$health.launcherProtocol -ne $launcherProtocol -or $health.narrativeRevision -ne $narrativeRevision) { throw 'Preview service did not become ready within 8 seconds.' }
  Start-Process "http://127.0.0.1:$Port/preview.html"
  Write-Host 'Preview opened. The first free action will validate the real DeepSeek connection.' -ForegroundColor Green
  Wait-Process -Id $server.Id
} finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
}
