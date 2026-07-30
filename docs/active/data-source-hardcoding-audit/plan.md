# Plan

## Goal

Make production data loading explicit, current, and resilient: verified live APIs are the primary source when they exist, while bundled files remain only as documented fallbacks or intentional demo fixtures.

## Scope

- Inventory runtime endpoints, bundled datasets, geographic identifiers, dates, thresholds, and feature flags.
- Separate project configuration from stale business data and accidental hardcoding.
- Verify the official Philadelphia, Census, and CARTO data contracts used by the application.
- Change production loaders to API-first where the live API is suitable, with bounded local fallback where availability matters.
- Keep Diary seed routes and segment ratings explicitly demo-only unless a real public API contract exists.
- Add focused tests for source ordering, validation, and fallback behavior.
- Rebuild, run browser smoke checks, integrate through GitHub, and verify the deployed site.

## Stages

- [x] Stage 1: Map all runtime data sources and hardcoded values.
- [x] Stage 2: Verify current official API contracts and choose source policy per dataset.
- [x] Stage 3: Implement the minimum configuration and loader changes.
- [x] Stage 4: Validate data, tests, build, fallback paths, and browser behavior.
- [ ] Stage 5: Integrate, deploy, and verify live assets and API behavior.

## Acceptance criteria

- Every production data source has an explicit primary source and fallback policy.
- Normal production runs use HTTPS or same-origin Pages assets only; no browser request depends on a developer-machine path.
- Census demographics and authoritative boundaries prefer verified online APIs instead of silently serving bundled snapshots first.
- Region/year identifiers are defined once and are configurable where freshness requires it.
- Demo fixtures cannot be mistaken for production or community-submitted data.
- API failures still produce a usable UI when a validated bundled fallback exists.
- Standard validation, build, targeted tests, and both deployed browser modes pass.
- The final report identifies intentionally retained local data and the reason for each category.

## Non-goals

- No fabricated backend for Diary submissions or ratings.
- No new dependency or broad architecture rewrite.
- No replacement of stable UI constants unless they incorrectly encode changing business data.
- No publication of the 59 MB optional road-network file without a deliberate delivery design.

## Risks

- Browser CORS or rate limits can make a valid upstream API unsuitable as the only source.
- Different tract vintages can cause GEOID or geometry mismatches.
- Live datasets can change schemas; validation must reject malformed responses before caching them.
- API-first loading can increase startup latency, so timeouts and fallbacks must remain bounded.
