#!/usr/bin/env bash
set -euo pipefail

printf "VITE_FEATURE_DIARY=1" > .env.local

npm run data:gen
npm run data:check

npm run dev &
DEV_PID=$!
trap 'kill $DEV_PID >/dev/null 2>&1 || true' EXIT
sleep 2
if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173/?mode=diary" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173/?mode=diary" 2>/dev/null || true
fi
wait $DEV_PID
