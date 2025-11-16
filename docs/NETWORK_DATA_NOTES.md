# Network Data Notes — Philadelphia Street Centerlines (prep)

## Purpose & Scope
- The Route Safety Diary will migrate from synthetic demo lines to real Philadelphia street centerlines so route overlays and segment ratings align with actual blocks.
- For now we continue to ship and render the synthetic demo files `data/segments_phl.demo.geojson` and `data/routes_phl.demo.geojson`.

## Data Source: OpenDataPhilly — Street Centerlines
- Dataset name: **Street Centerlines** (Transportation category on OpenDataPhilly).
- Description (catalog summary): Citywide base street layer maintained by the Philadelphia Streets Department; intended as a reference for roadway centerlines across the city. Published via ArcGIS Open Data. [OpenDataPhilly][1]
- Access methods (no secrets):
  - Manual: download from the OpenDataPhilly dataset page (Shapefile, GeoJSON, CSV options).
  - Programmatic: use the underlying ArcGIS FeatureService REST endpoint or the `opendata.arcgis.com` GeoJSON export URL pattern provided by the dataset.

## Planned Local File Layout
- `data/streets_phl.raw.geojson` — direct export from the Street Centerlines dataset.
- `data/streets_phl.prepared.geojson` — processed version (future):
  - clipped to the city boundary
  - simplified geometry
  - split into ~100–200m segments
  - includes `segment_id`, `street_name`, `length_m`, and chosen classification fields

## Future Processing Pipeline (outline)
1. Download Street Centerlines (manual or scripted).
2. Clip to city limits; optionally drop non-road features if present.
3. Simplify geometry and remove redundant vertices.
4. Split edges into consistent-length segments (~100–200m).
5. Assign stable `segment_id`s and compute `length_m`.
6. Optionally enrich with road class, speed, or other attributes.

## Integration Plan
- `scripts/generate_demo_data.mjs` will later read from `data/streets_phl.prepared.geojson` instead of synthetic paths once fields are aligned.
- Downstream consumers: `data/segments_phl.demo.geojson`, any future matcher utilities (e.g., `src/utils/match.js`), and map rendering (`src/map/segments_layer.js`).

[1]: https://www.opendataphilly.org/dataset/street-centerlines
