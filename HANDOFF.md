# agent-hands — state of play

Written 16 Aug 2026. Read this before changing anything.

## What it is now

A CLI that drives a real Chromium browser with human-rate input, over CDP, with
its own page reading. `0.4.2 -> 0.14.0` in one session.

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

npm has 0.7.0. Publishing is only needed to share with another machine.

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
