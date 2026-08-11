# HIN 2025 snapshot lifecycle

The application uses a versioned, same-origin snapshot of the City of Philadelphia High Injury Network defined in 2025. The network is historical planning context based on 2019–2023 crash data. It is not a live road condition, prediction, certification, risk score, safer-route recommendation, or GPS map-matching product.

## Admitted artifacts

- `public/data/hin_2025.snapshot.json` contains the compact, deterministic geometry snapshot.
- `public/data/hin_2025.receipt.json` identifies the exact snapshot bytes and records the official item/layer contract, field schema, source clock, retrieval/build clocks, feature/geometry counts, review status, and official period handoff.
- The legacy v1 snapshot did not record a distinct build clock. Its receipt therefore keeps `builtAt: null`; retrieval time is not reused as a build time.

`sourceAsOf` is the ArcGIS layer `dataLastEditDate`. It is not the 2019–2023 crash-data period, the retrieval time, the build time, or the runtime observation time. ArcGIS item metadata modification is also separate and does not by itself create a new data snapshot.

## Read-only review

Run the acquisition command without acceptance flags:

```text
npm run data:acquire:hin-2025
```

The command reads the official item, layer, count, GeoJSON, and City period description sequentially. If admitted semantic content is unchanged, it validates the existing receipt and leaves both committed artifacts untouched. If item/layer identity, field schema, geometry, count, or period semantics drift, the command fails closed.

If admitted feature content or source semantics change, the command reports review reasons and writes nothing. Review the official change, update the exact local contracts and tests where justified, then run the command with an attributable reviewer:

```text
npm run data:acquire:hin-2025 -- --accept-reviewed-change --reviewed-by "reviewer identity"
```

This is a controlled artifact write and requires the repository's live-test/acquisition slot. Never use the acceptance flag merely to bypass a failing contract.

The scheduled/manual candidate audit in `docs/SOURCE_CANDIDATE_AUDIT.md` uses a
separate temporary output directory and never supplies either acceptance flag.
When a safely normalized HIN candidate changes, it writes a candidate snapshot
plus a `not-admitted` candidate receipt whose build/review clocks and reviewer
remain null. Transport or official contract drift fails before admission and is
reported as an audit failure. Neither outcome changes the committed lifecycle
pair or release truth.

## Validation

```text
npm run data:check:hin-2025
```

Validation proves the snapshot schema/count/geometry contracts, exact receipt-to-snapshot SHA-256 identity, separated time semantics, artifact ceilings, and review disposition. A valid hash proves byte identity only; it does not prove that the HIN is live, complete, safe, predictive, or suitable for routing advice.

## Runtime boundaries

- The browser loads only same-origin snapshot and receipt artifacts; it does not call ArcGIS with route geometry.
- The feature-owned Source Health adapter reports a bundled historical snapshot as `partial`, not live/current danger information.
- The Evidence contribution contains aggregate status/count/provenance only. It excludes route coordinates, matched street names, snapshot rows, feature IDs, GPS traces, Diary content, and exact addresses.
- `near or intersects` is an inclusive 20 m local equirectangular approximation. It does not mean that the route belongs to the HIN or that a crash occurred on the route.
