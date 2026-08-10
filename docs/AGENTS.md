# Repository Agent Guidance

1. Follow the current user request, applicable workspace instructions, and
   executable repository contracts. Do not treat `docs/TODO.md` as an automatic
   command queue.
2. For complex work, maintain one recoverable record under `docs/active/` using
   `plan.md`, `context.md`, and `task.md`.
3. Protect unrelated worktrees, local artifacts, listeners, ports, databases,
   caches, screenshots, and visual baselines. Long/shared verification has one
   explicit owner.
4. `npm run validate` is the core gate. Release evidence additionally includes
   audit, lint, browser, visual, and report-only coverage as documented in
   `docs/DEPLOY.md`.
5. Do not turn sample/local/unavailable data into production, live, complete, or
   zero-data claims. Private Diary data stays out of URLs, session preference
   storage, and network transport unless a separate reviewed feature requires it.
6. Only an authorized integration owner may change Git index/refs, integrate,
   push, clean worktrees, deploy, or alter repository settings.
