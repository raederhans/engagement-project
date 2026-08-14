# Route-decision S6 real-data integration plan

## Goal

Start a separately gated real-data follow-on to the completed synthetic S6 work.
The first wave must establish a reproducible Philadelphia OpenStreetMap source
candidate, a deterministic walking-profile normalization boundary, an
owner-controlled admission/Source Health contract, and a versioned real compact
graph contract without relabelling any existing S6 synthetic artifact.

## Scope

- Coordination base: `main@f300cfe2658375add6542b86c20267c63c56ec4a`.
- Integration branch: `codex/route-decision-s6-real-data`.
- Source family: OpenStreetMap data distributed by Geofabrik as a dated
  Pennsylvania `.osm.pbf` snapshot.
- Research candidate observed on 2026-08-14:
  `pennsylvania-260813.osm.pbf`, 344,436,627 bytes, provider data cutoff
  `2026-08-13T20:21:01Z`, provider sidecar MD5
  `c5eb6fea08b4d6ea3ebbb1cc61dd9fbe`.
- The observed values are discovery evidence only. An implementation may not
  copy them into an authority result without a fresh bounded observation and
  local content verification.
- First-wave implementation remains candidate/internal-contract only. Actual
  product materialization, public graph deployment, UI/runtime wiring, formal
  performance, and Source Health `current` remain closed.

## Sources of truth

- Exact code and tests at the checked-out SHA.
- `docs/active/route-decision-s6-implementation/**` for the closed synthetic S6
  boundary.
- `scripts/lib/route_graph_candidate/**`,
  `scripts/lib/route_graph_admission/**`, and
  `scripts/lib/route_graph_authority/**` for existing candidate, validation-only,
  and authority-unavailable semantics.
- `src/source_health/source_health_read_model.js` for catalog-bound five-state
  Source Health semantics and four clocks.
- Official OSM/Geofabrik evidence:
  - https://download.geofabrik.de/north-america/us/pennsylvania.html
  - https://download.geofabrik.de/technical.html
  - https://www.openstreetmap.org/copyright
  - https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
  - https://opendatacommons.org/licenses/odbl/1-0/
  - https://operations.osmfoundation.org/policies/api/
  - https://operations.osmfoundation.org/policies/tiles/

## Decisions frozen by the research

1. Use a dated Geofabrik Pennsylvania PBF as the source candidate. `latest` may
   discover a candidate but is never an admitted or reproducible build input.
2. Public Overpass, the OSM editing API, Nominatim, and OSMF tiles are not bulk
   graph-build or route-runtime backends. Runtime eventually loads versioned
   local assets only.
3. Treat a browser-downloadable pedestrian graph conservatively as an ODbL
   Derivative Database: visible OpenStreetMap attribution, ODbL metadata, and a
   machine-readable graph or complete rebuild method are release prerequisites.
4. No new npm dependency, binary install, secret, signing key, or credentials in
   this wave. The repository has no admitted OSM PBF parser or `osmium` binary;
   missing extraction tooling must fail explicitly rather than use a hidden or
   transitive parser.
5. Pennsylvania-only input does not prove cross-Delaware connectivity. The
   Philadelphia boundary, buffer, and New Jersey crossing policy remain
   preregistered unknowns and block product/public admission.
6. Current `GraphArtifact/v1`, S6 compact-graph documents, and S6 runtime
   lifecycle remain synthetic-only and immutable in meaning.

## Work lanes and ownership

### RD-A — source discovery and acquisition manifest

Owned paths only:

- `scripts/lib/route_real_graph_acquisition/**`
- `scripts/tests/route_real_graph_acquisition.mjs`
- `scripts/fixtures/route-real-graph-acquisition/**`

Implement a versioned, candidate-only source discovery/acquisition contract for
a dated Geofabrik snapshot. It must bind provider page, dated URL, sidecar MD5,
local SHA-256 when payload bytes are actually supplied, byte count,
`sourceAsOf/retrievedAt/builtAt/observedAt`, boundary/profile/tool references,
and failure truth. A bounded HEAD/sidecar observation is allowed; downloading or
persisting the 344 MB PBF is not part of this first freeze.

### RD-B — OSM walking profile and deterministic adapter

Owned paths only:

- `scripts/lib/route_real_graph_osm/**`
- `scripts/tests/route_real_graph_osm.mjs`
- `scripts/fixtures/route-real-graph-osm/**`

Define a versioned walk-profile and a deterministic adapter from an explicitly
versioned extractor/intermediate record set to the existing candidate graph
shape. Missing/default/conditional access, oneway, foot, stairs, ferry,
construction, geometry, boundary clipping, turn restrictions, and cost units
must be explicit and fail closed. This lane does not parse PBF, choose a hidden
tool, or mint `GraphArtifact/v1`.

### RD-C — owner-controlled admission and Source Health projection

Owned paths only:

- `scripts/lib/route_real_graph_authority/**`
- `scripts/tests/route_real_graph_authority.mjs`
- `scripts/fixtures/route-real-graph-authority/**`

