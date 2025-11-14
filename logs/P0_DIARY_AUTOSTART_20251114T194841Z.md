# Diary Autostart & URL Override (Phase 0)
preflight timestamp: 20251114T194841Z
## Preflight
git rev-parse --abbrev-ref HEAD -> feat/diary-phase4-cta-state
git switch -c feat/diary-autostart-and-url-override
node -v -> v22.18.0
npm -v -> 11.6.2
npm install -> up to date
- Updated src/main.js to honor ?mode=diary override for diaryFeatureEnabled.
- Added scripts/diary_quickstart.ps1 and scripts/diary_quickstart.sh (with chmod +x).
- Updated package.json scripts with diary:qs:win, diary:qs:sh, diary:preview.
## Dev quickstart test
timeout 10s npm run diary:qs:sh (success, dev server launched)
## Preview test
Removed .env.local, ran npm run data:gen && npm run data:check && npm run build
timeout 5s npm run preview (served http://localhost:4173)
Screenshots saved: logs/screenshots/autostart_diary_panel.png, logs/screenshots/preview_url_override.png
