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
7. The user has now authorized a supervised continuation through three
   priorities: close and integrate the contract wave, freeze the full-PBF tool
   and Philadelphia boundary policy, and build/admit one exact real graph.
   This authorization does not open runtime/UI, formal performance, pilot,
   publication, deployment, credentials, or safety/accessibility claims.

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

### RD-E — extraction tooling, boundary policy, and real graph build owner

Owned version-controlled paths only:

- `scripts/lib/route_real_graph_build/**`
- `scripts/tests/route_real_graph_build.mjs`
- `scripts/fixtures/route-real-graph-build/**`

RD-E first freezes an exact extractor/tool contract and a Philadelphia
boundary/buffer/cross-New-Jersey policy. After independent review and an
explicit supervisor follow-up, RD-E becomes the sole live-process owner for the
dated PBF download, extraction, and exact intermediate graph build. Live bytes
and logs stay outside Git under:

- `output/route-real-graph-build-private/**`
- `logs/route-real-graph-build-*.log`

No package/binary installation, full download, extraction, retry, fallback, or
interpretation of live status may begin before the supervisor records the exact
tool/version/command, working directory, output/log paths, success/failure
criteria, and stop conditions. RD-E may call the accepted RD-B adapter after it
is integrated, but may not mint RD-C authority or an RD-D compact artifact.

### RD-R — independent review gate

Read-only, no owned write paths. Review exact writer freezes for code/spec/
security and architecture/claims. Verify owned-path containment, no synthetic
reclassification, no caller-mintable authority, ODbL/attribution truth, and no
unapproved dependency/network/full-PBF acquisition. Return P0/P1/P2/WATCH and
APPROVE/COMMENT/REQUEST CHANGES plus CLEAR/WATCH/BLOCK for exact SHAs/bytes.

### RD-Q — independent cross-lane and ODbL review gate

Read-only, no owned write paths. RD-Q reviews exact A/B/C/D/E freezes and the
finished private build evidence. It verifies ownership, tool provenance,
boundary/cross-state truth, no hidden parser or network fallback, ODbL and
attribution metadata, caller-independent admission, exact source-to-build
identity propagation, and the continued closure of runtime/performance/public
claims.

## Dependency order

```text
RD-A source manifest ─────┐
RD-B OSM profile ─────────┼─> RD-C admission/root ─> RD-D real compact boundary
RD-E tool/boundary/build ─┘

A/B exact freeze ─> A/B review ─> serial A/B integration
accepted A/B + E ─> private exact build ─> C admission ─> D compact artifact
all exact freezes and build evidence ──────────────────> RD-Q review
```

RD-A and RD-B may implement in parallel. RD-C may build and test the fail-closed
contract in parallel but cannot produce an actual admitted entry before exact
A/B evidence. RD-D may implement its versioned rejection/contract surface but
cannot be accepted as a real compiled artifact before an accepted RD-C record.
RD-E may implement its fail-closed tool/boundary/build surface in parallel, but
must not start a full PBF live process before A/B integration and an explicit
single-owner release. RD-Q reviews only stable exact freezes or completed
private build evidence; a rubric review is not a delivery approval.

Accepted RD-G now supplies the reviewed source-only progressive plans,
persistent event-store grammar, replay/clock checks, installed-tool caller-claim
inspection and final evidence trace. It does not supply the native Windows
process/filesystem/durable-store adapter or install a positive tool observation.
Those native capabilities remain a separate reviewed prerequisite before any
live release.

## Stages

- [x] RD-0: Verify main/remote identity and protected worktree state.
- [x] RD-1: Complete repo-local and official-source research; freeze source,
  licence, service-policy, and evidence boundaries.
- [x] RD-2: Dispatch the contract/build-control writers and read-only reviewers
  from committed baselines; recover A/B/C/E/Q after the App crash and recreate
  the missing RD-D at exact `45ca4c7`.
- [x] RD-3: Receive exact writer freezes and independent reviews; return
  blocking findings only to the owning writer.
- [x] RD-4: Integrate accepted units serially with source-final blob equality
  and central focused/adjacent validation.
