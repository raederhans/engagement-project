# Deployment

## Local build

`npm run build` writes the static site to `dist/`. `npm run validate` is the
core repository gate: data/tests, manifest build, and bundle policy.

Release validation is broader:

```bash
npm run ci:release
npm run coverage:report
```

`ci:release` adds a high-severity dependency audit, JavaScript/CSS correctness
lint, browser smoke, and visual regression checks. Coverage is report-only Node
coverage; it is not a percentage gate or a claim of full browser coverage.

## GitHub Pages control chain

`.github/workflows/ci.yml` is the only workflow allowed to deploy Pages.

1. `core` runs `npm run ci:core` on Windows.
2. `release` runs audit, lint, the core gate, browser smoke, and visual checks
   on Linux, then uploads `github-pages-${{ github.sha }}` from that verified
   `dist/` without rebuilding in the deploy job.
3. `coverage` creates report-only Node coverage and retains it for 14 days.
4. `deploy` needs all three jobs, runs only for a push to `main`, verifies the
   candidate SHA is still the current `main` tip, and consumes the same-run
   SHA-named artifact.

Workflow-level permission is `contents: read`. Only `deploy` receives
`pages: write` and `id-token: write`. Browser diagnostics are retained for 7
days and the Pages candidate for 1 day. A failed or superseded gate cannot
deploy; the workflow does not update visual baselines or relax bundle/pixel
budgets.

Pull-request checks may cancel an older in-progress PR run. Main release runs
do not cancel a release already in progress, and the Pages concurrency group
does not cancel an active deployment. An older release candidate that reaches
the deploy job after `main` advances must still pass the main-tip SHA check, so
a superseded candidate is refused before `deploy-pages` starts.

## External settings handoff

Repository administrators must separately verify branch protection, required
checks, the `github-pages` environment, Pages source, and Actions policy. Local
workflow edits do not change those GitHub settings and do not trigger a
deployment.
