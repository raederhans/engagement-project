# Remote governance mutation plan

Observed read-only on 2026-08-31 for `raederhans/engagement-project`. This file is a plan, not evidence that
any mutation was executed.

## Current state

| Surface | Read-only observation |
| --- | --- |
| Description | `Interactive Philadelphia crime dashboard and browser-based Route Safety Diary prototype.` |
| Homepage | empty |
| Topics | `crime-data`, `data-visualization`, `geospatial`, `javascript`, `maplibre`, `philadelphia`, `route-safety`, `vite` |
| Default branch | `main@cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7` |
| Rulesets | none |
| Branch protection | `main` unprotected |
| Pages | workflow deployment; `https://raederhans.github.io/engagement-project/`; HTTPS enforced |
| Latest exact-SHA release workflow | run `33291985358`, success for `cfb0af1…` |
| Tags/releases | none |
| Open PRs | #44, #48, #67, #68 |
| Remote branches | `main`, active `codex/route-decision-s6-real-data`, PR heads for #44/#48/#67/#68 |

## Authorized mutation sequence

Run only after the final integration owner has an exact main SHA whose local gates, remote CI jobs
`coverage`, `core`, `release`, and Pages deployment all succeed for that same SHA.

```powershell
$repo = 'raederhans/engagement-project'
$exactSha = gh api "repos/$repo/commits/main" --jq '.sha'

gh repo edit $repo `
  --description 'Philadelphia Urban Evidence Lab: reproducible urban data, spatial evidence, and privacy-bounded product surfaces.' `
  --homepage 'https://raederhans.github.io/engagement-project/'

gh repo edit $repo --remove-topic crime-data --remove-topic data-visualization --remove-topic route-safety `
  --remove-topic vite --add-topic civic-tech --add-topic data-engineering --add-topic evidence `
  --add-topic geospatial --add-topic javascript --add-topic maplibre --add-topic philadelphia `
  --add-topic urban-analytics

gh api --method PUT "repos/$repo/branches/main/protection" `
  --input docs/governance/main-branch-protection.v2.json

gh release create v2.0.0 --repo $repo --target $exactSha `
  --title 'Philadelphia Urban Evidence Lab v2.0.0' `
  --notes-file docs/governance/v2.0.0-release-notes.md
```

After every mutation, re-read the exact state:

```powershell
gh repo view $repo --json description,homepageUrl,repositoryTopics,defaultBranchRef
gh api "repos/$repo/branches/main/protection"
gh release view v2.0.0 --repo $repo --json tagName,targetCommitish,url
```

## PR, branch, and document audit

- **#44 / `codex/dataset-anchored-time-window`** and **#48 / `codex/tract-outline-controls`** are old but
  not proven obsolete. Review their patches against the final main tree; close/delete only after exact
  containment, replacement, or an explicit product decision. Age alone is not deletion authority.
- **#67 MapLibre 6** is a distinct runtime/performance migration and must not be merged by this portfolio
  release merely because it is open.
- **#68 grouped dependency update** requires its own locked-dependency and release gates.
- **`codex/route-decision-s6-real-data`** is active protected WIP and is not cleanup-eligible.
- Existing active records for current worktrees remain live. Archive a task directory only when its code,
  evidence, Git topology, external state, and remaining authority are all reconciled.
- The old README deployment wording that referenced `.github/workflows/deploy-pages.yml` is obsolete; the
  current workflow is `.github/workflows/ci.yml` with the name `CI and Pages release`.

## Stop conditions

- Do not create `v2.0.0` if exact-SHA CI or Pages evidence is missing.
- Do not enable a required check that does not run on pull requests.
- Do not close PRs or delete branches when patch containment or ownership is uncertain.
- Do not infer data, model, serving, scientific, safety, or routing authority from repository metadata or a
  GitHub release.
