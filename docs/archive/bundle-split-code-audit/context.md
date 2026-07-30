# Context

## Starting state

- Repository: `raederhans/engagement-project`.
- Branch: `agent/split-and-audit`, created from clean `main` at `71a2d5232fd064b0f189bb55629ec8d2f2c79baa`.
- The initial minified JavaScript entry was about 1.1 MB, and mixed static/dynamic imports prevented useful boundaries.
- The app is a Vite static deployment with Crime and Diary modes selected through `?mode=`.
- No new backend or dependency was authorized.

## Final architecture

- `src/main.js` remains the composition root and dynamically loads the Crime controller, Diary controller, Diary insights, and charts only when their owner is active.
- A latest-only serial queue prevents stale mode transitions from committing.
- Crime owns its points, popups, tooltip, marker, layers, banners, and tract-outline lifecycle; deactivate invalidates late work before it can mutate the map or DOM.
- Public Crime, geography, and demographic data remain API-first with bounded same-origin fallbacks.
- Diary remains a truthful browser demo unless `VITE_DIARY_API_BASE` is configured; GitHub Pages does not pretend to persist shared submissions.

## Final integration and deployment

- Runtime commit `f84d47eab8a7c4e73398dfddc83f07e068c5acd1` merged through pull request `#17`.
- Merge commit `6973c365687511dc1b919f66ba091ea80bba99a4` is the verified `origin/main` state.
- Main CI run `30518108612` and Pages run `30518108618` completed successfully.
- The production root and referenced entry JavaScript returned HTTP 200.
- Direct Crime loaded its map and charts; direct Diary loaded without Crime API requests.
- Both deployed modes produced zero browser errors or warnings.
- This final archive change is documentation-only and does not alter the verified runtime bundle.

## Review ownership

- `full_code_review`: correctness, security, quality, performance, and test review; final result `APPROVE`.
- `architecture_review`: boundaries, coupling, code-splitting, and static-hosting challenge review; final result `APPROVE`.
- Root agent owned all edits, tests, Git operations, integration, and deployment.

## Recommended next step

Keep the site backend-free until shared Diary persistence becomes a product requirement. The next low-risk engineering work is cleaning the developer-only snapshot/precompute contracts and pinning GitHub Actions to immutable SHAs.
