# DevRel context — agent-hands

## Project (general)

- What: CLI that gives AI agents human-rate mouse and keyboard on a real
  Chromium browser, including the user's own logged-in Edge or Chrome.
  First five minutes: `npm i -g agent-hands`, `agent-hands launch <url>`,
  `snapshot`, `click --ref @e1`.
- Adopter: individual developers who run coding agents (Claude Code, agent-browser users).
- Competes with: agent-browser's own input (and its PR #1810 `--human` mouse),
  Playwright/Puppeteer + ghost-cursor, stealth plugins, writing it by hand.
- No company, nothing paid. MIT. Solo maintainer, X: @yassi_yari.
- Earlier plan and channel list: `docs/growth-playbook.md`.

## Task: star growth without harassing users (22 Oct 2026)

- Baseline 22 Oct 2026: 2 stars; npm 852 downloads (19 Sep–18 Oct); GitHub
  14 days: 11 views / 6 unique visitors, 20 clones / 18 unique; 1 referrer (github.com).
- Diagnosis: a visit problem. Installs come from npm and agents; almost nobody opens the repo.
- Rejected for lack of community proof: VoltAgent/awesome-agent-skills #1058
  (closed), awesome-claude-code #2849 (closed, not planned). Open:
  agent-browser PR #1857, awesome-browser-automation PR #154.
- Readiness gate (cold run by the agent, not a stranger; this machine has pins
  and profiles a stranger lacks): failed at step 3 (`click --ref @e3` on a
  one-ref page). Fixed in a20e648 with SECURITY.md (private reporting on),
  CONTRIBUTING.md, README claims, exit codes.
- Open interview questions: communities with account history, launch-week
  hours, any fixed date.
- cleanup when: the launch plan is executed and day-30 numbers are read.
