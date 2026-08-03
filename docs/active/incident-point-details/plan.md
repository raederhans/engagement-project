# Incident point details and removable buffer selection

## Goal

Restore inspectable single-incident points after cluster expansion and provide an explicit way to remove an already placed buffer-analysis point.

## Scope

- Keep low-zoom clustering and the existing viewport-bounded incident query.
- At high zoom, keep unclustered incidents visible and make each incident clickable.
- Show a bilingual, escaped incident popup using fields already returned by the point query.
- Reuse the existing clear-selection control in buffer mode when point A exists.
- Clearing point A also clears point B, addresses, transient pick state, comparison state, markers, buffers, incident layers, charts, and URL point parameters through the existing refresh path.
- Preserve all unrelated P1-5-8 work in its separate worktree.

## Non-goals

- Do not expand the point query to citywide data outside the current viewport.
- Do not change cluster colors, category classification, comparison metrics, chart studio behavior, or backend data contracts.
- Do not merge or deploy stacked draft PRs.

## Acceptance criteria

1. Low zoom still renders clusters and cluster clicks still expand the map.
2. The GeoJSON source stops clustering at the documented threshold so high zoom exposes single incidents.
3. Clicking an unclustered incident opens a bilingual detail popup with offense, date/time, location, and district when available.
4. Popup content escapes source-controlled text and missing values use a localized unavailable label.
5. Pointer cursor and listeners are removed on controller teardown.
6. Buffer mode shows a localized remove-location control only after point A exists.
7. Activating it clears A and B state, inputs, markers, buffers, points, analysis output, and URL point keys without issuing a citywide incident request.
8. Focused contracts, full validation, browser smoke, bundle policy, audit, and bilingual desktop/mobile checks pass from the isolated worktree.

## Phases

1. Reproduce and lock the missing incident-detail and clear-selection behavior with failing tests.
2. Add the smallest interaction and state-reconciliation changes.
3. Run focused validation and review the diff for simpler alternatives and regressions.
4. Run isolated full/live validation, then commit and publish a stacked Draft PR if all gates pass.
