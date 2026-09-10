# agent-hands — project notes for Claude

## Releasing to npm

Publishing is CI-only, gated by a GitHub release — never run `npm publish` by
hand here. `.github/workflows/publish.yml` publishes via npm Trusted
Publishing (OIDC), which npmjs.com has been configured to accept only from
`yassiEmp/agent-hands`'s `publish.yml` workflow, environment `npm`. There is
no npm token in this repo or its secrets; that's the point.

To ship: `npm version patch|minor|major`. That one command bumps
`package.json`, commits, tags, and (via the `postversion` hook in
`scripts/postversion.mjs`) pushes and opens the GitHub release that triggers
the publish. Full detail: `HANDOFF.md`, "How to ship a release".

**Why a release gate instead of publish-on-push**: agreed with the owner
10 Sep 2026 — every push to `main` going straight to npm means a bad commit
ships immediately with no review point. `npm version` is the one deliberate
step; everything after it is automatic.

Local `package.json` version can sit ahead of what's on npm (committed but
unreleased) — that's normal, not a bug. Check what's actually live with
`npm view agent-hands version`.
