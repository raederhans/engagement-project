"VITE_FEATURE_DIARY=1" | Out-File -FilePath .env.local -Encoding ascii -NoNewline

npm run data:gen
if ($LASTEXITCODE -ne 0) { Write-Error "data:gen failed"; exit 1 }

npm run data:check
if ($LASTEXITCODE -ne 0) { Write-Error "data:check failed"; exit 1 }

Start-Process powershell -ArgumentList "npm run dev"
Start-Sleep -Seconds 2
Start-Process "http://localhost:5173/?mode=diary"