- [x] RD-5: Open only a separately supervised full-PBF acquisition,
  extractor-tool admission, exact graph build, and actual admission/Source
  Health projection. Runtime/Worker/browser, formal performance, central Source
  Health `current`, and public ODbL release remain closed.
- [x] RD-6: Freeze and independently review the exact extractor and
  Philadelphia boundary/buffer/cross-state policy.
- [x] RD-6A: Implement and independently review RD-G's source-only progressive
  controller/persistent-store/evidence grammar and exact installed-tool
  caller-claim boundary without executing a live command or installing a
  positive capability.
- [ ] RD-6B: Implement and independently review the native Windows Job Object,
  handle/reparse-safe filesystem, durable store, atomic promotion and positive
  exact-tool observation adapter. Keep network/PBF execution closed during
  source review.
  - [ ] RD-6B.0: Prototype only the unresolved Windows capabilities in an
    isolated local directory: ancestor/target reparse resistance,
    same-volume atomic no-replace, file/parent durability and optional Job
    containment. No curl/osmium/network/PBF. A three-file feasibility candidate
    and one private common-case probe now exist. V1 review is `REQUEST CHANGES`
    because handle-relative rename was not exercised and two observation fields
    overstated junction rejection and atomicity. Prototype v2 produced a repaired
    three-file freeze, but its only live run failed before the relevant Win32 path
    and the final bytes received only static checks. A unique no-edit final-byte
    probe (`01a00476-3fa2-73b3-8479-a4257a460412`) then ran once and passed
    `1/1` without freeze drift. This closes only the missing final-byte
    feasibility observation: handle-relative rename was attempted but rejected
    with Win32 `87`, and unsupported race, power-loss and Job-containment claims
    remain unavailable. Source-only production-helper task
    `01a00488-bd0d-7780-94fd-55393080b855` is active in isolated `99dd`; it may
    not compile or run the helper.
  - [ ] RD-6B.1: Implement the strict source-only sibling protocol/adapter with
    an empty private registry and no native runner, then independently review an
    exact freeze. V1 failed both review lanes because caller-self-hashed request
    and unbound result envelopes cannot close the RD-G/native evidence chain;
    adapter v2's exact eight-file / 72,371-byte freeze passed focused `18/18`
    and adjacent `84/84`, but both fresh reviews rejected it: deadline equality
    violates accepted RD-G and the combined encoded result budget is not
    mechanically self-consistent. V3 writer
    `01a00484-f63f-7783-b1e9-36828112d6c9` owns only the same eight paths;
    integration remains closed pending a new exact freeze and dual review.
  - [ ] RD-6B.2: Under one observation owner, inventory the exact local helper
    build host, curl and osmium candidates without installing or downloading;
    perform positive admission only in a later exact, private, reviewed freeze.
    The bounded preflight observed system curl as a candidate and did not
    observe osmium. Review accepts only a structured observation memo, not raw
    replayable or commit-bound evidence. The first evidence-v2 queued client never
    materialized; replacement task `01a00475-ccb8-7d50-a681-62bdecf9b66f`
    produced a 253-file recorded-session package with exact transcript bindings.
    Curl is observed-candidate/not-admitted, osmium remains bounded-not-observed,
    and legacy build hosts are candidates only. Read-only independent review
    `01a00485-45d9-78a0-a48a-67cdb1bc3b53` is active. No positive admission has
    occurred.
- [ ] RD-7: Under one recorded live-process owner, acquire the dated PBF,
  compute local payload evidence, extract the exact intermediate graph, and
  normalize it through the accepted RD-B adapter without fallback.
- [ ] RD-8: Admit the exact reviewed real graph through RD-C, compile the
  separate RD-D real compact artifact, run central validation, and keep
  runtime/performance/publication closed.

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

The first-wave restrictions above remain the historical boundary of baseline
`20b2be1`. The newly authorized supervised continuation may acquire and process
one full dated PBF only after RD-6 passes; it still may not commit the PBF,
install an unreviewed tool, publish a graph, or open runtime/product claims.

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
