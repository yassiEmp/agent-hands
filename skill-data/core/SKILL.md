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
- **It leaves no trace.** `agent-hands audit` records every authorisation the
  relay grants and every client that used it, so a raw socket on a `--browser`
  target shows up there as an absence. That covers the relayed lane only: a
  `--cdp` port and a pooled `--session` need no approval, so nothing authorises
  and nothing is logged. `agent-hands audit` tells you which lane you are on.

Measured against `bot-detector.rebrowser.net`: a snapshot, a scroll and a mouse
move through this CLI triggered **no** detection — no `Runtime.enable` leak, no
main-world execution. The walk uses `Runtime.evaluate` and enables no domain,
which is what keeps it quiet.

If a verb you need is missing, say so and stop. Do not route around the CLI.

## Which tool

`agent-browser` and `agent-hands` drive the same browser and do different jobs.

| | |
|---|---|
| `agent-browser` | pooled throwaway sessions it launches and owns, plus its own snapshot/tabs/cookies there. Instant input, fine when there is no account to lose. |
| `agent-hands` | any browser it can reach, **including one you launched or attached to**, which agent-browser cannot open at all. Human-rate input, refs, sign-in guard, pinning. |

Use `agent-hands` when the browser carries a real account, when the site scores
behaviour, or when the browser is not one `agent-browser` started. On a
throwaway session with no login, `agent-browser` is faster and nothing is at
risk either way.

Earlier guidance called `agent-hands` a last resort behind `agent-browser`.
That stopped being true once it grew `launch`, `open`, `snapshot` and `text`:
it is a complete loop on its own now.

Neither `agent-browser` nor `agent-win` has to be installed. `agent-hands
doctor` reports whether each is present and what it unlocks. Without
`agent-browser` there is no pool: start a browser with `agent-hands launch
<url>` or attach to the user's own with `--browser`. Without `agent-win` the
user clicks the "Allow" prompt once per browser run, and `login --window`
refuses with a message.

## Signing in

Sign-in is where a site grades hardest, so the CLI guards it rather than
trusting you to remember.

Any command that lands on a sign-in page **while the browser is advertising
automation** disconnects and says so, exit 4:

```
x this is a sign-in page and the browser is advertising automation
  navigator.webdriver = true   https://example.com/login
```

It measures instead of assuming — it reads `navigator.webdriver` on the page in
front of it. A browser started by `agent-hands launch` reports `false`, so the
guard never fires and CDP is safe there. `--force` overrides.

Measured, Chrome 151, and worth knowing because it is counter-intuitive:

| how the browser started | navigator.webdriver |
|---|---|
| `--remote-debugging-port=9444` (explicit port) | `false` |
| `--enable-automation` | `true` |
| `chrome://inspect` toggle (ephemeral port) | `true` |
| `agent-hands launch` | `false` |

So an open debugging port is not itself the problem. The problem is
`--enable-automation`, which most automation launchers pass, and the
`chrome://inspect` route.

### The CLI never guesses which box is which

A form can label its fields anything, in any language. A wrong guess types a
password into something that is not a password field — the worst failure this
tool could have. So **you** read the page and name the refs:

```bash
agent-hands snapshot --cdp 9444
#   @e2 [input type="email"] "Email address"
#   @e3 [input type="password"] "Password"
#   @e5 [button type="submit"] "Log in"

agent-hands login @e2 @e3 @e5        # identifier, password, submit
# credentials default to $AGENT_HANDS_EMAIL / $AGENT_HANDS_PASSWORD
```

`snapshot` prints that command for you whenever it sees a form, with this
page's refs already in it. Omit the last ref to fill without submitting.

**Every ref you name is checked against the snapshot before a key is typed,
and a check that cannot run is a refusal.** Exit 2 and nothing typed, for: a
password ref that is not `type="password"`, an identifier ref that is a password
or holds no text, a submit ref that is not a button, a remember ref that is not
a checkbox, a ref missing from the snapshot, and no snapshot at all.

There is no warn-and-continue path. A command that half-works is worse than
one that fails: the previous version printed a note when the password ref was
a `<form>` and typed anyway, so the site received nothing and the caller got
exit 0.

Credentials never go in argv: a value passed as `--password` lands in shell
history and in the process list, readable by anything running as you. Use
`--email-env` / `--password-env`, or `--password-stdin`.

Clearing the webdriver flag removes ONE signal. It is not a cloak: Turnstile,
DataDome and the rest score dozens of others and may still challenge you, even
through this CLI. Expect it and use `--pause-on-challenge`.

