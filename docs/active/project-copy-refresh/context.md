# Project copy refresh context

## Current truth checked on 2026-09-02

- The user authorized review, remediation, integration, and push of this copy refresh together with the frontend P0/P1 work.
- GitHub Pages deploys only an exact `main` SHA that passes the repository's Windows and Linux release gates; README status copy must remain durable across that deployment.
- The copy branch is a semantic input to the final UI integration, not a whole-file replacement for the newer P0/P1 structure.

## Copy principles

- Start with what a person can do on each screen.
- Prefer ordinary terms such as “passed the required checks” over internal admission vocabulary.
- Keep unavailable, partial, uncertain, and zero as distinct states.
- Keep historical evidence separate from live conditions, prediction, safety scores, and route recommendations.
- Explain browser-local data and external-request privacy before asking for consent.

## Review remediation

- Restored the complete historical, non-live, non-predictive, no-risk-score, and no-route-recommendation boundaries where shortening changed meaning.
- Kept shorter labels and plain-language workflow copy where the same boundary remains available in the local disclosure or help surface.
- Replaced date-bound "previous baseline" README claims with the exact-SHA CI and Pages contract.
