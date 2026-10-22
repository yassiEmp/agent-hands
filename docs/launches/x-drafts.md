# X drafts — to review, update and post

Status per draft: `draft` → `ready` → `posted (date, link)`. Under 280 chars per post;
a link counts as 23.

## 0.19.0 — your agent, your real browser (status: draft)

Thread text lives in [01-real-browser.md](01-real-browser.md). Attach `docs/assets/hero.gif`.

## 0.19.1 — payment forms in iframes (status: draft)

1/

Your AI agent can now fill Stripe's card form.

Card fields live in cross-origin iframes, which page scripts cannot see. agent-hands now reads every frame on the page and clicks into it, even with the tab in the background.

github.com/yassiEmp/agent-hands

2/

It cost three bugs to get there:
- the snapshot never looked inside frames
- pages that scroll an inner box never moved
- in a background tab, a click into a frame landed on the page behind it

Each one is measured in the repo.

## Stealth benchmark (status: waiting for the run)

To write once the numbers exist. One number, the method, and a reproduction
command. See `docs/benchmarks/`.
