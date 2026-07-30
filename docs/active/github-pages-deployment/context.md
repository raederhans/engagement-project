# Context

## Current truth

- Repository: `raederhans/engagement-project`.
- Working branch: `agent/repair-repository-baseline` at `e5a7de0`; working tree was clean at task start.
- Draft pull request #7 targets `main`; its CI run passed.
- GitHub Pages is enabled with workflow build type and reports `https://raederhans.github.io/engagement-project/`.
- The live root currently returns HTTP 404.
- The branch has CI but no Pages deployment workflow, and `vite.config.js` does not set a repository-subpath base.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-07-30 | Extend draft pull request #7 instead of creating a parallel deployment branch. | Keeps the public-contract and deployment repairs in one validated integration path. |
| 2026-07-30 | Treat live HTML plus referenced asset probes as the deployment gate. | Prevents a false success where the root loads but JavaScript or CSS returns 404. |
| 2026-07-30 | Derive the Vite base from `GITHUB_REPOSITORY` during Actions builds and route runtime public files through `import.meta.env.BASE_URL`. | Keeps local builds root-based while making project-site builds and future repository renames safe. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| None | Primary agent | N/A | No long-running process started. |

## Handoff

No handoff. The primary agent owns implementation, integration, deployment verification, and the final audit.

## Next step

Review and commit the locally validated deployment change, then integrate pull request #7 into `main`.
