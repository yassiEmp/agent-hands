---
name: agent-hands
description: Human-rate mouse and keyboard for a real Chromium browser, including one you launched or attached to yourself. Use when acting on a site where the user is logged in with real credentials AND automated-looking input could get that account banned or rate-limited — banking, mail, ad platforms, SEO tools, marketplaces, social, CRM, hosting dashboards. Also use whenever the browser is not one agent-browser started, because agent-browser cannot attach to it at all. Triggers include "log into", "my account", "my dashboard", "avoid getting banned", "the site blocks automation", "click naturally", "type like a human", "the click is not registering", "use my own browser", "drive the browser I opened". Do NOT use for public pages, scraping, or research on a throwaway agent-browser session with no login: there agent-browser's own click is faster and nothing can be banned. Never moves the physical cursor and never raises the window.
allowed-tools: Bash(agent-hands:*), Bash(hands:*), Bash(npx agent-hands:*)
---

# agent-hands

Human-rate input for a real Chromium browser, over raw CDP. Dispatches a whole
gesture at 60-100Hz on one socket, so mouse paths and keystroke timings fall
inside human ranges.

Install: `npm i -g agent-hands`, then `agent-hands doctor`. It needs Node 22+
and a Chromium browser. `agent-win` and `agent-browser` are optional; `doctor`
says whether each is present and what it unlocks.

## Start here

This file is a discovery stub, not the usage guide. Load the real content from
the CLI so it always matches the installed version:

```bash
agent-hands skills get core          # workflows, decision rules, gotchas
agent-hands skills get core --full   # adds the timing evidence and troubleshooting
```

## The loop

```bash
agent-hands browsers                    # what exists, what is reachable
# more than one reachable? ASK THE USER which to drive, then: agent-hands use <n>
agent-hands snapshot                    # see the page: @e1 @e2 @e3
agent-hands click --ref @e5
```

## Which tool

`agent-hands` reads and acts. It has its own `open`, `text` and `snapshot`, so
it is a complete loop with no second tool required.

`agent-browser` owns the pooled throwaway sessions it launches, and is faster
there because it dispatches input instantly. It cannot attach to a browser it
did not start.

| Situation | Tool |
|---|---|
| Throwaway session, no login, nothing to lose | `agent-browser` |
| The browser carries a real account | `agent-hands` |
| The site scores behaviour | `agent-hands` |
| The browser is one you launched or attached to | `agent-hands` — the only option |

Earlier versions of this file called `agent-hands` a last resort behind
`agent-browser`. That stopped being true once it grew `launch`, `open`,
`snapshot` and `text`.

## Do not write a raw CDP script

A hand-rolled CDP or Playwright script against the same browser dispatches
input instantly, which is the signal this tool exists to avoid; it opens a
second connection, which re-prompts the user on a browser holding their live
session; and it leaves no audit line. If a verb you need is missing, say so and
stop.
