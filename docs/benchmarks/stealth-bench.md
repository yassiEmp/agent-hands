# Stealth Bench V1 — agent-hands run

Status: **set up, not run yet** (22 Oct 2026). Waiting for the API keys.

## What it measures

[browser-use/benchmark](https://github.com/browser-use/benchmark), Stealth Bench V1:
80 sites behind anti-bot systems (Cloudflare 22, PerimeterX 18, DataDome 13,
reCAPTCHA 6, Akamai 6, GeeTest 4, hCaptcha 3, custom 5, Shape 1, Kasada 1,
Temu slider 1). Each task is a short no-login visit. A judge model
(gemini-2.5-flash, as in the official runs) scores one thing: was the agent
blocked. The blog post describes a 71-site version; this run uses the 80-site
file in the repo at commit 1e0e2f1.

## Arms

All arms run on the same machine, the same home IP (Free SAS, France), the
same agent model (Claude) and the same judge. The published vendor numbers
come from datacenter IPs, so they are not comparable with these. Only the arms
below compare with each other.

| Arm | Provider | Browser | Input |
|---|---|---|---|
| 1 | `local_headful` | browser-use's own Chromium | browser-use |
| 2 | `agent_hands` | `agent-hands launch`, fresh profile per task | browser-use |
| 3 | `agent_hands_input` | same as 2 | clicks and typing through agent-hands |

Arm 3 limits, recorded per task in `input_counts`:
- browser-use scrolls the element into view first (an instant jump);
  agent-hands then moves and presses.
- An element inside a cross-origin iframe keeps browser-use's click
  (`fallback`), because its coordinates are frame-relative in that harness.
- Navigate, scroll, select and send_keys stay browser-use's.

## Where the code is

- Harness clone: `C:\projects\agent-hands-bench`, branch `agent-hands`
  (commit eec8c9d): `browsers/agent_hands.py`, `browsers/agent_hands_input.py`,
  the Claude executor in `run_eval.py`, and `agent_hands_smoke.py`.
- Smoke test without a model (22 Oct 2026): browser-use found the field,
  agent-hands typed into it and clicked a link, `fallback: 0`, profile removed.

## Run

Keys go in `C:\projects\agent-hands-bench\.env` (git-ignored):
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`.

```bash
cd /c/projects/agent-hands-bench
export PYTHONIOENCODING=utf-8 ANONYMIZED_TELEMETRY=false
for arm in local_headful agent_hands agent_hands_input; do
  uv run python run_eval.py --benchmark Stealth_Bench_V1 --browser $arm \
    --model claude-sonnet-5-5 --concurrency 3
done
```

Each arm opens real browser windows, three at a time, for 1-2 hours. Run it
while the machine is free.

## Results

| Arm | Not blocked | Notes |
|---|---|---|
| 1 local_headful | | |
| 2 agent_hands | | |
| 3 agent_hands_input | | |
