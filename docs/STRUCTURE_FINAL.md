# Repository Structure — Final Documentation

**Date**: 2025-10-21
**Repo**: `dashboard-project-Ryan`
**Purpose**: Document the final, standardized Vite application structure

---

## Table of Contents
1. [Directory Tree](#directory-tree)
2. [Single Entry Verification](#single-entry-verification)
3. [Static Assets Organization](#static-assets-organization)
4. [What Was Changed](#what-was-changed)
5. [How to Add New Pages/Assets](#how-to-add-new-pagesassets)
6. [Acceptance Criteria Verification](#acceptance-criteria-verification)

---

## 1. Directory Tree

Final structure (depth ≤ 3, excluding node_modules):

```
dashboard-project-Ryan/
├── .claude/               # Claude Code configuration
├── .git/                  # Git repository
├── .github/
│   └── workflows/         # GitHub Actions
├── dist/                  ⚠️  Build output (IGNORED BY GIT)
│   ├── assets/            # Bundled JS/CSS (generated)
│   ├── data/              # Copied from public/data/
│   └── index.html         # Built from /index.html
├── docs/                  # Documentation
│   ├── CHANGELOG.md
│   ├── STRUCTURE_FINAL.md (this file)
│   └── [other docs]
├── logs/                  ⚠️  Runtime logs (IGNORED BY GIT)
│   ├── STRUCTURE_SWEEP_*.md
│   ├── build_*.log
│   └── preview_*.log
├── mockup/                # Legacy prototype (reference only)
│   ├── css/
│   ├── img/
│   └── index.html         (not part of Vite app)
├── public/                ✅ Static assets (copied as-is)
│   └── data/
│       ├── police_districts.geojson
│       └── tracts_phl.geojson
├── scripts/               # Build/utility scripts
│   ├── fetch_tracts.mjs
│   └── tract_sql_samples.mjs
├── src/                   ✅ Application source code
│   ├── api/               # API clients (CARTO, geocoding)
│   ├── charts/            # Chart.js wrappers
│   ├── compare/           # Compare card logic
│   ├── data/              # App-internal JSON (imported via JS)
│   │   ├── acs_tracts_2023_pa101.json
│   │   ├── offense_groups.json
│   │   └── README.md
│   ├── map/               # MapLibre GL layers
│   ├── state/             # App state management
│   ├── ui/                # UI components
│   └── utils/             # Utilities (SQL builders, HTTP cache)
├── .gitignore             ✅ Updated (ignores dist/, logs/)
├── index.html             ✅ SINGLE ENTRY POINT
├── package.json
├── README.md
└── vite.config.js         ✅ Canonical minimal config
```

---

## 2. Single Entry Verification

### Entry Point
**Path**: `/index.html` (repo root)

**Key Elements**:
1. **MapLibre CSS Link** (line 7):
   ```html
   <link href="https://unpkg.com/maplibre-gl@^4.5.0/dist/maplibre-gl.css" rel="stylesheet" />
   ```

2. **Script Tag** (line 151):
   ```html
   <script type="module" src="/src/main.js"></script>
   ```
   - ✅ Type: `module` (ES modules)
   - ✅ Path: **Absolute** (`/src/main.js`, not `../src/main.js`)
   - ✅ Single instance (no duplicate script tags)

3. **App Containers**:
   - `<div id="map">` — MapLibre GL container
   - `<div id="legend">` — Choropleth legend
   - `<div id="tooltip">` — Hover tooltip
   - `<div id="sidepanel">` — Control panel (left)
   - `<div id="compare-card">` — Compare buffer A vs B (bottom-left)
   - `<div id="charts">` — Three charts (right)

### Vite Config
**Path**: `/vite.config.js`

```javascript
export default {
  build: { outDir: 'dist' }
};
```

**Verification**:
- ✅ No `root:` setting (uses repo root as implicit root)
- ✅ `outDir: 'dist'` (canonical)
- ✅ Minimal config (no unnecessary options)

### No Other Entry Points
**Verified**: No `index.html` exists in `/public` or actively used elsewhere
- `/dist/index.html` — Build artifact (generated, not committed)
- `/mockup/index.html` — Legacy prototype (inactive)

---

## 3. Static Assets Organization

### Public Assets (Copied As-Is)
**Location**: `/public/data/`

```
public/data/police_districts.geojson  (364K)  ← Served at /data/police_districts.geojson
public/data/tracts_phl.geojson        (1.4M)  ← Served at /data/tracts_phl.geojson
```

**Access Pattern**:
- Fetched via `fetch('/data/police_districts.geojson')`
- Vite copies these to `dist/data/` during build
- No bundling/transformation (served as-is)

### App-Internal Data (Imported in Code)
**Location**: `/src/data/`

```
src/data/acs_tracts_2023_pa101.json   (45K)   ← import acsData from './data/acs_tracts_2023_pa101.json'
src/data/offense_groups.json          (455B)  ← import offenseGroups from './data/offense_groups.json'
```

**Access Pattern**:
- Imported as ES modules via `import` statements
- Bundled into JS chunks during build
- Tree-shakeable and optimized

### Rule of Thumb
- **Use `/public`** for:
  - Large static files (GeoJSON, images, fonts)
  - Files referenced by absolute URLs in HTML/CSS
  - Assets that should not be processed

- **Use `/src/data`** for:
  - Small JSON configs imported in JS
  - Data that benefits from bundling/tree-shaking
  - Files accessed via `import` statements

---

## 4. What Was Changed

### Files Modified

#### 1. `.gitignore` (Updated)
**Before**:
```
node_modules/
```

**After**:
```
node_modules/
dist/
logs/
.DS_Store
*.local
.env*
```

**Why**: Prevent build artifacts (`dist/`) and runtime logs (`logs/`) from being committed.

#### 2. Git Tracking (dist/ Removed)
**Action**: `git rm -r --cached dist/`

**Files Untracked**:
- `dist/assets/__vite-browser-external-BIHI7g3E.js`
- `dist/assets/index-BDNcYWuu.js`
- `dist/assets/index-rqFrHuTF.css`
- `dist/data/police_districts.geojson`
- `dist/data/tracts_phl.geojson`
- `dist/index.html`

**Why**: `dist/` is a build artifact and should be regenerated on each deployment, not committed to version control.

### Files NOT Changed
- `/index.html` — Already correct (no changes needed)
- `/vite.config.js` — Already in canonical form
- `/src/**` — No source code changes
- `/public/**` — No asset changes

### Files Removed
**None** — All existing files were kept. Only git tracking was adjusted.

### Files Added
- `logs/STRUCTURE_SWEEP_20251021_1030.md` — Inventory report
- `logs/build_structure_pass_20251021_104330.log` — Build verification
- `logs/preview_http_structure_pass_20251021_104330.log` — Preview test
- `docs/STRUCTURE_FINAL.md` — This documentation

---

## 5. How to Add New Pages/Assets

### Adding Static Assets

#### Large Files (GeoJSON, Images, etc.)
1. Place file in `/public/` subdirectory:
   ```
   public/data/new_dataset.geojson
   public/assets/logo.png
   ```

2. Reference with absolute path:
   ```javascript
   // In JS
   const data = await fetch('/data/new_dataset.geojson');

   // In HTML
   <img src="/assets/logo.png" alt="Logo">
   ```

3. **Do NOT** use `import` for public assets.

#### App-Internal JSON/Config
1. Place file in `/src/data/`:
   ```
   src/data/config.json
   ```

2. Import as ES module:
   ```javascript
   import config from './data/config.json';
   console.log(config.apiKey);
   ```

3. **Benefit**: Bundled and tree-shakeable.

### Adding New Pages/Routes

**For Single-Page App (SPA)**:
This project is an SPA — all routing is client-side via `/index.html`.

1. Add new components in `/src/ui/`:
   ```javascript
   // src/ui/new_panel.js
   export function initNewPanel() {
     // ...
   }
   ```

2. Import in `/src/main.js`:
   ```javascript
   import { initNewPanel } from './ui/new_panel.js';
   initNewPanel();
   ```

**For Multi-Page App (MPA)**:
If you need separate HTML pages:

1. Create new HTML in root:
   ```
   /dashboard.html
   /about.html
   ```

2. Update `vite.config.js`:
   ```javascript
   export default {
     build: {
       outDir: 'dist',
       rollupOptions: {
         input: {
           main: '/index.html',
           dashboard: '/dashboard.html',
           about: '/about.html',
         }
       }
     }
   };
   ```

3. **Important**: Keep script tags using absolute paths:
   ```html
   <script type="module" src="/src/dashboard.js"></script>
   ```

### Adding Build Scripts
1. Create script in `/scripts/`:
   ```
   scripts/generate_data.mjs
   ```

2. Add npm script in `package.json`:
   ```json
   "scripts": {
     "generate": "node scripts/generate_data.mjs"
   }
   ```

---

## 6. Acceptance Criteria Verification

All criteria from the cleanup task specification:

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **1. Single HTML entry at `/index.html`** | ✅ PASS | `/index.html` exists, no other entries in `/public` |
| **2. No `/public/index.html`** | ✅ PASS | `/public` only contains `/data` subdirectory |
| **3. No committed `/dist/index.html`** | ✅ PASS | `git rm -r --cached dist/` executed |
| **4. `/dist/` ignored by git** | ✅ PASS | `.gitignore` contains `dist/` |
| **5. `vite.config.js` has no `root:`** | ✅ PASS | Config only has `build.outDir: 'dist'` |
| **6. `vite.config.js` has `outDir: 'dist'`** | ✅ PASS | Verified in config |
| **7. Script tag uses absolute path** | ✅ PASS | `src="/src/main.js"` (not `../src/main.js`) |
| **8. Script tag is `type="module"`** | ✅ PASS | `<script type="module" src="/src/main.js">` |
| **9. `npm run build` succeeds** | ✅ PASS | Built in 5.40s, 463 modules |
| **10. `npm run preview` serves `/`** | ✅ PASS | HTTP 200 OK on localhost:4173 |
| **11. Preview stopped after test** | ✅ PASS | Shell killed, no processes running |
| **12. `docs/STRUCTURE_FINAL.md` exists** | ✅ PASS | This file |
| **13. Build/preview logs exist** | ✅ PASS | `logs/build_structure_pass_*.log`, `logs/preview_http_structure_pass_*.log` |

**Overall Result**: ✅ **ALL CRITERIA MET**

---

## Summary

### Before Cleanup
- ⚠️ `dist/` tracked by git (6 build artifacts committed)
- ⚠️ `.gitignore` incomplete (missing `dist/`, `logs/`)
- ✅ Entry point already correct
- ✅ Vite config already canonical

### After Cleanup
- ✅ Single entry point: `/index.html`
- ✅ `dist/` untracked and ignored
- ✅ `.gitignore` complete (node_modules, dist, logs, .DS_Store, *.local, .env*)
- ✅ Build succeeds (463 modules → 1.08 MB bundle)
- ✅ Preview serves root path with HTTP 200

### Key Principles
1. **One entry, one truth**: `/index.html` at repo root
2. **Build artifacts never committed**: `dist/` is ephemeral
3. **Absolute paths in HTML**: `/src/main.js` (not `../src/main.js`)
4. **Static vs. imported**: `/public` for assets, `/src/data` for configs
5. **Minimal config**: Only set what's necessary in `vite.config.js`

---

**Next Steps**: Continue development using this standardized structure. All future builds will use `/index.html` as the single entry point and output to `dist/` (which remains ignored by git).
