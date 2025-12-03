# Diary Demo Data Playbook

The Route Safety Diary uses **synthetic** Philadelphia-like geometry to illustrate trips, hover cards, and route replays. None of the data is real GPS. This file captures how to regenerate the demo datasets deterministically and keep them in sync with validation/tests.

## Files
- `data/segments_phl.demo.geojson` — ~64 street segments with safety attributes.
- `data/routes_phl.demo.geojson` — 5 demo routes with primary + alternative metadata.

## Generation
```bash
# Generate deterministic seed (20251111) with 64 segments / 5 routes
npm run data:gen
```
The generator supports optional flags:
- `--seed=<number>` (defaults to `20251111`)
- `--segments=<count>`
- `--routes=<count>`

Each run produces reproducible GeoJSON thanks to the LCG RNG embedded in `scripts/generate_demo_data.mjs`.

## Validation
```bash
npm run data:check
```
Validation ensures:
1. Both files parse as `FeatureCollection`s.
2. Every `route.properties.segment_ids` and `alt_segment_ids` entry resolves to an existing segment.
3. Numeric fields (`length_m`, `duration_min`, `decayed_mean`, `n_eff`, `delta_30d`, etc.) remain finite numbers.
4. All coordinates stay inside a Philly-ish bounding box (lng `[-75.35, -74.9]`, lat `[39.88, 40.05]`).

The script prints `OK — <segments> segments / <routes> routes validated.` when clean; otherwise it emits detailed failures and exits with code `1`.

## Schema Cheatsheet
### Segment properties
| Field | Type | Notes |
| --- | --- | --- |
| `segment_id` | string | Unique (`seg_001`, …).
| `street` | string | Synthetic label.
| `length_m` | number | Approximate great-circle length.
| `decayed_mean` | number | 1–5 safety score, skewed toward yellow/light-green bins.
| `n_eff` | number | 1–25 effective sample size.
| `top_tags` | array | Optional list of `{tag, p}` pairs from the diary tag enum.
| `delta_30d` | number | -0.2…0.2 change vs. prior 30 days.

### Route properties
| Field | Type | Notes |
| --- | --- | --- |
| `route_id` | string | `route_A` …
| `name` | string | Human label.
| `mode` | `"walk" | "bike"` |
| `from`, `to` | string |
| `length_m`, `duration_min` | numbers | Derived from ordered segments.
| `segment_ids` | array<string> | Primary route ordering.
| `alt_segment_ids` | array<string> | Alternative detour listing.
| `alt_length_m`, `alt_duration_min` | numbers | Derived from alt segments.
| `alt_geometry` | LineString | Optional pre-stitched geometry (present on ≥3 routes).

## Manual Checklist Before Committing Data
1. `npm run data:gen` (or update segments/routes manually if needed).
2. `npm run data:check` → ensure it prints `OK`.
3. `npm run test:diary:math && npm run test:diary:agg` (math + aggregator regressions).
4. Update `docs/CHANGELOG.md` with the data/testing lines.
5. Attach evidence (commands + screenshots) to `logs/M1_DIARY_<ts>.md`.

> **Reminder:** Flip `VITE_FEATURE_DIARY=0` in `.env.local` to hide Diary instantly without removing files. EOF
