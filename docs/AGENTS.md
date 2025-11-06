# Agents Orchestration Guide (Claude Code Manager)

When the user says "continue":
1) Launch a FRESH child agent (Task Tool) to avoid context bloat.
2) Child agent must:
   a) Read `docs/TODO.md`
   b) Run shell: codex exec "continue to next task" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
   c) Monitor output; when task ends, close process.
   d) Re-open a NEW child agent and repeat b) until Pending is empty or `# STOP`.

Stall rule: if no TODO change + no new log lines for 15 min, kill and relaunch.
After each cycle, post a 3-line summary: {did, next, risks}.
