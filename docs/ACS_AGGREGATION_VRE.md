# ACS 2024 Aggregation Uncertainty and Geography Vintage Guard

Official evidence was accessed on **2026-08-10**. Only U.S. Census Bureau
sources are used in this admission decision.

## Admission decision

The foundation admits one runtime indicator: **B01003 total population** for
two or more complete Philadelphia census tracts. It calculates the aggregate
estimate and uncertainty from the official 2020-2024 ACS 5-year Variance
Replicate Estimates (VRE). It does not aggregate a partial tract, address point,
route buffer, or other fractional geography.

The 2024 ACS VRE documentation specifies 80 ordered pseudo-estimates
(`Var_Rep1` through `Var_Rep80`). For a sum, the published estimate and every
replicate are summed separately. Variance is then `4/80` times the sum of the
squared differences between the aggregate replicate and aggregate estimate;
the 90% margin of error is `1.645 × sqrt(variance)`, rounded once at the end.

The official 2024 geography-vintage table identifies census tract summary
level 140 as **2020 Census** geography for the 2020-2024 ACS 5-year release.
The product therefore returns `not-comparable` for mixed or unsupported tract
vintages and `unavailable` when a reliable exact-GEOID correspondence is absent.

## Current product variables reviewed

| Current adapter field | Source table/variable | 2024 VRE evidence | Foundation decision |
| --- | --- | --- | --- |
| Population | `B01003_001` | `B01003` is listed; the official Pennsylvania tract ZIP contains 408 Philadelphia rows with 80 ordered, present replicates. | Admitted for complete-tract sums. |
| Renter counts | `B25003_001`, `B25003_003` | `B25003` is listed and its Pennsylvania tract ZIP returns HTTP 200. | Not yet admitted; no selected-table snapshot or product UI consumer is part of this batch. |
| Poverty counts in Census Reporter | `B17001_001`, `B17001_002` | `B17001` is listed and its Pennsylvania tract ZIP returns HTTP 200. | Not yet admitted; the configured Census subject endpoint instead returns `S1701_C03_001E`, which is not in the official 2024 VRE table list. No cross-table substitution is made. |
| Median household income | `B19013_001` | `B19013` is absent from the official 2024 VRE table list. | Rejected for aggregate uncertainty; medians are not summed or population-weighted. |

“Not yet admitted” is not a claim that the official table is unavailable. It
means this foundation has not acquired, validated, budgeted, and exposed the
required selected lines. Missing coverage never falls back to adding published
MOEs, area weighting, population weighting, or a locally invented formula.

## Official sources

- 2024 VRE landing page and table/geography availability:
  <https://www.census.gov/programs-surveys/acs/data/variance-tables/2024.html>
- 2020-2024 VRE method documentation:
  <https://www2.census.gov/programs-surveys/acs/replicate_estimates/2024/documentation/5-year/2020-2024_Variance_Replicate_Table_Documentation.pdf>
- Official 2024 VRE table list:
  <https://www2.census.gov/programs-surveys/acs/replicate_estimates/2024/documentation/5-year/VRE_TABLE_LIST_2024.csv>
- B01003 Pennsylvania tract VRE package:
  <https://www2.census.gov/programs-surveys/acs/replicate_estimates/2024/data/5-year/140/B01003_42.csv.zip>
- 2024 ACS geography vintages:
  <https://www.census.gov/programs-surveys/acs/geography-acs/geography-boundaries-by-year.2024.html>

## Product boundaries

- The 90% MOE represents ACS sampling uncertainty for the admitted aggregate;
  it is not an error ceiling and does not describe any individual.
- A census tract result does not describe a specific address or person.
- Different ACS periods or geography vintages are not directly compared by
  this foundation.
- The table renderer is the primary presentation. A map may later provide
  selection context, but it must not redefine the admitted complete tracts.
- `src/analysis/acs_aggregation_evidence_adapter.js` is an explicit future
  adapter only. The current Evidence Bundle schema is unchanged.
- The facade `src/acs_aggregation.js` is deliberately outside current initial,
  Crime, and map entry graphs. An integration owner may lazy-load it only when
  a reviewed complete-multi-tract selection surface exists.
