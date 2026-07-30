# Plan

## Goal

Publish the browser application at `https://raederhans.github.io/engagement-project/` and produce an evidence-backed improvement roadmap.

## Scope

- Add a GitHub Pages build and deployment workflow.
- Make Vite-generated asset URLs work under the repository subpath.
- Integrate the existing repository-baseline pull request into `main`.
- Verify the live HTML and its referenced assets.
- Audit the shipped application for the next highest-value improvements.

## Sources of truth

- `origin/main` and pull request #7.
- `.github/workflows/`, `vite.config.js`, `package.json`, and the generated `dist/` output.
- GitHub Pages API, Actions runs, and live HTTP responses.

## Stages

- [x] Stage 1: Confirm repository, branch, Pages, and static-asset contracts.
- [x] Stage 2: Implement and locally validate Pages deployment.
- [ ] Stage 3: Integrate into `main` and verify the live site.
- [ ] Stage 4: Audit the deployed product and rank follow-up work.

## Acceptance criteria

- The Pages workflow completes successfully on `main`.
- The production URL returns HTTP 200.
- Every CSS and JavaScript asset referenced by the production HTML returns HTTP 200.
- The deployment is reproducible through the repository workflow.
- Improvement recommendations cite concrete code, runtime, or product evidence.

## Non-goals

- No redesign or feature expansion during the deployment change.
- No new runtime dependency.
- No production-data or backend migration.

## Risks and constraints

- GitHub Pages serves this project below `/engagement-project/`, so root-relative URLs can break even when the HTML returns 200.
- The current deployment work extends draft pull request #7 and must preserve its validated repository-baseline changes.
- The application uses public civic data; recommendations must distinguish prototype guidance from safety claims.