A challenge is detected after filling and before submitting, and handed to you.
It is never solved programmatically: an invoke leaves no pointer trace, which
scores worse than not clicking, and the account is what pays.

### The second lane, for a browser you did not launch

If the browser carries the flag and you cannot relaunch it, sign in through the
OS accessibility layer with nothing attached:

```bash
agent-hands login --window "example" --email-env EMAIL --password-env PASSWORD
```

This needs Chromium to publish a page accessibility tree
(`--force-renderer-accessibility`, which `launch` passes). When the tree is
withheld the command says exactly that rather than blaming your form.

## State: pin the browser once

The commands above all take `--cdp` or `--browser`. You do not have to repeat it.

```bash
agent-hands browsers        # what is live
agent-hands use 2           # pin number 2 — ask the user first if unsure
agent-hands snapshot        # no target flag from here on
agent-hands use             # what is pinned, and which file holds it
agent-hands use --clear     # drop it
```

The pin lives in `./.agent-hands/config.json`, found by walking up from the
working directory. `--global` writes `~/.agent-hands/config.json`.

**Three rules make this safe to rely on:**

- **An explicit flag always wins.** `--cdp 1234` overrides the pin, always.
- **A dead pin refuses.** Before each use the pin is verified live. If that
  browser is gone the command stops and names the fix — it never falls back to
  whatever else is open, because that silent fallback is the bug pinning exists
  to remove.
- **Every result says how it resolved:** `"via":"flag"`, `"pin"` or `"only-one"`.
  If you are on the wrong browser, that field tells you before the twentieth
  command does.

**With several browsers live and nothing pinned, commands stop** with a numbered
list and exit 5. That is not a failure — it is the tool refusing to choose which
of the user's browsers to drive. Put the question to the user, then `use <n>`.

### Parallel agents

Pins are keyed by project *and* by agent identity, discovered from the
environment. Measured: **no harness exposes a per-subagent id** — two sibling
subagents share every environment variable, including the session id and
messaging token. It is an open request on claude-code #36981 and codex #20852.

So a parent and the subagents it delegates to share one pin, which is right for
delegation. Subagents that need **different** browsers must each be given one:

```bash
AGENT_HANDS_ID=sweep-3
```

The parent handing out browsers is the natural place to set it. Without it,
whichever sibling pins last wins, and the replaced pin prints a warning saying
exactly this.

## Batch: many commands, one connection

**First visit to a page: one batch, not one command per look.** `open`, a
`wait` for the text you expect, then `snapshot` in the same `run`. Every
extra one-shot look is a model turn you paid for nothing.

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

### Write the flow before you see the page

Three verbs let a batch pause and branch on the page, so you write the whole
flow in one turn instead of snapshotting after every step. They take the same
target words as `click`: a selector, `--text`, or `--label`.

```
wait --text "Saved"                 text is on the page
wait --gone --text "Loading"        text has left the page
wait --enabled --text "Submit"      control is clickable; also --enabled "#id"
wait --url /dashboard               path starts with this; no "/" = any part of the url
wait --settled                      nothing changed for 500 ms
wait --text "Saved" --timeout 30    default 15 s
expect --url /dashboard             read once; stop the batch if false
if --text "Accept cookies" click --text "Accept"    run only if true now
```

A login, first visit, one turn:

```bash
printf '%s\n' \
  'open https://app.example.com/login' \
  'wait --text "Email"' \
  'if --text "Accept cookies" click --text "Accept"' \
  'fill --label "Email" "me@example.com"' \
  'fill --label "Password" "…"' \
  'press Enter' \
  'wait --url /dashboard --timeout 30' \
  'expect --text "Welcome"' \
  'snapshot --max 40' \
  | agent-hands run
```

`--label` finds a form field by the words next to it, so no snapshot is
needed to name it. Two fields with the same label is an error that lists
both, never a guess.

A failed `wait` or `expect` stops the batch with exit 7 and carries
`"page": {title, url, refs}`, a 40-ref snapshot that is already saved. The
next command can use `--ref` from it without another snapshot. Plan the fix
from that line.

Waiting is reads only. The site sees no input while the batch polls, and a
wait that actually waited ends with a human reaction pause before the next
input. Never add your own sleeps to look human. The tool owns the pacing.

### Two patterns that need no model turn between steps

**Generate, then pipe.** Your script prints the lines; `run` executes them on
one connection. For forty cells, forty lines, one process.

```python
import subprocess
lines = [f'fill --label "Row {i}" "{v}"' for i, v in enumerate(values)]
subprocess.run(['agent-hands', 'run'], input='\n'.join(lines), text=True)
```

**Read, compute, write.** One batch reads, your code decides, one batch
writes. Each `run` returns NDJSON you parse.

