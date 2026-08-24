---
name: agent-hands-core
description: Core agent-hands usage guide. Read before running any agent-hands command.
---

# agent-hands core

Human-rate mouse and keyboard for a real browser.

## The loop, and why you stay inside it

```bash
agent-hands browsers                    # what exists, what is reachable
# more than one reachable? ASK THE USER which to drive.
agent-hands snapshot --browser edge     # see the page: @e1 @e2 @e3
agent-hands click --ref @e5 --browser edge
```

`snapshot` mints its own refs now, so this works on the user's own browser and
not only on a pooled session. You never need a raw CDP script to see a page.

**Do not write one.** A hand-rolled CDP or Playwright script against the same
browser costs three things at once:

- **It dispatches input instantly.** That is the signal behaviour-scoring sites
  grade. This tool exists to avoid it; bypassing it forfeits the whole point.
- **It opens its own connection.** The relay holds the single approved socket,
  so a second connection re-prompts the user, and on a browser holding their
  live session that prompt is the only thing standing between an agent and
  their accounts.
- **It leaves no trace.** `agent-hands audit` records every authorisation and
  every client. A raw socket appears there as an absence.

Measured against `bot-detector.rebrowser.net`: a snapshot, a scroll and a mouse
move through this CLI triggered **no** detection — no `Runtime.enable` leak, no
main-world execution. The walk uses `Runtime.evaluate` and enables no domain,
which is what keeps it quiet.

If a verb you need is missing, say so and stop. Do not route around the CLI.

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

## Batch: many commands, one connection

Every one-shot command pays a Node start plus a connect. Measured on this
machine: ~370 ms of process boot and ~130 ms of connect, for a command whose
real work is a few milliseconds. Eight commands cost 3.1 s one at a time and
451 ms batched — the same work, 6.9x faster.

**Use `run` for anything more than two or three steps.**

```bash
printf '%s\n' \
  'open https://example.com' \
  'snapshot' \
  'text h1' \
  | agent-hands run --browser edge
```

A batch line is just command-line arguments. There is no second syntax: every
verb, flag and default behaves exactly as it does one-shot, and any verb added
later works here with no extra wiring. JSON lines are accepted for generated
input:

```
{"cmd":"click","ref":"@e17"}
{"cmd":"fill","args":["#q","hello"]}
```

Results stream back as NDJSON, one object per line, in order, each shaped like
the `--json` output you already know plus an `i` index:

```json
{"i":0,"ok":true,"command":"text","selector":"h1","chars":92,"text":"..."}
{"i":1,"ok":false,"command":"click --ref @e9","error":"unknown ref","code":"EUSAGE"}
```

Blank lines and `#` comments are skipped and do not consume an index. One
failing line does not stop the run — it reports `ok:false` and the batch
continues, so a 40-step sweep does not die on step 3. Pass `--stop-on-error` if
you want the opposite. The exit code is the worst line's, using the same codes
as the CLI: 2 usage, 3 challenge unresolved.

### Pacing still applies, and that matters

Separate processes used to leave a natural gap between actions. Batching
removes it, and a burst of clicks with no pause is exactly the signal this tool
exists to avoid. So a lognormal pause is inserted between **input** commands
(`--gap <ms>`, default 250, `0` disables).

Read-only commands — `text`, `snapshot`, `doctor`, `challenge`, `where` — emit
no input event, so nothing can observe their timing and they are never paced.
That is why a batch of reads runs at full speed while a batch of clicks does
not.

### When not to batch

One connection means one tab. If the work needs to move between tabs, run a
batch per tab. And if a step's input depends on reading the result of the
previous step, you cannot pre-write the lines — do those interactively, then
batch the deterministic run once you know the shape.

## When to use which tool

| Task | Tool |
|---|---|
| Open a URL, read text, snapshot, cookies, tabs (pooled session) | `agent-browser` |
| Open a URL, read text, snapshot (browser YOU launched) | `agent-hands` |
| Click, type, fill, press a key, scroll on a credentialed site | `agent-hands` |
| Click on a throwaway session | `agent-browser` |
| Click a NATIVE OS dialog the page cannot reach | `agent-win` |