Add a new real-data admission contract that consumes exact RD-A/RD-B evidence,
recomputes identities and review gates, and can only use an installed
module-private registry rather than caller-authored authority JSON. The default
production registry remains empty/authority-unavailable until the integration
owner installs one exact reviewed entry. Emit only a Source Health update
authorization/projection artifact; do not modify the central catalog or claim
`current`.

### RD-D — real compact graph contract/compiler boundary

Owned paths only:

- `src/route_generation/real_compact_graph/**`
- `scripts/lib/route_real_compact_graph/**`
- `scripts/tests/route_real_compact_graph.mjs`
- `scripts/fixtures/route-real-compact-graph/**`

Define a separate versioned real compact graph and build-time compiler that
requires an exact admitted RD-C record plus normalized graph input. It must bind
source/admission/profile/boundary/builder identities, canonical ordering,
integer costs, ODbL/attribution metadata, claim boundary, and limitations. It
must reject synthetic S6 documents, unadmitted real candidates, stale/partial/
unavailable evidence, and caller-relabelled identities. No network, loader,
actual Worker, UI, package entry, or publication in this lane.

### RD-R — independent review gate

Read-only, no owned write paths. Review exact writer freezes for code/spec/
security and architecture/claims. Verify owned-path containment, no synthetic
reclassification, no caller-mintable authority, ODbL/attribution truth, and no
unapproved dependency/network/full-PBF acquisition. Return P0/P1/P2/WATCH and
APPROVE/COMMENT/REQUEST CHANGES plus CLEAR/WATCH/BLOCK for exact SHAs/bytes.

## Dependency order

```text
RD-A source manifest ─┐
                     ├─> RD-C admission/root ─> RD-D real compact boundary
RD-B OSM profile ────┘
           all exact freezes ────────────────> RD-R review
```

RD-A and RD-B may implement in parallel. RD-C may build and test the fail-closed
contract in parallel but cannot produce an actual admitted entry before exact
A/B evidence. RD-D may implement its versioned rejection/contract surface but
cannot be accepted as a real compiled artifact before an accepted RD-C record.

## Stages

- [x] RD-0: Verify main/remote identity and protected worktree state.
- [x] RD-1: Complete repo-local and official-source research; freeze source,
  licence, service-policy, and evidence boundaries.
- [ ] RD-2: Dispatch RD-A/B/C/D plus read-only RD-R from one committed baseline.
- [ ] RD-3: Receive exact writer freezes and independent reviews; return
  blocking findings only to the owning writer.
- [ ] RD-4: Integrate accepted units serially with source-final blob equality
  and central focused/adjacent validation.
- [ ] RD-5: Decide whether a separately authorized full-PBF acquisition,
  extractor-tool admission, exact graph build, Source Health catalog entry,
  runtime/Worker/browser, formal performance, and public ODbL release may open.

## Acceptance criteria

- Existing S6 synthetic modules, schemas, tests, and claims remain unchanged.
- Every new artifact has an exact version, strict admission, canonical identity,
  immutable output, bounded size/depth, and explicit unavailable/unknown truth.
- No result trusts provider MD5, HTTP headers, caller-supplied SHA-256,
  `reviewedBy` text, or a self-authored registry as independent authority.
- Source clocks remain distinct; transport timestamps do not become business
  freshness, and unknown/unavailable record counts are never zero-filled.
- The OSM profile has explicit missing/default/conditional rules and does not
  imply accessibility, safety, completeness, or routing correctness.
- A public graph cannot become eligible without ODbL/attribution, machine-
  readable availability/rebuild method, boundary/cross-state policy, independent
  review, exact artifact validation, real browser/runtime evidence, and release
  owner approval.
- Writer tasks do not edit package scripts, public barrels, CI, Source Health
  catalog, central records, Git refs/index, or shared output directories.

## Non-goals

- Downloading or committing the full Pennsylvania PBF in this first wave.
- Installing `osmium`, a PBF parser, a package, a binary, a key, or credentials.
- Treating MD5/SHA-256 as source authenticity, reviewer identity, or licence
  authority.
- Actual product admission, Source Health `current`, network loader, Worker,
  persistence, UI, routing results, formal performance, Pages publication, or
  deployment.
- Safety, safer-route, accessibility outcome, real-time, preference, causality,
  scientific validation, user study, or multi-city transfer claims.

## Risks and constraints

- Geofabrik dated files are eventually removed; a future admitted release needs
  an ODbL-compliant durable source/derived artifact offer or full rebuild method.
- PA-only extraction can truncate cross-state routes; boundary/buffer policy is
  not yet frozen.
- OSM access and conditional tags are incomplete and heterogeneous; unknown is
  not pass or false.
- The project code is MIT but a published OSM-derived graph must retain its
  separate ODbL data licence and attribution boundary.
- Parallel lanes are semantically related even where file ownership is green;
  only the integration owner may reconcile shared schemas, package entries,
  catalog, runtime, CI, Git, and publication state.
