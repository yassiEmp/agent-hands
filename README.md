# agent-hands

**Hands for `agent-browser`.** It navigates and reads; this clicks, types and
scrolls at human rates. One CDP socket, a whole gesture dispatched at 60-100Hz,
Fitts-law motion with Bezier paths and lognormal keystroke timing.

It never moves your physical cursor and never raises the window.

```bash
agent-browser --session work snapshot -i     # find the element
agent-hands fill "#searchbox_input" "auto ecole vincennes"
agent-hands press Enter
agent-browser --session work get url         # verify
```

## Why

`agent-browser hover` emits exactly one `mousemove` that teleports to the
target. Driving its `mouse move` from the shell lands events ~570ms apart,
because each call spawns a process — geometrically plausible, temporally
impossible. Behavioural scoring reads both as automation.

`agent-hands` holds one socket and paces the gesture itself:

| Gesture | agent-browser | agent-hands |
|---|---|---|
| move | 1 event, teleport | 25 events, median gap 16ms |
| click | instant | Bezier arc, overshoot + correction, 72ms dwell |
| type | — | dwell 62ms, flight 109ms |
| scroll | — | wheel-like bursts with pauses |

Human reference: 60-125Hz sampling, 50-100ms dwell, 100-200ms flight.

## When to reach for it

Escalate. Do not start here.

1. **Throwaway browser** — `agent-browser --session scratch open <url>`, no
   profile, no logins. Public pages, research, scraping. Most work belongs here,
   and `agent-browser click` is faster on it.
2. **Logged-in profile** — only when the task needs a real account.
3. **agent-hands** — only when 2 applies and the site can ban that account.

On a throwaway session this buys nothing. There is no account to lose.

## Install

```bash
npm i -g agent-hands
agent-hands doctor          # checks the session is reachable
```

Requires Node 22 or newer for the built-in `WebSocket`. No dependencies.

## Commands

```
click <selector>          click --text "Label"       click --xy 420 300
hover <selector>          move --xy 200 400
fill <selector> "text"    type "text"                press Enter
scroll 600                where                      doctor
skills list               skills get core [--full]
```

Flags: `--session <name>` (default `work`), `--speed 1.6` brisk / `0.7` slow,
`--json`, `--quiet`.

Exit codes: `0` dispatched, `1` runtime failure, `2` usage error.

## For agents

```bash
agent-hands skills get core --full
```

Serves the versioned guide bundled with the installed CLI, so instructions
never drift from behaviour. `--json` gives one-line machine-readable results:

```json
{"ok":true,"command":"click","points":14,"ms":392,"overshoot":true,"tag":"BUTTON"}
{"ok":false,"error":"no element matched selector \"#nope\"","code":"ENOTFOUND"}
```

## Sessions

A session name pairs to one Chrome profile: `work` -> `main`, `work-2` ->
`main-2`. Chrome locks a profile directory, so one browser per profile. Give
each parallel agent its own session.

## Limits

Does not defeat Cloudflare Turnstile, DataDome, or PerimeterX — those combine
behaviour with canvas, WebGL and TLS fingerprinting. `'webdriver' in navigator`
still returns `true`; hiding its value is the browser's init script, not this.

## License

MIT
