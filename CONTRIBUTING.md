# Contributing

Thank you for improving the Philadelphia Crime Dashboard and Route Safety Diary.

## Before You Start

- Search existing issues before opening a duplicate.
- Keep changes focused on one problem or feature.
- Do not commit API keys, `.env` files, downloaded private data, or generated
  `dist/` output.
- Treat the Route Safety Diary as a prototype. Avoid copy or behavior that
  implies a route is guaranteed to be safe.

## Local Setup

The supported runtime is Node.js `^20.19.0` or `>=22.12.0` with npm 10 or later.

```bash
git clone https://github.com/raederhans/engagement-project.git
cd engagement-project
npm ci
npm run dev
```

Use `.env.local` for an optional `VITE_MAPTILER_API_KEY`. Never commit that file.

## Development Rules

- Keep the application in vanilla JavaScript unless a separate architectural
  change is agreed first.
- Reuse the existing modules under `src/api`, `src/map`, `src/charts`, and
  `src/routes_diary` before adding a new abstraction.
- Keep demo-data generation deterministic.
- Document new external data sources, licenses, and privacy limitations.

## Validation

Run the core repository gate before opening a pull request:

```bash
npm run validate
```

This validates checked-in data, runs the full Node/contract suite, builds the
production bundle and manifest, and checks bundle policy. Also run correctness
lint for JavaScript and CSS:

```bash
npm run lint:js
npm run lint:css
```

Release owners run `npm run ci:release`, which includes dependency audit,
correctness lint, the core gate, browser smoke, and visual checks. They also run
`npm run coverage:report`; coverage is report-only and does not establish
complete browser coverage. If a change affects external street-data generation,
also run the relevant fetch or segmentation command and describe the source and
result in the pull request.

## Pull Requests

Include:

- the problem being solved;
- the chosen approach and important constraints;
- user-visible or data-contract changes;
- the exact validation commands run;
- screenshots only when the interface changed.

Use a short branch name such as `fix/map-popup` or `feat/diary-filter`. Keep
generated output and unrelated cleanup out of the same pull request.

By submitting a contribution, you agree that your contribution may be licensed
under the repository's [MIT License](LICENSE).