```js
import { execFileSync } from 'node:child_process';
const run = lines => execFileSync('agent-hands', ['run'], { input: lines.join('\n') })
  .toString().trim().split('\n').map(JSON.parse);
const [total] = run(['text "#total"']);
if (Number(total.text) > 100) run(['click --text "Apply discount"', 'wait --gone --text "Applying"']);
```

When the next step depends on the last result and the logic is small, call
the CLI per step from the script. Each call costs about 150 ms, under human
reaction time, and the site sees nothing unusual.

### When not to batch

One connection means one tab. `open` inside a batch on an attached browser
moves the connection to the new tab it creates, so later lines run there. To
work in an existing other tab, run a batch per tab with `--tab`.

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
agent-hands launch https://example.com        # or: agent-hands browsers, then use <n>
agent-hands snapshot                          # see the page, get @e1 @e2
agent-hands click --ref @e5                   # act
agent-hands text h1                           # verify
```

On a pooled `agent-browser` session the same loop works, and `agent-browser`
can do the reading there:

```bash
S="--session work"

agent-browser $S open https://example.com     # navigate with agent-browser
agent-browser $S snapshot -i                  # find the element, get a selector
agent-hands $S click "#submit"                # act with agent-hands
agent-browser $S get url                      # verify with agent-browser
```

Always verify after acting, with `text`, `snapshot` or `expect`. `agent-hands`
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
agent-hands press r                        # any single character; Ctrl+z, Shift+Enter
agent-hands drag --xy 300 300 --to-xy 500 420   # press, travel held, release: shapes, sliders, cell ranges
agent-hands press Backspace --times 20     # one process, not twenty
agent-hands scroll 600                     # negative scrolls up
agent-hands where                          # last cursor position
agent-hands doctor                         # is the session reachable?
```

Flags: `--session <name>`, `--speed 1.6` brisk / `0.7` slow, `--json`
machine-readable, `--quiet` exit code only.

Set `AGENT_HANDS_SESSION=work` once and omit `--session` from every call.

## Rules that prevent the common failures

**A click that reports "covered by ..." hit a dialog, banner or backdrop, and
did nothing.** Exit 8. The message names the cover and its first words. Read
them: a paywall, a cookie banner and a confirm box each want a different
answer. Press Escape or click the cover's own button, then retry. Without
this check a press lands on the backdrop, the release lands on the target,
and the tool would report success for a click that never fired. Measured on
Figma, 9 Sep 2026: twelve invocations lost to one modal.

**Some apps ignore input while their tab is hidden.** `agent-hands front`
brings the tab forward. It takes the user's foreground, so use it only after
a click that did nothing on a page with no cover.

0. **Inside an iframe, use `--ref`.** CSS selectors and `--text` are evaluated
   in page JS, which cannot cross a cross-origin frame boundary. Snapshot refs
   carry frame context and reach inside. `--ref` scrolls the element into view
   first, so an element below the fold needs no extra step. Refs go stale on
   every page change: re-snapshot, then use the new ref.
1. **Prefer a CSS selector.** `--text` ranks candidates — exact over partial,
   real text over `aria-label`, button over field — but a page with several
   "Search" controls can still resolve the wrong one. Get refs from
   `agent-hands snapshot`, which works on a browser agent-browser cannot reach.
2. **Submit with `press Enter`.** Do not hunt for the submit button. Verified:
   `fill "#searchbox_input"` then `press Enter` returns real results.
3. **`fill` replaces; `type` does not.** `fill` clicks, selects all, then types,
   so it overwrites the field. Use `--append` to keep the old value; it jumps to
   the end first, because a click leaves the caret wherever it landed. Never
   clear a field with a loop of `press Backspace` — use `fill`, or
   `press Backspace --times n` in one call.
   `fill` checks the aim point before it clicks and refuses a target that holds
   no text, exit 1. That covers the trap worth knowing: a `<form>`, a `<label>` or a
   `<div>` COVERS its children, so clicking one focuses whichever input lies under
   that point. Aiming at a form ref used to type the identifier into the password
   box and report `tag:"FORM", replaced:true`. Target the input itself.
4. **Re-resolve after the page changes.** Selectors are resolved fresh on every
   command, so this is automatic — but re-snapshot before choosing a new one.
5. **Pace multi-page runs.** The gesture is human; the sequence still needs to
   be. Roughly one page action every 2 to 3 seconds.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | gesture dispatched |
| 1 | runtime failure (session down, element not found, target holds no text) |
| 2 | usage error (unknown command or key, or a ref that fails its role check) |

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
