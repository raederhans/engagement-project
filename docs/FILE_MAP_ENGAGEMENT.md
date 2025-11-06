# FILE_MAP_ENGAGEMENT — dashboard-project-Ryan → engagement-project

## Purpose
Curate the minimum viable file set for the "engagement-project" derivative while keeping the source repository unchanged (except docs/logs created by this audit).

This derivative will serve as the baseline for the "Route Safety Diary" project, which transforms the Philadelphia Crime Dashboard into a user-engagement-focused application where members of the public can contribute to a safety dataset.

---

## Directory Overview (Annotated)

### ROOT-LEVEL FILES (Include)

```
dashboard-project-Ryan/
├── index.html                           ✅ INCLUDE (Vite entry point - REQUIRED)
├── package.json                         ✅ INCLUDE (NPM dependencies & scripts - REQUIRED)
├── package-lock.json                    ✅ INCLUDE (Dependency lock file - REQUIRED)
├── vite.config.js                       ✅ INCLUDE (Vite bundler config - REQUIRED)
├── .gitignore                           ✅ INCLUDE (Git ignore rules)
├── .eslintrc.json                       ✅ INCLUDE (ESLint configuration - Google style)
├── .stylelintrc.json                    ✅ INCLUDE (Stylelint configuration)
├── .stylelintignore                     ✅ INCLUDE (Stylelint ignore patterns)
├── README.md                            ✅ INCLUDE (Project documentation - 8.1 KB)
├── INSTRUCTIONS.md                      ✅ INCLUDE (User instructions)
├── crime_dashboard_codex_plan.txt       ⚠️  OPTIONAL (Historical planning artifact)
│
├── public_index_backup.txt              ❌ EXCLUDE (Backup file - not needed)
├── TEMP_main_line.txt                   ❌ EXCLUDE (Temporary file)
└── TMP_compare_before.txt               ❌ EXCLUDE (Temporary file)
```

**Rationale:**
- All build/lint configs are essential for reproducible development
- README and INSTRUCTIONS provide context and usage guide
- Temporary and backup files excluded to keep derivative clean

---

### APPLICATION SOURCE CODE (Include All)

```
src/                                     ✅ INCLUDE (Entire directory - ~150 KB)
├── main.js                              ✅ (Application entry point - 11.7 KB)
├── config.js                            ✅ (Configuration constants)
├── style.css                            ✅ (Global stylesheet)
│
├── api/                                 ✅ INCLUDE (Data access layer - 5 files)
│   ├── index.js
│   ├── acs.js                           (American Community Survey API - 3.5 KB)
│   ├── boundaries.js                    (Police districts & census tracts - 4 KB)
│   ├── crime.js                         (Crime data API client - 11.9 KB)
│   └── meta.js                          (Metadata endpoints - 1.1 KB)
│
├── charts/                              ✅ INCLUDE (Chart.js visualizations - 4 files)
│   ├── index.js                         (Chart orchestration - 6.8 KB)
│   ├── bar_topn.js                      (Top-N bar chart)
│   ├── heat_7x24.js                     (7×24 heatmap)
│   └── line_monthly.js                  (Monthly time series)
│
├── compare/                             ✅ INCLUDE (Comparison logic - 1 file)
│   └── card.js                          (A vs B comparison - 2.7 KB)
│
├── data/                                ✅ INCLUDE (Static/cached data - 3 files)
│   ├── acs_tracts_2023_pa101.json       (ACS tract statistics - 45 KB)
│   ├── offense_groups.json              (Crime type groupings)
│   └── README.md                        (Data directory docs)
│
├── map/                                 ✅ INCLUDE (MapLibre GL - 17 files, CORE)
│   ├── index.js
│   ├── initMap.js                       (Map initialization)
│   ├── points.js                        (Crime point rendering - 5.2 KB)
│   ├── render_choropleth.js             (District choropleth)
│   ├── render_choropleth_tracts.js      (Tract choropleth)
│   ├── tracts_layers.js                 (Census tract layers - 4.3 KB)
│   ├── tracts_view.js                   (Tract view management)
│   ├── legend.js                        (Map legend - 3 KB)
│   ├── buffer_overlay.js                (Buffer zone rendering)
│   ├── selection_layers.js              (User selection handling)
│   ├── ui_popup_district.js             (District popup)
│   ├── ui_tooltip.js                    (Hover tooltip)
│   ├── choropleth_districts.js          (District choropleth logic)
│   ├── style_helpers.js                 (Styling utilities)
│   ├── wire_points.js                   (Point layer wiring)
│   └── ui_legend.js                     (Legend UI)
│
├── state/                               ✅ INCLUDE (State management - 2 files)
│   ├── index.js
│   └── store.js                         (Global state store - 3.7 KB)
│
├── ui/                                  ✅ INCLUDE (UI components - 2 files)
│   ├── about.js                         (About panel - 4.7 KB)
│   └── panel.js                         (Control panel - 14.3 KB)
│
└── utils/                               ✅ INCLUDE (Utilities - 10 files)
    ├── index.js
    ├── sql.js                           (SQL query builder - 16.8 KB)
    ├── http.js                          (HTTP request wrapper - 5.2 KB)
    ├── classify.js                      (Data classification - 3.2 KB)
    ├── tract_geom.js                    (Tract geometry - 1.8 KB)
    ├── types.js                         (Type definitions - 2.9 KB)
    ├── join.js                          (Data joining - 1.3 KB)
    ├── pop_buffer.js                    (Population buffers - 1.1 KB)
    ├── district_names.js                (District name mappings)
    └── geoids.js                        (GeoID utilities)
```

