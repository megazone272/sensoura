$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -LocalPort 3000
if ($conns) {
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $pids) {
    Write-Host "Killing PID $p"
    Stop-Process -Id $p -Force
  }
  Start-Sleep -Seconds 2
}
if (Get-NetTCPConnection -LocalPort 3000) { Write-Host 'STILL IN USE' } else { Write-Host 'Port 3000 free' }
