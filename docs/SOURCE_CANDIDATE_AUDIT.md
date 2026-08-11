# ACS/VRE/HIN candidate audit lifecycle

The source candidate audit is an operational review aid for the static GitHub
Pages application. It downloads and validates temporary candidates against the
committed source contracts. It does not update runtime data, create a branch or
pull request, merge a change, deploy Pages, or decide release truth.

## Source contracts

| Source | Source owner | Semantic/source clock | Artifact identity | Schema and identity boundary |
| --- | --- | --- | --- | --- |
| ACS B01003 estimates | U.S. Census Bureau | The admitted 2020–2024 estimate period ends `2024-12-31`; `retrievedAt` is separate. | `manifest.rowsSha256` covers `JSON.stringify(rows)` and excludes retrieval time. | Exact 2024 five-year release, B01003 estimate/MOE variables, Philadelphia County complete tract geography, row count, GEOIDs, and snapshot schema. |
| ACS B01003 VRE | U.S. Census Bureau | The admitted 2020–2024 estimate period ends `2024-12-31`; access and retrieval clocks remain separate. | `manifest.rowsSha256` covers the ordered estimate/80-replicate rows and excludes retrieval time. | Exact 2024 five-year release, summary level 140, B01003, 2020 Census tract geography, 80 ordered replicates, Philadelphia GEOIDs, URLs, and snapshot schema. |
| HIN 2025 | City of Philadelphia OTIS | `sourceAsOf` is ArcGIS `dataLastEditDate`; the 2019–2023 crash period, item modification, retrieval, candidate audit, admitted build, and human review clocks are distinct. | The lifecycle receipt identifies the exact rendered snapshot bytes with SHA-256. | Exact ArcGIS item/layer, field types, polyline geometry, feature/geometry counts, crash period, network vintage, normalized rows, receipt, and official context semantics. |

Hash matches prove only the identity required by each artifact contract. They do
not prove live availability, completeness, safety, predictive value, or general
functional correctness.

## Candidate-only operation

Run the same command used by the scheduled workflow:

```text
npm run data:audit:source-candidates -- --output-dir <temporary-directory>
```

The command checks all three sources sequentially and writes JSON/Markdown audit
evidence. Before each run it removes only this tool's fixed report/candidate
filenames from the selected output directory, so a reused directory cannot mix
prior candidates with the current report. Other files are left untouched. Each
upstream request has a 45-second timeout; the workflow's 10-minute job timeout
remains a final runner-level fallback. Its dispositions are:

- `unchanged`: admitted semantic content is unchanged. No candidate file is
  retained and committed artifacts remain untouched.
- `review-required`: a validated temporary candidate differs. Candidate files
  are retained only under the requested output directory, the command exits
  non-zero, and admission remains pending human review.
- `failed`: transport, official contract, committed receipt, normalization, or
  validation failed. No unavailable source is converted to zero and the command
  exits non-zero.

The scheduled workflow has only `contents: read`, uploads temporary evidence,
and then fails closed for `review-required` or `failed`. It has no Git, issue,
pull-request, merge, Pages, or deployment write path. Its success or failure is
not wired into the release workflow and external endpoint availability is not a
release gate.

## Human admission and rollback

ACS estimates and VRE are pinned to the currently admitted release. A new
vintage, period, table, variable, summary level, geography vintage, replicate
schema, row set, or semantic value requires review of official Census evidence,
the committed artifact, source-specific contracts, tests, Source Health receipt,
and product meaning. The scheduled audit does not discover or admit a newer
annual release automatically.

HIN semantic changes continue to use the existing controlled command only after
official review:

```text
npm run data:acquire:hin-2025 -- --accept-reviewed-change --reviewed-by "reviewer identity"
```

The audit never invokes those acceptance flags. A HIN candidate receipt is
`not-admitted`, keeps `builtAt`, `reviewedAt`, and `reviewedBy` null, and cannot
replace the committed lifecycle receipt. Rollback is the normal reviewed Git
revert of the admitted snapshot/receipt and matching contracts; the audit never
modifies those rollback sources.

## Static Source Health boundary

Static Pages exposes small receipt projections for the committed ACS estimates,
ACS VRE, and HIN artifacts. These observations are `partial` historical/bundled
evidence, not live endpoint health. If a feature later loads and validates its
same-origin receipt, that runtime observation replaces the matching bundled
projection by source ID. A runtime receipt failure therefore replaces the
bundled state with `unavailable` instead of creating a duplicate or retaining a
pseudo-current value.

Known Route remains user-supplied browser geometry, not GPS matching. The source
audit sends no route geometry, Diary content, exact address, account identifier,
or telemetry to Census, ArcGIS, the City, or GitHub artifacts.
