# Project copy refresh plan

1. Confirm the current local candidate, published baseline, and product boundaries. — completed
2. Rewrite the English and Chinese README around user-visible capabilities and honest status. — completed
3. Simplify the main shell and feature-surface copy without weakening privacy, evidence, or recommendation boundaries. — completed
4. Update copy-sensitive tests, build the site, and inspect representative English and Chinese screens. — completed
5. Review the copy diff for semantic regressions, restore required product boundaries, and reconcile it into the final P0/P1 UI structure. — completed
6. Recapture screenshots from the final integrated build and require local plus remote release gates before merging to `main`. — local complete; remote pending

## Boundaries

- Preserve the protected primary checkout and all unrelated worktrees.
- Do not modify the user's protected primary checkout or its untracked files.
- The user's 2026-09-02 instruction authorizes commit, PR integration, merge, and push for this scoped copy/UI delivery; it does not authorize force push or unrelated cleanup.
- Do not claim that local checks prove remote CI or a public release.
