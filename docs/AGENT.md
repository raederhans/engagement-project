# Automation Tasks & TODO.md (Single Source of Truth)

- Use a single file `docs/TODO.md` to track phased tasks.
- Sections: **Pending**, **In Progress**, **Completed**, **Blocked**.
- Item format: `- [ ] <verb phrase>  (ID: <short-id>)  (owner: codex|human)`
- Status is changed ONLY by moving the line between sections and toggling the box.

## Execution Rules for codex
1) Before coding, consult `crime_dashboard_codex_plan.txt`.
2) Always pick the TOP Pending item owned by `codex`.
3) After finishing, move it to **Completed** and append a one-line outcome.
4) If blocked, move to **Blocked** with reason + suggestion.
5) Keep long logs in `logs/`, not in chat.

Stop conditions: Pending is empty OR `# STOP` appears in `docs/TODO.md`.
