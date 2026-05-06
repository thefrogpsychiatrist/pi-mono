param(
	[int]$Port = 4173,
	[string]$HostName = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$exampleDir = Join-Path $repoRoot "packages\web-ui\example"
$pidFile = Join-Path $repoRoot ".pi-web-ui-example.pid"

if (Test-Path $pidFile) {
	$existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
	if ($existingPid) {
		$process = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
		if ($process) {
			Write-Host "pi-web-ui example already running (PID $existingPid)."
			Write-Host "Open: http://${HostName}:${Port}"
			exit 0
		}
	}
	Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$arguments = "/c cd /d `"$exampleDir`" && npx vite --host $HostName --port $Port --strictPort"
$process = Start-Process -FilePath "cmd.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru

Set-Content -Path $pidFile -Value $process.Id

Write-Host "Started pi-web-ui example."
Write-Host "PID: $($process.Id)"
Write-Host "Open: http://${HostName}:${Port}"
