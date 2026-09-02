# Project copy refresh task

## Goal

Bring the repository README, visible application surfaces, help text, and project-facing summary into line with the current local product, using direct and natural English and Chinese.

## Deliverables

- Human-readable English and Chinese README files with an honest local-versus-public status section.
- Simplified main shell, Crime, Area Intelligence, complete Census tract, Home Compare, Known Route, public route example, Source Health, and Diary feedback copy.
- Repository-owned interface screenshots referenced from both README files with stable relative paths.
- Updated copy-sensitive automated checks.
- A successful targeted test, production build, bundle-policy check, and representative browser review.

## Release boundary

The original local-only boundary was superseded by the user's 2026-09-02 instruction to audit, fix, merge, and push the scoped copy and P0/P1 UI work. Force push, unrelated cleanup, and new product/evidence authority remain out of scope.

## Verification completed

- Copy and contract tests passed for i18n, product integrity, complete-tract comparison, Source Health, Home Compare, route corridor, HIN, public route scenarios, and the portfolio narrative.
- Production feature build and bundle policy passed.
- Browser checks passed for the full Crime/Diary smoke path and for Area Intelligence, Home Compare, complete-tract comparison, Known Route evidence, and public route scenarios in English and Chinese, including mobile layouts where supported.
- Fresh 1440x900 Crime Explorer and Route Experience Diary screenshots were rendered from the current feature build, visually inspected, and checked for console errors. Both README image paths resolve to non-ignored repository files.
- `git diff --check` passed.

## Review status

- Copy review found that several shortened route/model notes removed material boundaries. Those files and assertions were restored before integration.
- README status is now durable across deployment and the ACS Chinese description correctly identifies the 2020–2024 estimate period.
- Final screenshots and the integrated local release checks pass. Remote CI, merge, and exact-SHA Pages verification remain pending.
