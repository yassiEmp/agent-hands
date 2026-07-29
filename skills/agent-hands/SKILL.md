---
name: agent-hands
description: Human-rate mouse and keyboard for agent-browser sessions. Use ONLY when acting on a site where the user is logged in with real credentials AND automated-looking input could get that account banned or rate-limited — banking, mail, ad platforms, SEO tools, marketplaces, social, CRM, hosting dashboards. Triggers include "log into", "my account", "my dashboard", "avoid getting banned", "the site blocks automation", "click naturally", "type like a human", "the click is not registering". Do NOT use for public pages, scraping, or research: those belong on a throwaway agent-browser session with no profile, where agent-browser's own click is faster and nothing can be banned. Pairs with agent-browser, which keeps navigation, snapshots and extraction. Never moves the physical cursor and never raises the window.
allowed-tools: Bash(agent-hands:*), Bash(hands:*), Bash(npx agent-hands:*)
---

# agent-hands

Human-rate input for a running `agent-browser` session, over raw CDP.
Dispatches a whole gesture at 60-100Hz on one socket, so mouse paths and
keystroke timings fall inside human ranges.

Install: `npm i -g agent-hands`

## Start here

This file is a discovery stub, not the usage guide. Load the real content
from the CLI so it always matches the installed version:

```bash
agent-hands skills get core          # workflows, decision rules, gotchas
agent-hands skills get core --full   # adds the timing evidence and troubleshooting
```

## One-line orientation

`agent-browser` navigates and reads. `agent-hands` clicks, types and scrolls.
They share one browser. Use both in the same task.

## Escalate, do not start here

1. **Throwaway browser** — `agent-browser --session scratch open <url>`, no
   profile, no logins. Most work belongs here.
2. **Logged-in profile** — only when the task needs the user's account.
3. **agent-hands** — only when 2 applies and the site can ban that account.

On a throwaway session this tool buys nothing: there is no account to lose.
