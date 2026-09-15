# agent-hands — state of play

Written 16 Aug 2026. Read this before changing anything.

## What it is now

A CLI that drives a real Chromium browser with human-rate input, over CDP, with
its own page reading. `0.4.2 -> 0.15.0`.

    agent-hands browsers        what is live
    agent-hands use 2           pin one; later commands need no target flag
    agent-hands launch <url>    start one with the flags that matter
    agent-hands snapshot        see the page, get @e1 @e2 refs
    agent-hands login @e2 @e3 @e5   fill a form with refs YOU chose
    agent-hands run --file f    many commands, one connection
    agent-hands audit           who authorised and drove this browser

Everything else: `agent-hands help`, and `agent-hands skills get core --full`
for the agent-facing guide.

## Installed how

The global command is `npm link`ed to `C:\projects\agent-hands`, so edits here
take effect immediately. `agent-hands version` should print the same as
package.json. If it does not, run `npm link` from this directory again.

npm has 0.15.1, published 24 Aug 2026. 0.17.0 is committed and unpublished.

## The four rules the design rests on

1. **An explicit flag always wins.** Pins, config and defaults are all beaten by
   a flag on the command line. The escape hatch never disappears.
2. **A dead pin refuses.** Verified live before use; if the browser is gone the
   command stops and names the fix. It never falls back to another browser —
   silent fallback is the bug pinning exists to remove.
3. **Ambiguity stops.** Several browsers live and nothing pinned is exit 5 with
   a numbered list, not a guess.
4. **Credentials never go in argv.** `--email-env` / `--password-env` /
   `--password-stdin`. `--password` works but warns, because a value on the
   command line is readable in the process list by anything running as you.

## Exit codes

    0 ok    1 runtime    2 usage    3 challenge unresolved
    4 sign-in page while the browser advertises automation
    5 several browsers live, ask the user    6 pinned browser is gone

## Measured facts you should not re-derive

- `navigator.webdriver` is set by the LAUNCH, not by attaching:
  `--enable-automation` true, `chrome://inspect` ephemeral port true,
  a bare `--remote-debugging-port=N` **false**, `agent-hands launch` false.
- `Emulation.setAutomationOverride {enabled:false}` returns `{}` and does
  nothing about it. The working shim is `Page.enable` +
  `addScriptToEvaluateOnNewDocument` returning boolean **false** — `undefined`
  is itself detected ("you might have it deleted manually").
- Driven entirely through this CLI, bot-detector.rebrowser.net reports no
  detection. That is one detector, not a cloak: Turnstile and DataDome score
  dozens of other signals and will still challenge. `--pause-on-challenge`.
- **No harness exposes a per-subagent id.** Two sibling subagents returned
  byte-identical values for every environment variable including the session id
  and messaging token; only PID differed, and PID churns per command. Open
  requests: claude-code #36981, codex #20852. Parallel siblings that need
  different browsers must each be given `AGENT_HANDS_ID`.
- A WMI process-tree lookup costs ~822ms against a ~250ms command, so identity
  cannot be derived from the process tree.
- **The sign-in guard measures a value this tool masks.** On connect the CLI
  installs the `navigator.webdriver = false` shim, and it survives in every
  document created while attached. So one `--force` attach plus a navigation
  disarms the guard for the rest of that browser run, including for a later
  command that passed no `--force`. Measured 24 Aug 2026: exit 4 on a fresh
  `--enable-automation` browser, silent on the same browser after one forced
  navigation. The shim does lower what the site reads, so the guard is not
  simply wrong. But `--force` is documented per-command and behaves as sticky,
  and the two cases cannot be told apart from the page: a clean browser
  started by `launch` carries the same shim.

## Fixed 15 Sep 2026, unreleased — a fresh machine could not start

Reported by the owner: another developer installed the CLI and it did not run,
because that machine had neither agent-win nor agent-browser. Walked the fresh
path with PATH holding only Node, and with a faked Node 20. Five things, in
the order they bit:

