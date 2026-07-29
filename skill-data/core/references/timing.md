# Timing model and measured evidence

## What detectors score

Mouse path entropy and the distribution of inter-event timings, not the shape
alone. Keystroke dynamics are measured as dwell (key held) and flight (release
to next press). Uniform random is as machine-like as no randomness, so every
delay here is lognormal — the shape human motor timing has.

## The model

| Element | Rule |
|---|---|
| Move duration | Fitts's law, `60 + 105 * log2(2D/W + 1)`, jittered 0.82-1.24x, clamped 140-1100ms |
| Path | Cubic Bezier with a perpendicular bow, ease-in-out, sub-pixel tremor that steadies on approach |
| Overshoot | Reaches over 180px overshoot then correct, 75% of the time |
| Aim | Off-centre inside the target box, never the exact middle |
| Click dwell | lognormal, median 72ms |
| Key dwell | lognormal, median 48ms |
| Key flight | lognormal, median 95ms; 1.1-1.8x at word boundaries; 3% chance of a 250-900ms think-pause |
| Scroll | bursts of 90-190px with eased frames, 70-260ms pause between bursts |

Dispatch runs at 100Hz. Chrome coalesces this into a 60-125Hz event trace,
which is what a real mouse produces.

## Measured against a page-side event recorder

Recorded 29 July 2026 with listeners on `mousemove`, `keydown`, `keyup`.

| Gesture | Result |
|---|---|
| hover | 25 `mousemove` events, median gap 16ms, range 12-32ms |
| click | Bezier arc, overshoot then correction, `isTrusted: true` |
| type | dwell median 62ms (range 31-94), flight median 109ms (range 61-370) |
| scroll | correct final position, burst rhythm |

Human reference: 60-125Hz sampling, 50-100ms dwell, 100-200ms flight.
All measured values fall inside those ranges.

For contrast, `agent-browser hover` emits exactly one `mousemove` that
teleports to the target, and one CLI call per mouse move lands at ~570ms
intervals — geometrically plausible, temporally impossible.

## The honest limit

Every event is `isTrusted: true` because CDP injects below the OS layer. That
also means the physical cursor never moves and the window is never raised.

This defeats basic behavioural scoring. It does not defeat Cloudflare
Turnstile, DataDome, or PerimeterX, which combine behaviour with canvas, WebGL,
and TLS fingerprinting. `'webdriver' in navigator` also still returns `true`;
only its value is hidden, and that is done by the browser's init script rather
than by this tool.
