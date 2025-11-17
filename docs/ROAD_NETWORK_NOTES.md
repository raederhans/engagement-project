# Road Network Notes — Philadelphia Street Centerlines (prep)

## Dataset
- Source: City of Philadelphia Streets Department
- Layer: Street Centerlines (polyline) exposed via ArcGIS REST (e.g., `mapservices.pasda.psu.edu` under a `CityPhillyStreets` MapServer).
- Fields of interest: `SEG_ID`, `STNAME`, `CLASS`, `Shape_Length`, directional flags (one-way), and geometry coordinates.

## Planned Pipeline (outline)
1. `scripts/fetch_streets_phl.mjs` — fetch/export centerlines (paged ArcGIS REST) to `data/raw/streets_centerlines_phl.geojson`.
2. `scripts/segment_streets_phl.mjs` — split long centerlines into ~100–200m segments; enrich with `segment_id`, `length_m`, `class`, `oneway`, etc.; output to `data/streets_phl.prepared.geojson`.
3. Update `scripts/generate_demo_data.mjs` to optionally read `streets_phl.prepared.geojson` as the base network when present, then bake demo overlays.

## Notes
- No network calls are wired yet; scripts are stubs for the above flow.
- Live app remains on the 64-segment demo dataset until prepared files exist.
