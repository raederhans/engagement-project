param(
  [string]$RepoRoot = ".",
  [int]$HeartbeatSec = 180,
  [int]$LogTail = 80
)

function Summarize {
  param([string]$root, [int]$tailLines)

  $todoPath = Join-Path $root "docs\TODO.md"
  $logsDir  = Join-Path $root "logs"

  if (-not (Test-Path $todoPath)) {
    Write-Host "CYCLE $(Get-Date -Format HH:mm) REPORT:`nDID: TODO.md missing`nNEXT: create it`nRISKS: none"
    return
  }

  $todo = Get-Content $todoPath -Raw
  # counts
  $pending    = ([regex]::Matches($todo, '^- \[ \]', 'Multiline')).Count
  $inprog     = ([regex]::Matches($todo, '^## In Progress[\s\S]*?(?=^## |\Z)', 'Multiline')).Value
  $inprogItem = ([regex]::Match($inprog, '^- \[ \] .+?\(ID:\s*([^)]+)\)', 'Multiline')).Groups[1].Value
  if (-not $inprogItem) { $inprogItem = "none" }

  # newest log
  $lastLog = $null
  if (Test-Path $logsDir) {
    $lastLog = Get-ChildItem $logsDir -Filter *.log -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  $logTailText = "(no logs)"
  if ($lastLog) {
    $logTailText = (Get-Content $lastLog.FullName -Tail $tailLines) -join "`n"
  }

  # STOP flag?
  if ($todo -match '(?m)^\s*#\s*STOP') {
    Write-Host "CYCLE $(Get-Date -Format HH:mm) REPORT:`nDID: STOP flag detected`nNEXT: exit`nRISKS: none"
    exit 0
  }

  Write-Host ("CYCLE {0} REPORT:`nDID: snapshot" -f (Get-Date -Format HH:mm))
  Write-Host ("NEXT: current In-Progress ID: {0}; Pending count: {1}" -f $inprogItem, $pending)
  Write-Host "RISKS: (tail of newest log below)"
  Write-Host $logTailText
}

# main loop
while ($true) {
  Summarize -root (Resolve-Path $RepoRoot).Path -tailLines $LogTail
  Start-Sleep -Seconds $HeartbeatSec
}
