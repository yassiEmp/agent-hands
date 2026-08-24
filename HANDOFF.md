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

npm has 0.15.0. 0.15.1 is committed and not yet published.

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

## Known open, in priority order

1. **The UIA login lane is unverified.** `login --window <title>` drives the OS
   accessibility layer for a browser you cannot relaunch. No Edge window on this
   machine publishes a page accessibility tree, with
   `--force-renderer-accessibility` confirmed on the process and after focusing.
   The command detects exactly that state and says so. The CDP lane
   (`login @e2 @e3`) is verified end to end and is the main path.
2. **Two siblings without `AGENT_HANDS_ID` can still clobber each other's pin.**
   The replaced pin warns at `use` time; nothing warns at command time.
3. **Cold approval is ~52s**, dominated by agent-win walking window trees
   sequentially. Scoping to the browser process took 3723ms -> 2863ms per scan.
   The real fix is parallel walking inside agent-win, a different repo.
4. `agent-browser --init-script` is silently ignored on this machine — verified
   by `Screen.prototype` being unpatched. Upstream, third-party binary.
5. `browsers` prints "Use this one" for the user's own Edge when it is the only
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
- Do not push. The remote is public.
