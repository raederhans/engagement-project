# Road Network Notes — Philadelphia Street Centerlines (prep)

## Dataset
- Source: City of Philadelphia Streets Department
- Preferred layer: Street Centerlines (polyline) exposed via ArcGIS REST / OpenDataPhilly. Target: GeoJSON in EPSG:4326 (lon/lat).
- Fields of interest: `SEG_ID`, `STNAME`/`name`, `FUNC_CLASS`/`CLASS`, `Shape_Length`, directional flags (one-way), and geometry coordinates.
- Env/config: `STREETS_PHL_URL` can override the fetch URL for direct downloads (GeoJSON recommended). If unset or unavailable, the scripts fall back to a baked Center City sample GeoJSON.

## Planned Pipeline (outline)
1. `scripts/fetch_streets_phl.mjs` — fetch/export centerlines (paged ArcGIS REST) to `data/raw/streets_centerlines_phl.geojson`.
2. `scripts/segment_streets_phl.mjs` — split long centerlines into ~100–200m segments; enrich with `segment_id`, `length_m`, `class`, `oneway`, etc.; output to `data/streets_phl.prepared.geojson`.
3. Update `scripts/generate_demo_data.mjs` to optionally read `streets_phl.prepared.geojson` as the base network when present, then bake demo overlays.

## Notes
- No network calls are wired yet; scripts are stubs for the above flow.
- Live app remains on the 64-segment demo dataset until prepared files exist.

## Current implementation (M3 packet)
- `scripts/fetch_streets_phl.mjs` writes `data/streets_phl.raw.geojson`. If `STREETS_PHL_URL` is unset/unreachable, it writes a small Center City sample (lon/lat).
- `scripts/segment_streets_phl.mjs` reads the raw GeoJSON, clips to a Philly bbox, splits lines into ~150 m segments, assigns `segment_id`, `class` (1–4 from `func_class`/`CLASS` heuristic), `street_name`, and `length_m`, writing to `data/segments_phl.network.geojson`.
- `scripts/generate_demo_data.mjs` consumes `segments_phl.network.geojson` when present to build demo segments/routes (otherwise falls back to the synthetic generator). Routes are chained along connected segment endpoints.
