$cmd = 'codex exec "continue to next task" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox'
$logDir = "logs"; if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
while ($true) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $log = Join-Path $logDir "codex_$ts.log"
  Write-Host "Starting codex at $ts"
  cmd /c $cmd *>> $log
  Write-Host "codex exited. Sleeping 20s..."
  Start-Sleep -Seconds 20
  $todo = Get-Content "docs/TODO.md" -Raw
  if ($todo -notmatch '- \[ \]') { Write-Host "No Pending items. Exit."; break }
}
