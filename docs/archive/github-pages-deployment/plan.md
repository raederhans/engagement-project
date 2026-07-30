# Plan

## Goal

Publish the browser application at `https://raederhans.github.io/engagement-project/` and produce an evidence-backed improvement roadmap.

## Scope delivered

- Added an Actions-owned GitHub Pages deployment.
- Made Vite assets and runtime data requests work below `/engagement-project/`.
- Integrated the repository-baseline work and all runtime stabilization pull requests into `main`.
- Verified live HTML, referenced assets, Crime interaction, and Diary interaction.
- Ranked the next product and engineering improvements from build, CI, network, and browser evidence.

## Completed stages

- [x] Stage 1: Confirm repository, branch, Pages, and static-asset contracts.
- [x] Stage 2: Implement and locally validate Pages deployment.
- [x] Stage 3: Integrate into `main` and verify the live site.
- [x] Stage 4: Audit the deployed product and rank follow-up work.

## Acceptance result

- The Pages workflow completes successfully on `main`.
- The production URL and its required JavaScript, CSS, favicon, and data assets return HTTP 200.
- Crime mode supports map selection and radius changes without console errors.
- Diary mode reaches its full demo UI without console errors.
- Deployment is reproducible from `.github/workflows/deploy-pages.yml`.
- Follow-up recommendations are anchored in CI annotations, build output, browser behavior, and repository data.

## Preserved non-goals

- No redesign or unrelated feature expansion.
- No new runtime dependency.
- No fabricated production data or implicit publication of the 59 MB optional road-network artifact.
