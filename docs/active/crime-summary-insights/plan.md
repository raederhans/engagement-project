# Crime analysis summary insights

## Goal

Replace the sparse and frequently misleading recent-30-day percentage with stable, selected-window facts that help users interpret the current buffer analysis.

## Scope

- Remove the recent-versus-prior 30-day percentage from the single-area summary and two-area detail table.
- Stop issuing the two count queries used only for that percentage.
- Add a normalized 30-day average derived from the full selected window.
- Show the leading category with its count and share, plus a compact top-three category breakdown.
- Keep English and Simplified Chinese copy synchronized.
- Preserve the existing historical-data caveat, comparison behavior, saved-artifact schema, and all upstream PR #51 behavior.

## Non-goals

- No forecasting, safety score, statistical significance claim, or Bayesian smoothing.
- No backend, dataset, URL, chart-studio, clustering, or map interaction changes.
- No merge or deployment of the stacked PR chain.

## Acceptance criteria

1. No summary surface renders `Last 30 days`, `Recent 30-day change`, or a `-100%` short-window comparison.
2. Each point requires only the selected-window total, top categories, and optional population estimate.
3. The primary summary shows total incidents, normalized incidents per 30 days, leading-category count/share, and up to three category rows.
4. The detailed A/B table replaces recent change with normalized incidents per 30 days.
5. Invalid or zero-length windows render the normalized metric as unavailable rather than `NaN` or `Infinity`.
6. Focused tests witness RED before implementation and pass after the minimal patch.
7. Flagged full validation, bundle policy, dependency audit, and isolated browser smoke pass before delivery.

## Phases

1. Reproduce and lock summary/query behavior with failing tests.
2. Implement the smallest derived-metric and rendering changes.
3. Run review, full validation, bilingual browser QA, commit, and publish a stacked Draft PR.
