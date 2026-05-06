$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $repoRoot ".pi-web-ui-example.pid"

if (-not (Test-Path $pidFile)) {
	Write-Host "No running pi-web-ui example found."
	exit 0
}

$pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
if ($pidValue) {
	$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
	if ($process) {
		Stop-Process -Id $pidValue -Force
		Write-Host "Stopped pi-web-ui example (PID $pidValue)."
	} else {
		Write-Host "Process $pidValue not running."
	}
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