**Rationale:**
- Complete application source code needed for functional baseline
- ~50 JavaScript files total, well-organized by responsibility
- All modules interconnected; cannot cherry-pick without breaking dependencies

---

### STATIC ASSETS (Include)

```
public/                                  ✅ INCLUDE (Static assets directory)
└── data/
    ├── police_districts.geojson         ✅ INCLUDE (371 KB - District boundaries)
    └── tracts_phl.geojson               ✅ INCLUDE (1.4 MB - Census tract boundaries)
```

**Rationale:**
- Pre-cached boundary data for offline/faster loading
- Eliminates external API dependency for core geometries
- Total: ~1.8 MB of GeoJSON data

---

### DOCUMENTATION (Include)

```
docs/                                    ✅ INCLUDE (Technical documentation - 20 files)
├── AGENT.md                             ✅ (Agent guidelines)
├── AGENTS.md                            ✅ (Multi-agent coordination)
├── CHECKLIST.md                         ✅ (Development checklist)
├── CONTROL_SPEC.md                      ✅ (UI control specifications)
├── DEPLOY.md                            ✅ (Deployment guide)
├── FILE_MAP.md                          ✅ (File structure map - 11.5 KB)
├── FIX_PLAN.md                          ✅ (Bug fix planning)
├── TODO.md                              ✅ (Task tracking - 9.5 KB)
├── CHANGELOG.md                         ✅ (Change history - 27.5 KB)
├── KNOWN_ISSUES.md                      ✅ (Known bugs - 6.5 KB)
├── STRUCTURE_AUDIT.md                   ✅ (Architecture audit - 18.4 KB)
├── STRUCTURE_FINAL.md                   ✅ (Final structure - 11 KB)
├── EDIT_POINTS.md                       ✅ (Edit tracking - 13 KB)
├── ADDRESS_FLOW_AUDIT.md                ✅ (Address flow analysis - 16.9 KB)
├── ADDRESS_FLOW_PLAN.md                 ✅ (Address flow planning - 23.3 KB)
├── CHARTS_RESPONSIVE_PLAN.md            ✅ (Charts responsiveness - 16.3 KB)
├── DATA_PIPELINE_AUDIT.md               ✅ (Data pipeline audit - 19.1 KB)
├── DRILLDOWN_FIX_PLAN.md                ✅ (Drilldown fixes - 13 KB)
├── FIX_PLAN_DATA.md                     ✅ (Data fix plan - 14 KB)
└── TRACTS_CHARTS_PLAN.md                ✅ (Tracts charts plan - 21.9 KB)
```

**Rationale:**
- Extensive technical documentation (~270 KB total)
- Architecture audits, planning documents, specifications
- Essential context for understanding system design decisions
- No large binaries detected; all text-based markdown

---

### DATA PROCESSING SCRIPTS (Include)

