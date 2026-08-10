# Plan

## Goal

Deliver a committed, integration-ready Batch 7 foundation that adds truthful Vision Zero HIN 2025 historical planning context to an explicitly supplied Known Route.

## Scope

- Acquire the official ArcGIS item, layer contract, count, and full GeoJSON through a deterministic pipeline.
- Normalize and validate a versioned local snapshot with a hard 280,000-byte artifact ceiling.
- Associate a browser-memory-only Known Route with `LineString` and `MultiLineString` HIN geometry using one disclosed fixed tolerance.
- Render text-first street-name context, snapshot provenance, method, limitations, and official handoff in the existing lazy Known Route surface.
- Preserve a narrow injected snapshot-loader seam for a future Batch 4 source-health adapter.

## Sources of truth

- Exact implementation baseline: `main@19d27cfb808913d4fa5e120cb28204eb3405836e`.
- ArcGIS item `7e416319784a463fa0d8b528d7ccf511` and layer `high_injury_network_2025/FeatureServer/0`.
- Vision Zero Action Plan 2030 page for the 2019-2023 crash-data period and planning-network meaning.
- Current `route_corridor_capability`, privacy, coverage, request-owner, UI, bundle, and test contracts.

## Stages

- [x] Stage 1: verify exact baseline, repository ownership, current Known Route contracts, and official ArcGIS admission.
- [x] Stage 2: implement and generate the deterministic local snapshot pipeline.
- [x] Stage 3: implement pure Known Route x HIN association and the narrow runtime adapter.
- [x] Stage 4: integrate text-first/no-map-compatible UI semantics behind the existing lazy boundary.
- [x] Stage 5: run isolated short validation, check artifact/chunk/dist ceilings, review the diff, and commit.

## Acceptance criteria

- Official admission proves 162 features, exact four-field schema, no GlobalID, and mixed `LineString`/`MultiLineString` geometry.
- Snapshot provenance separates retrieval time, layer data/schema edit time, and item metadata modified time.
- Snapshot retains all official responsibility fields, six-decimal coordinates, City license/warranty, and snapshot-local-only object identities.
- Runtime reads only the versioned local snapshot and never calls ArcGIS or exposes/persists the exact route.
- Association uses an inclusive fixed 20 m local equirectangular segment-distance method and emits only `known-route-near-or-intersects-hin-snapshot`.
- Text UI distinguishes admitted zero from unavailable, works without a map port, remains keyboard usable, and includes limitations plus official handoff.
- Snapshot is at most 280,000 bytes and total `dist` stays below 4,000,000 bytes without raising existing ceilings.

## Non-goals

- No risk/safety score, safer-route recommendation, real-time danger, future risk, GPS matching, route-event claim, or official safety certification.
- No HIN timeline across snapshots; `objectid` is never a cross-version identity.
- No ArcGIS runtime fetch, new dependency, full `@turf/turf` import, default map overlay, Batch 4 status model, deployment, push, or integration.

## Risks and constraints

- The local planar approximation and six-decimal source snapshot are context methods, not legal or engineering boundary proof.
- HIN source metadata may change independently of layer data/schema; these timestamps must remain separate.
- Only short isolated tests/build checks are authorized; browser, visual, dev-server, and full-release gates remain for the integration owner.
