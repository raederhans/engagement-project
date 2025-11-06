# Fix Plan (A1–A6, B1–B3)

- A5: Audited offense codes over 24 months; generated offense_groups.json used by filtering. SQL builders apply exact case-sensitive IN lists.
- A1: Added select-on-map mode, marker A, and buffer circle.
- A2: Buffer circle updates on radius/center changes.
- A3: Time window uses start month + duration; presets added.
- A4: Drilldown populated from group selection; exact codes applied across queries.
- A6: Added help card summarizing usage and linking to README.
- B2: District labels added via mapping; shown as symbol layer and in tooltips.
- B3: District click popup fetches total and Top-3 for the selected district.
- B1: Tracts view uses precomputed counts when available, else shows population placeholder.

Logs: see logs/* for audits, fetchers, and precompute jobs.