1. `doctor` needed a browser before it said anything. On a fresh machine it
   died with "session work is not running" and told the dev to run
   `agent-browser`, a tool they did not have. `doctor` now probes the
   environment (Node version, platform, agent-win, agent-browser, with what
   each optional tool unlocks and what happens without it) and prints that
   block after the browser answer, or after the error when no browser
   answers. `--json` carries it as `env`. Code in `cli/env.mjs`.
2. Node 20 failed on the first browser command with
   `ReferenceError: WebSocket is not defined`. `cli/require-node.mjs` is the
   first import in `bin/agent-hands.mjs` and refuses on Node < 22 with the
   reason and the fix, exit 2.
3. `login --window` on a machine without agent-win said "no browser windows
   are visible to the OS at all". The missing-tool check ran BEFORE the first
   probe, and the probe is what discovers the tool is missing. The check now
   follows the first call. On macOS and Linux nothing is probed at all (UI
   Automation is a Windows API) and the hint says so. `python3` is tried
   after `python`, for a checkout on those platforms.
4. Every "start a browser" hint named `agent-browser`. "session is not
   running", `browsers` with nothing live, and doctor's HEADLESS warning now
   lead with `agent-hands launch <url>` and mention agent-browser only when
   `cli/env.mjs` finds it on PATH. `--ref` on a pooled session now prefers
   this CLI's own snapshot and asks agent-browser only when there is none, so
   a ref from `agent-hands snapshot` is never resolved against agent-browser's
   numbering.
5. `launch` defaulted to edge and refused on a machine with only Chrome. It
   now takes the first installed of edge, chrome, brave, chromium. `--exe
   <path>`, which the error message had promised since 0.15, is now parsed.

Found on the way: `ROOT` in `cli/version.mjs` was `C:/projects`, the parent
of the package, because `path.dirname` on a trailing-slash URL pathname strips
the last segment. `installMode()` therefore reported this linked clone as a
global install, and `update --yes` would have run `npm i -g agent-hands@latest`
over it. Now `fileURLToPath`, which also survives a space in the path.

Acceptance, run on this machine: `npm pack`, install the tarball into a
scratch prefix, PATH holding only Node and that prefix. `doctor`, `browsers`,
`launch`, `snapshot --cdp`, `click --ref --cdp` and `login --window` each
either work or answer with a message that names the fix.

## 0.17.0 (9 Sep 2026) — write the flow before you see the page

Decision, after a grilling session with the owner: NO scripting lane inside
the tool. No inline JS, no Node library, no mini language. The agent writes
batch lines, or writes a script in any language that prints batch lines or
calls the CLI per step. One surface to learn, no sandbox to guard, no page-side
JS back door that could fire an instant click.

What the tool gained so a batch can be written blind:
- `wait <condition> [--timeout s]`, `expect <condition>`, `if <condition>
  <command>`. Conditions take the same target words as `click`: a selector,
  `--text`, `--label`, plus `--gone`, `--enabled`, `--url`, `--settled`.
  Polling is reads only. A wait that waited ends with a reaction pause
  (lognormal 500 ms) so the next input does not land the instant the page
  changed. Code in `cli/wait.mjs`.
- `--label "Email"` on click and fill: a field by the words next to it, exact
  match first, ambiguity is an error listing the candidates. `finderFor` in
  `cli/gestures.mjs` is shared by click, fill and wait.
- A failed batch line carries `page: {title, url, refs}` (40 refs) and saves
  it, so `--ref` works on the next command. `EWAIT` is exit 7 and stops the
  batch.
- `help --batch` is the short guide; the core skill has the same plus two
  script patterns (generate-then-pipe, read-compute-write).

Traps measured on httpbin.org/forms/post:
- `--url /post` matched `/forms/post` by substring before the click landed.
  A pattern starting with `/` now matches the path start.
