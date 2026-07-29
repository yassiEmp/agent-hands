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
