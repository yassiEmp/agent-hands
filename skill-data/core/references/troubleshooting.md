# Troubleshooting

Four Chrome behaviours drive almost every failure. The automation window sits
in the background, and that changes what Chrome does. Do not fix any of them by
raising the window — that steals focus from the user.

## The gesture hangs for exactly 5 seconds per event

`Input.*` commands never acknowledge while the window is backgrounded. Chrome
waits for a renderer frame that throttling does not produce, then times out at
5000ms. The event is delivered anyway.

`agent-hands` fires input without awaiting the reply and paces from Node. If you
write your own CDP code, do the same. Awaiting 110 mouse moves costs 9 minutes.

## Scrolling reports success but the page does not move

Wheel events are dropped entirely while backgrounded. They route through the
compositor, which throttling stops. Mouse moves survive because they do not.

`scroll` therefore drives the scroller directly and keeps the burst-and-pause
rhythm. The native `scroll` event still fires, so lazy loading and
IntersectionObserver work. A page listening for `wheel` specifically sees
nothing.

## A loop inside the page crawls and never finishes

In-page `setTimeout` is throttled to about 1 second in a backgrounded window.
Never pace a loop with `Runtime.evaluate` running its own sleeps. Pace in Node.

## Typing produces nothing

Clicked fields do not receive DOM focus without OS window focus.
`agent-hands` calls `Emulation.setFocusEmulationEnabled` on connect, which
fixes it without raising the window.

## Every character appears twice

`keyDown` must not carry `text`. Chrome inserts on the `char` event, so
carrying text on both doubles the character: `aauuttoo eeccoollee`.

## Clicks succeed but the page says you are not signed in

The session is running on the wrong browser. `--profile` and `--headed` apply at
launch only, so a session named `work` can be headless on a throwaway temp
directory while the logins sit in the real profile. Every command succeeds
against the wrong browser.

`agent-hands doctor` prints the profile path and the real browser string and
warns when it is headless. Close and relaunch; flags cannot fix a running
daemon.

## --text or a CSS selector finds nothing, but the element is visible

It is inside a cross-origin iframe. Selectors and `--text` run in page JS, which
cannot cross the boundary. Use `--ref` with a ref from
`agent-browser snapshot -i`; refs carry frame context and reach inside. `--ref`
also scrolls the element into view, so below-the-fold elements need no extra
step. Refs go stale on every page change.

## Google refuses to sign in

"Ce navigateur ou cette application ne sont peut-être pas sécurisés." Google
rejects any browser with the DevTools protocol attached. This is a browser
check, so human-rate input changes nothing. Sign in by hand in a Chrome launched
without a debugging port, then reattach; existing sessions are accepted.

## "session is not running"

No `DevToolsActivePort` in the profile directory. Launch the session:

```bash
agent-browser --session work --profile "$HOME/.agent-browser-profiles/main" \
  open <url> --headed
```

Then `agent-hands doctor`.

## "no element matched"

Run `agent-browser --session <s> snapshot -i` and use a real selector. If you
used `--text`, the match is ranked but ambiguous pages defeat it.

## Chrome exited early without writing DevToolsActivePort

Two browsers on one profile directory. Chrome locks it. Use a different session
name **and** a different profile, or wait for the first to close.

## Connecting to your own browser hangs with no error

The `chrome://inspect` endpoint gates every new CDP connection behind a native
prompt drawn in the browser's window chrome. CDP cannot see or dismiss it, so
the websocket upgrade hangs — no error, no 403 — until it is clicked.

agent-win clicks it for you, but it is a SEPARATE Windows-only install and no
dependency of this package. Put `agent-win` on PATH, or set `AGENT_WIN_HOME` to a
checkout. When it is missing you get one line saying so — click the prompt
yourself, and note the connection must already be in flight, because the button
only exists while an upgrade is pending.

Before blaming any client, connect a bare websocket to
`ws://127.0.0.1:<port><uuidPath>`. Every client failure seen so far was the
endpoint. Two causes look identical from outside:

- a prompt waiting for a click
- a rotated uuid — toggling remote debugging keeps the port and issues a NEW
  uuid, so re-read line 2 of `DevToolsActivePort`

Read the error shape. A clean `404` on `/json/version` means the server is up
and serves no `/json/*`. `EOF while parsing` means it is not answering at all.
Adding an `Origin` header turns the hang into a `403` naming
`--remote-allow-origins`; that is a red herring, since omitting `Origin` is what
works.

## The prompt is on screen but nothing matches "Allow"

Its text is translated. The approver narrows by Chromium's `MdTextButton` class,
which is not, then matches a table of ~30 languages. In an unlisted language it
prints the button names it found and waits rather than guessing — the dialog has
three buttons and the affirmative is neither first nor last, so a positional
guess would disable your setting or refuse the connection. Add the word to
`ALLOW` in `cli/approve.mjs`.

## A retried connect stacks up prompts

One prompt appears per pending attempt. Clicking an old one approves a
connection that already timed out, while your live socket keeps waiting. Clear
them all, then check the socket rather than the screen.

## Typed text arrives mangled

Keystroke entry drops and repeats characters when focus moves mid-type; measured
against Notepad, "typed this" arrived as "yyped hhis" with no error raised
anywhere. Prefer `fill` on a control that accepts a value directly, and treat
any write you did not read back as unverified. A command reporting success
proves the mechanism fired, never that the effect happened.