- A url matches when navigation commits, before the new document has a body.
  The url condition now also requires readyState interactive or complete.
- A usage error on `wait` used to connect first. On the owner's browser that
  woke a frozen tab. Conditions are validated before any connection.

Test protocol: a Haiku subagent gets only `skills get core` and
`help --batch`, a throwaway browser and two tasks (GitHub search; three
labelled rectangles on Excalidraw). Its transcript shows what the docs fail
to teach. Results, 9 Sep 2026:
- Trial 1: GitHub done in 11 invocations, still one snapshot per step.
  Excalidraw failed: `press r` refused (named keys only) and no drag.
- Added `drag` and character/shortcut keys. Trial 2: Excalidraw done, the
  drawing was ONE batch of 12 lines, 5 invocations in all. No doc issue
  reported. It could not verify the canvas from the DOM; a screenshot verb
  is the next gap for canvas apps.
Account trials, 9 Sep 2026, on the owner's Edge:
- Google Sheets: done in 14 invocations, sheet renamed. The A4 value was
  inferred, never read: Sheets draws cells on a canvas and the DOM holds
  only the formula bar. Eight invocations went to trying to read one cell.
- Figma: blocked. The Starter plan is at its 3-file limit, so "New Design
  file" opens a paywall modal. Every later click pressed on the backdrop
  (closing it) and released on the button, and the tool reported success.
  Fix: BOX now reports elementFromPoint at the aim, and click refuses with
  ECOVERED (exit 8) naming the cover and its first words. --force clicks
  through. `front` (Target.activateTarget) was added for apps that ignore a
  hidden tab; Figma was not one of them.
Next gap, common to Excalidraw and Sheets: a screenshot verb so a canvas can
be checked by looking.

## Fixed in 0.16.0 (8 Sep 2026) — an agent navigated the user's YouTube tab

Reported from a real session. `open` with no `--tab` navigated the tab the
user was watching, and the next `snapshot` read a different tab after the
user switched away. Three causes, three fixes:

- The tab picker preferred the VISIBLE tab and re-ran on every command, so
  the target followed the user's clicks. Now the first pick is written to
  `~/.agent-browser/humanize/<key>.tab.json` and later commands return to it
  while it exists. `--tab` overrides and becomes the new memory. `doctor`
  prints how the tab resolved; `--json` carries `"tab"`.
- `open` on the shared-socket path (a browser the user attached) now creates
  a background tab with `Target.createTarget {background:true}` and moves the
  connection to it. `--here` navigates in place. On a launched or pooled
  browser it still navigates in place; `--new-tab` there is a usage error
  because every page is its own socket on a classic endpoint.
- `agent-hands tabs` lists tabs and marks the current one. Before, the only
  way to see tabs was a deliberately wrong `--tab` value.

Token cost, measured on a GitHub repo page with 92 refs: `snapshot --json`
13330 -> 6512 chars by dropping x/y/w/h and null fields, which an agent never
reads because `--ref` re-resolves at click time. Text 8060 -> 7106 by cutting
href query strings, `type="button"` on buttons and long container excerpts.
Remaining large outputs: `skills get core` ~4500 tokens per session and the
USAGE text ~3100 tokens on any unknown command. Not touched.

## Fixed in agent-win, 10 Sep 2026 — parallel window walking

Item 3 below (cold approval ~52s) was `session.find_across` in agent-win walking every top-level
window's tree one after another. uiautomation forbids touching a Control from a thread that did
not create it, so the fix is a small thread pool (`MAX_WALK_WORKERS = 4`, agent-win's
`session.py`) where each worker independently initialises COM and re-acquires its OWN Control via
`ControlFromHandle` — no Control ever crosses a thread boundary, only plain dicts do. Falls back to
sequential on any pool error.