```
scripts/                                 ✅ INCLUDE (Data utilities - 16 files)
│
├── PowerShell Automation (3 files)
│   ├── codex_loop.ps1                   ✅ (Automated workflow loop)
│   ├── monitor_todo.ps1                 ✅ (TODO monitoring)
│   └── watchdog_rules.md                ✅ (Watchdog rules)
│
├── Data Fetching (4 files)
│   ├── fetch_acs_tracts.mjs             ✅ (Fetch ACS tract stats)
│   ├── fetch_districts.js               ✅ (Fetch police districts)
│   ├── fetch_tracts.mjs                 ✅ (Fetch census tracts - 5 KB)
│   └── probe_coverage.mjs               ✅ (Probe data coverage)
│
├── Data Processing & Validation (6 files)
│   ├── compute_acs_averages.mjs         ✅ (Compute ACS averages - 4.9 KB)
│   ├── precompute_tract_counts.mjs      ✅ (Precompute tract counts)
│   ├── precompute_tract_crime.mjs       ✅ (Precompute tract crime - 4.1 KB)
│   ├── audit_offense_codes.mjs          ✅ (Audit offense codes)
│   ├── fix_offense_groups.mjs           ✅ (Fix offense groupings)
│   └── validate_offense_groups.mjs      ✅ (Validate offense groups)
│
└── Testing & Samples (3 files)
    ├── test_tract_api.mjs               ✅ (Test tract API - 5.1 KB)
    ├── tract_sql_samples.mjs            ✅ (Sample SQL queries - 7.7 KB)
    └── area_sql_sample.mjs              ✅ (Sample area queries)
```

**Rationale:**
- Useful for data refresh, validation, and debugging
- Boundary fetching scripts for updating GeoJSON files
- Total ~50 KB of utility scripts
- No server/deployment scripts (kept lean)

---

## EXCLUDED BY DESIGN

### Build Artifacts & Dependencies (Must Exclude)

```
❌ node_modules/                         (100+ packages, 100-200 MB)
   └── Reason: Regenerate via `npm install`

❌ dist/                                 (Build output directory)
   ├── index.html
   ├── assets/
   │   ├── index-*.js                    (Bundled JavaScript)
   │   └── index-*.css                   (Bundled CSS)
   └── data/                             (Copied static files)
   Reason: Generated via `npm run build`

❌ .cache/                               (Vite cache)
❌ .vercel/                              (Vercel deployment)
❌ .netlify/                             (Netlify deployment)
   Reason: Deployment artifacts, not source
```

---

### Version Control & Logs (Must Exclude)

```
❌ .git/                                 (3,200+ files, full Git history)
   Reason: Git metadata; reinitialize with `git init` if needed

❌ logs/                                 (40+ diagnostic files, 500+ KB)
   ├── AUDIT_*.md
   ├── DIAG_*.md
   ├── TRACT_*.md
   ├── offense_codes_*.json
   └── [timestamped audit/diagnostic files]
   Reason: Historical diagnostic artifacts, not application code

❌ *.log                                 (Log files anywhere)
❌ *.map                                 (Source maps)
   Reason: Development artifacts
```

---

### Tooling & IDE Settings (Exclude)

```
❌ .vscode/                              (VS Code workspace settings)
   Reason: Editor-specific, user preference

❌ .github/                              (GitHub Actions workflows)
   Reason: CI/CD specific to original repo

❌ .claude/                              (Claude Code settings)
   └── settings.local.json
   Reason: User-specific tool configuration
```

---

### Temporary/Backup Files (Exclude)

```
❌ TEMP_*.txt                            (Temporary files)
❌ TMP_*.txt                             (Temporary files)
❌ *_backup.txt                          (Backup files)
❌ public_index_backup.txt
❌ Thumbs.db                             (Windows thumbnail cache)
❌ .DS_Store                             (macOS directory metadata)
❌ *.tmp                                 (Temporary files)
   Reason: Not source code; cleanup artifacts
```

---

### Environment & Secrets (Must Exclude)

```
❌ .env*                                 (Environment variables)
❌ credentials.*                         (Credential files)
   Reason: Security; never copy secrets

✅ VERIFIED: No .env files detected in source
✅ VERIFIED: All APIs are public Philadelphia open data (no keys required)
```

---

### Mockup/Prototype (Exclude)

```
❌ mockup/                               (UI mockup/prototype)
   ├── index.html
   ├── css/styles.css
   └── img/
   Reason: Historical/reference only; not part of live application
```

---

## SIZE & DEPENDENCY ESTIMATES

### Source Repository (Before Copy)
- **Total size (with node_modules):** ~200-300 MB
- **Total files (with node_modules):** 3,500+ files

### Destination (After Copy)
- **Expected size (without node_modules):** ~2.3 MB
- **Expected file count:** ~110 files
- **Breakdown:**
  - Source code (src/): ~150 KB
  - Public data (public/): ~1.8 MB
  - Documentation (docs/): ~270 KB
  - Scripts: ~50 KB
  - Config files: <10 KB

### Dependencies (Post-Copy Setup)
After copy, run `npm install` to regenerate node_modules (~200 MB):