Both drive the same browser at the same time. No handoff, no conflict.
`agent-hands` has its own `open`, `text` and `snapshot` since 0.6.0, because
`agent-browser` cannot attach to a browser you launched yourself. On a pooled
session either tool works; on an external browser, use `agent-hands`.

`agent-win` is the OS lane, not a browser tool. Its only browser job is clicking
native dialogs that live in the window chrome, where CDP is blind — the
"Allow remote debugging?" prompt above all. It does that automatically when you
use `--browser`, so you should never need to call it yourself. **Do not drive
pages with it.** UIA can reach page content, which is exactly the trap: it is
slower, it breaks on every re-render, and its searches also match the browser's
own chrome and your terminal's on-screen text.

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
agent-hands click --ref @e12               # snapshot ref — the only thing that works in iframes
agent-hands click --text "Se connecter"    # visible text, ranked match
agent-hands click --xy 420 300             # raw viewport coordinates
agent-hands hover ".menu-item"
agent-hands move --xy 200 400
agent-hands fill "#email" "you@example.com"   # replaces existing text
agent-hands fill --ref @e63 "text"            # with --ref, text is the first arg
agent-hands fill "#note" " more" --append     # keep old text, append at the end
agent-hands type "into whatever has focus"
agent-hands press Enter                    # Tab Escape Backspace Delete Home End Arrow*
agent-hands press Backspace --times 20     # one process, not twenty
agent-hands scroll 600                     # negative scrolls up
agent-hands where                          # last cursor position
agent-hands doctor                         # is the session reachable?
```

Flags: `--session <name>`, `--speed 1.6` brisk / `0.7` slow, `--json`
machine-readable, `--quiet` exit code only.

Set `AGENT_HANDS_SESSION=work` once and omit `--session` from every call.

## Rules that prevent the common failures

0. **Inside an iframe, use `--ref`.** CSS selectors and `--text` are evaluated
   in page JS, which cannot cross a cross-origin frame boundary. Snapshot refs
   carry frame context and reach inside. `--ref` scrolls the element into view
   first, so an element below the fold needs no extra step. Refs go stale on
   every page change: re-snapshot, then use the new ref.
1. **Prefer a CSS selector.** `--text` ranks candidates — exact over partial,
   real text over `aria-label`, button over field — but a page with several
   "Search" controls can still resolve the wrong one. Get selectors from
   `agent-browser snapshot -i`.
2. **Submit with `press Enter`.** Do not hunt for the submit button. Verified:
   `fill "#searchbox_input"` then `press Enter` returns real results.
3. **`fill` replaces; `type` does not.** `fill` clicks, selects all, then types,
   so it overwrites the field. Use `--append` to keep the old value; it jumps to
   the end first, because a click leaves the caret wherever it landed. Never
   clear a field with a loop of `press Backspace` — use `fill`, or
   `press Backspace --times n` in one call.
   `fill` does not verify the target accepts text. Aimed at a link or a div it
   reports success and types into nothing. Check the value afterwards with
   `agent-browser snapshot -i`.
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

## Check the session before you act

A warm session is not proof of the right browser. `--profile` and `--headed`
apply at launch only, so a session can be running headless on a throwaway
directory while the logins sit in the real profile. Clicks then succeed against
the wrong browser and the only symptom is "not signed in".

`agent-hands doctor` prints the profile path and the real browser string, and
warns when the browser is headless. Run it before the first gesture of a task.

## What it does not do

- **Google sign-in is refused outright.** Google rejects any browser with the
  DevTools protocol attached, with "ce navigateur ... peut-être pas sécurisés".
  That is a browser check, not a behaviour check, so this tool cannot help.
  Sign in by hand in a Chrome launched with no debugging port; the session then
  works here. Do not attempt to defeat the check.
- It does not defeat Cloudflare Turnstile, DataDome, or PerimeterX. Those also
  fingerprint canvas, WebGL, and TLS. Do not promise a protected site will work.
- `navigator.webdriver` is hidden by the browser's init script, not by this tool.
- Pages listening for `wheel` specifically will not see scroll events. See
  `--full` for why.