Measured on the owner's machine, 9 top-level windows (2 heavy Edge windows among them): 9.9s
sequential -> 4.6s parallel for an unscoped `find --type Button`. A single-window scoped search
(the common case for `approve.mjs`'s `--process` scan when only one browser window is open) is
unchanged, since there is nothing to parallelise there — the remaining cost in that case is the
walk of that one heavy tree, not the sequential-windows problem this fix targets.

## Growth

`docs/growth-playbook.md` (15 Sep 2026): where the tool stands (0 stars, no
outside users), the positioning decision forced by agent-browser PR #1810
(curved mouse movement lands upstream; sell "the browser you are logged
into", the full gesture model and the refusals), and a week / month / quarter
plan. `scripts/metrics.mjs` prints the weekly row for `docs/metrics.csv`.

## Known open, in priority order

1. **The UIA login lane is unverified.** `login --window <title>` drives the OS
   accessibility layer for a browser you cannot relaunch. No Edge window on this
   machine publishes a page accessibility tree, with
   `--force-renderer-accessibility` confirmed on the process and after focusing.
   The command detects exactly that state and says so. The CDP lane
   (`login @e2 @e3`) is verified end to end and is the main path.
2. **Two siblings without `AGENT_HANDS_ID` can still clobber each other's pin.**
   The replaced pin warns at `use` time; nothing warns at command time.
3. `agent-browser --init-script` is silently ignored on this machine — verified
   by `Screen.prototype` being unpatched. Upstream, third-party binary.
4. `browsers` prints "Use this one" for the user's own Edge when it is the only
   reachable target. That browser holds their live logins, and the line reads
   as a recommendation rather than a question. The core skill says ask first;
   the CLI output does not.

## Fixed in 0.15.1 (24 Aug 2026) — reported from a real failed login

Also in 0.15.1: `launch` failures now name a cause. The old message gave the
directory it looked in and nothing else. It now lists the processes that held
that profile BEFORE the spawn — anything created after is a child of the
failing attempt, and naming those sends the caller round a loop that never
converges. Measured on a profile damaged by a force-kill: every attempt leaves
exactly one orphan, so the message names both remedies and terminates.

Near-miss worth keeping: the first version of that process query matched on
the substring `agent-hands-profiles*default`, which also matches a sibling
profile because Chromium appends `--profile-directory=Default`. The message it
feeds tells the caller to run Stop-Process. It now matches the whole
`--user-data-dir=<path>` flag followed by a delimiter, with quotes stripped
first, and that was verified to separate `default`, `rdv` and `qa2`.


One bug, two gates, and it is the most expensive one found so far.

A container COVERS its children. Clicking a `<form>` box focuses whichever input
lies under that point, so `fill --ref <form-ref>` typed the identifier straight
into the password field and reported `ok:true, tag:"FORM", replaced:true`.
Measured: `active=INPUT#pw email="" pw="SENTINEL"`. Checking
`document.activeElement` after the click cannot catch this — focus WAS on a
good input, just not the one named. The aim point is now probed with
`elementFromPoint` BEFORE the click, so nothing is dispatched at all.

`login` bypassed that entirely and had its own weaker checks, one of which was
a `console.error` note that then typed anyway. Aimed at a form ref it printed
"note: @e1 is a <form> with no type" and reported `✓ filled`, exit 0. Every ref
is now checked against the snapshot by role before a key is typed, no
snapshot is a refusal rather than a skipped check, and there is no
warn-and-continue path left. Six wrong forms exit 2; the correct one still
works.

Rule this settles: **a check that cannot run is a refusal.** Every
`if (snap && ...)` silently skipped validation when the store was empty.

## Fixed in 0.15.0 (24 Aug 2026), all found by walking the CLI

Seven, in the order they bite:

1. `fill <target> ""` reported `replaced:true` and left the old value.
   `selectAll` only highlights; typing nothing leaves the selection highlighted
   and the field unchanged. The documented way to clear a field did not clear
   it. Now presses Delete when the replacement is empty.
2. A missing argument reported success on a no-op: `fill "#x"` with the value
   forgotten, `type` with nothing, `scroll abc` (`pixels:null`), `press` with no
   key, and `move`/`click`/`hover`/`fill` with no target — the last resolving
   the string "undefined" as a selector. All exit 2 now and name the four ways
   to target. This is the one that matters for scripts: a shell that
   interpolated an empty variable got a green result and an unchanged page.
3. Runtime hints pointed at `agent-browser --session <s> snapshot -i` — a tool that
   cannot attach to an external browser, with `<s>` never substituted. Following
   the hint failed twice over. Now `agent-hands snapshot`.
4. `audit` said "no audit events for this browser yet" for a `--cdp` target that
   is never audited. That reads as "nothing happened" when it means "out of
   scope", and an empty log is exactly what an agent would cite as proof.
   Now it names the audited lane and why this one is not in it.
5. `snapshot --json` dropped the sign-in hint that human mode prints on stderr.
   The `--json` caller the CLI tells agents to be learned neither that the page
   held a sign-in form nor the refs to fill it. Now a `signin` field.
6. `skills/agent-hands/SKILL.md`, the discovery stub read before anything else,
   still called the tool a last resort behind `agent-browser` and said
   agent-browser navigates and reads. The core skill it points at says the
   opposite. An agent following the stub reaches for a tool that cannot attach
   to the user's browser, hits a wall, and writes raw CDP — the exact failure
   this CLI exists to prevent.
7. README said refs "only exist for a pooled session. With --browser or --cdp,
   target by selector or --text." False since 0.6.0, and it talks an agent out
   of the only target that reaches inside an iframe.

## How to work on it

- Test by walking the path a fresh agent walks, using only what the CLI prints.
  That method found three real bugs the code review did not: the guard not
  running in batch, `browsers` unable to see a browser `launch` had just made,
  and three docs still pointing at a tool that cannot do the job.
- Windows notes that will bite: the files are CRLF, so string anchors with `\n`
  silently fail to match; a `/c/...` path inside a `node -e` string resolves as
  `C:\c\...`; heredocs eat backslashes, so build `\n` from `String.fromCharCode`
  or write the block to a file and splice it.
- Pushing to `main` is fine now (owner confirmed, 10 Sep 2026); the remote is public but that is
  not itself a reason to withhold pushes. `.github/workflows/publish.yml` publishes to npm on a
  GitHub release (not on every push to main) — see "How to ship a release" below.

## How to ship a release

1. Land your changes on `main` as normal commits.
2. `npm version patch` (or `minor`/`major`). This bumps `package.json`, commits, tags `vX.Y.Z`,
   then runs `postversion` (`scripts/postversion.mjs`), which pushes the commit + tag and opens a
   GitHub release from it.
3. That release's `published` event triggers `.github/workflows/publish.yml`, which publishes to
   npm via Trusted Publishing (OIDC, no stored token) — same pattern as agent-win's PyPI publish.

Done (10 Sep 2026): npmjs.com package settings -> Trusted Publisher -> GitHub Actions -> org
`yassiEmp`, repo `agent-hands`, workflow filename `publish.yml`, environment `npm`. v0.17.0 was
published this way and confirmed live with a signed provenance statement.

**The npmjs.com "Repository" field must be the bare repo name** (`agent-hands`), not a full URL.
The form pre-fills and happily SAVES a full GitHub URL there with no validation error, and every
OIDC token exchange then fails with a deliberately vague "package not found" that has nothing to
do with the actual problem (npm/cli#9088). Those identity fields are locked once saved, so a wrong
value means delete and recreate the connection, not edit it — editing only ever changes the Label
and the publish-allowed checkbox. `.github/workflows/publish.yml` also strips an empty
`_authToken` line that `actions/setup-node`'s `registry-url` writes to `.npmrc`, which otherwise
makes npm skip the OIDC exchange and fail with a plain 404 (npm/documentation#1960).