**Runtime Dependencies:**
- `@turf/turf` - Geospatial analysis
- `chart.js` - Chart visualizations
- `dayjs` - Date manipulation
- `luxon` - DateTime library
- `maplibre-gl` - Map rendering engine

**Development Dependencies:**
- `vite` - Build tool & dev server

---

## RATIONALE: WHY INCLUDE/EXCLUDE

### Why Include src/, public/, docs/, scripts/?
1. **src/** - Complete application source code; cannot cherry-pick without breaking
2. **public/data/** - Pre-cached boundaries; improves performance & offline capability
3. **docs/** - Technical specifications, architecture audits, planning documents
4. **scripts/** - Data refresh/validation utilities; useful for maintenance

### Why Exclude node_modules/, dist/, .git/?
1. **node_modules/** - Can regenerate via `npm install`; saves 200+ MB
2. **dist/** - Build artifacts generated via `npm run build`
3. **.git/** - Git history; start fresh with `git init` if needed
4. **logs/** - Historical diagnostics; not part of application

### Why Exclude .vscode/, .github/, .claude/?
- Editor/tooling-specific configurations
- User preference; not universal requirements
- Can recreate if needed

### Why Exclude Temporary/Backup Files?
- Not source code
- Cleanup artifacts from development
- Keep derivative lean and professional

---

## COPY OPERATION COMMAND

### Robocopy (Windows PowerShell)
```powershell
robocopy "C:\Users\raede\Desktop\essay help master\6920Java\dashboard-project-Ryan" `
         "C:\Users\raede\Desktop\essay help master\6920Java\engagement-project" `
         /E /NFL /NDL /NP /MT:16 `
         /XD node_modules dist logs .git .cache .vercel .netlify .vscode .github .claude mockup `
         /XF *.map *.tmp *.log .env* Thumbs.db .DS_Store TEMP_*.txt TMP_*.txt *_backup.txt
```

**Flags Explained:**
- `/E` - Copy subdirectories (including empty)
- `/NFL` - No file list (less verbose)
- `/NDL` - No directory list (less verbose)
- `/NP` - No progress (cleaner output)
- `/MT:16` - Multi-threaded (16 threads for speed)
- `/XD` - Exclude directories
- `/XF` - Exclude files (by pattern)

**Expected Exit Code:** 0 or 1 (success)

---

## POST-COPY SETUP

### Verification Checklist
- ✅ package.json exists
- ✅ vite.config.js exists
- ✅ src\ directory exists
- ✅ public\data\ directory exists
- ✅ docs\ directory exists
- ✅ scripts\ directory exists
- ❌ node_modules\ does NOT exist
- ❌ dist\ does NOT exist
- ❌ .git\ does NOT exist
- ❌ logs\ does NOT exist
- ❌ No .env* files present

### Installation & Build
```bash
# Navigate to destination
cd "C:\Users\raede\Desktop\essay help master\6920Java\engagement-project"

# Install dependencies (regenerates node_modules)
npm install

# Development mode (http://localhost:5173/)
npm run dev

# Production build (creates dist/)
npm run build

# Preview production build (http://localhost:4173/)
npm run preview
```

---

## NEXT STEPS (DERIVATIVE PROJECT)

Once copy is complete, the engagement-project will need:

1. **Update README.md** - Change from "Philadelphia Crime Dashboard" to "Route Safety Diary"
2. **Modify src/config.js** - Update project name, goals, data sources
3. **Adapt src/ui/panel.js** - Redesign controls for engagement use case
4. **Create user engagement features** - Add data contribution mechanisms
5. **Define new user personas** - Target audience for Route Safety Diary
6. **Update documentation** - Revise docs/ to reflect new project goals
7. **Initialize new Git repo** - `git init` for version control

---

## AUDIT TIMESTAMP
**Created:** 2025-11-06
**Agent:** Agent-M (Manager/Reviewer/Auditor)
**Mode:** manager-fixes-allowed (read-only on source, write audit docs)

---

## ACCEPTANCE CRITERIA

✅ Destination contains: package.json, vite.config.js, src\, public\data\, docs\, scripts\
✅ Destination does NOT contain: node_modules\, dist\, .git\, logs\, .env*
✅ Three artifacts created: FILE_MAP_ENGAGEMENT.md, COPY_PLAN_<ts>.md, COPY_INVENTORY_<ts>.txt
✅ Robocopy exit code: 0 or 1
✅ Source CHANGELOG.md updated with one-line entry

---

**END OF FILE_MAP_ENGAGEMENT**
