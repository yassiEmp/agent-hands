---
name: agent-hands-core
description: Core agent-hands usage guide. Read before running any agent-hands command.
---

# agent-hands core

Human-rate mouse and keyboard for a running `agent-browser` session.

## Decide before you launch anything

Three levels. Start at 1. Escalate only when the task forces it.

**1. Throwaway browser — the default for most work.**

```bash
agent-browser --session scratch open <url>     # no --profile, no logins
```

Public pages, research, scraping, docs, competitor checks, anything read-only.
Nothing to ban, nothing to leak. Several can run in parallel. Close when done.

**2. The logged-in profile — only when the task needs the user's account.**

```bash
agent-browser --session work --profile "<profiles>/main" open <url> --headed \
  --init-script "<profiles>/init-normalize.js"
```

Dashboards, mail, anything behind a login. This profile carries real cookies.
A ban here costs the user an account, not a scrape. Do not use it to read a
public page you could have read at level 1.

**3. agent-hands — only when level 2 applies and the site can punish you.**

Use it when the account is real and the site scores behaviour, or when
`agent-browser`'s instant input is visibly rejected.

Running `agent-hands` against a throwaway session buys nothing. There is no
account to lose and no reputation to protect. Use `agent-browser click` there;
it is faster.

## When to use which tool

| Task | Tool |
|---|---|
| Open a URL, read text, snapshot, cookies, tabs | `agent-browser` |
| Click, type, fill, press a key, scroll on a credentialed site | `agent-hands` |
| Click on a throwaway session | `agent-browser` |

Both drive the same browser at the same time. No handoff, no conflict.
`agent-hands` has no `open`; navigation always stays with `agent-browser`.

## The loop

```bash
S="--session work"

agent-browser $S open https://example.com     # navigate with agent-browser
agent-browser $S snapshot -i                  # find the element, get a selector
agent-hands $S click "#submit"                # act with agent-hands
agent-browser $S get url                      # verify with agent-browser
```

Always verify the result with `agent-browser` after acting. `agent-hands`
reports that it dispatched the gesture, not that the page reacted.

## Commands

```bash
agent-hands click "#submit"                # css selector — most reliable
agent-hands click --text "Se connecter"    # visible text, ranked match
agent-hands click --xy 420 300             # raw viewport coordinates
agent-hands hover ".menu-item"
agent-hands move --xy 200 400
agent-hands fill "#email" "you@example.com"
agent-hands type "into whatever has focus"
agent-hands press Enter                    # Tab Escape Backspace Delete Arrow*
agent-hands scroll 600                     # negative scrolls up
agent-hands where                          # last cursor position
agent-hands doctor                         # is the session reachable?
```

Flags: `--session <name>` (default `work`), `--speed 1.6` brisk / `0.7` slow,
`--json` machine-readable, `--quiet` exit code only.

## Rules that prevent the common failures

1. **Prefer a CSS selector.** `--text` ranks candidates — exact over partial,
   real text over `aria-label`, button over field — but a page with several
   "Search" controls can still resolve the wrong one. Get selectors from
   `agent-browser snapshot -i`.
2. **Submit with `press Enter`.** Do not hunt for the submit button. Verified:
   `fill "#searchbox_input"` then `press Enter` returns real results.
3. **`fill` clicks first, `type` does not.** Use `fill` for a named field. Use
   `type` only when focus is already where you want it.
4. **Re-resolve after the page changes.** Selectors are resolved fresh on every
   command, so this is automatic — but re-snapshot before choosing a new one.
5. **Pace multi-page runs.** The gesture is human; the sequence still needs to
   be. Roughly one page action every 2 to 3 seconds.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | gesture dispatched |
| 1 | runtime failure (session down, element not found) |
| 2 | usage error (unknown command or key) |

With `--json` every result is one line: `{"ok":true,"command":"click",...}` or
`{"ok":false,"error":"...","code":"ENOTFOUND"}`.

## Sessions

A session name pairs to one Chrome profile directory, `work` -> `main`,
`work-2` -> `main-2`. One browser per profile: Chrome locks the directory, so
two agents cannot share a profile. Give each parallel agent its own session.

`agent-hands doctor --session work-2` confirms a slot is live before you use it.

## What it does not do

- It does not defeat Cloudflare Turnstile, DataDome, or PerimeterX. Those also
  fingerprint canvas, WebGL, and TLS. Do not promise a protected site will work.
- `navigator.webdriver` is hidden by the browser's init script, not by this tool.
- Pages listening for `wheel` specifically will not see scroll events. See
  `--full` for why.
