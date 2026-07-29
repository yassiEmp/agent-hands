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
