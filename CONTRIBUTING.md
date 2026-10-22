# Contributing

Thank you for looking. agent-hands is a solo project, so a clear issue helps
as much as a pull request.

## Where to talk

- A bug: [open an issue](https://github.com/yassiEmp/agent-hands/issues/new/choose).
  Paste the output of `agent-hands doctor`.
- A question or an idea: [Discussions](https://github.com/yassiEmp/agent-hands/discussions).
- A security problem: see [SECURITY.md](SECURITY.md). Never in public.

## Working on the code

- Node 22 or newer. There are no npm dependencies; keep it that way.
- Run the CLI from the checkout: `node bin/agent-hands.mjs doctor`.
- Test on a throwaway browser first: `node bin/agent-hands.mjs launch https://example.com`.
  Never test against your own logged-in browser by default.
- A change to timing or input must keep the measured human ranges. The method
  and the numbers are in [docs/evidence.md](docs/evidence.md).
- Explain the WHY in a comment only when it is not obvious from the code,
  and record what you measured in `HANDOFF.md`.

## Releases

Only the maintainer releases, through `npm version`, which publishes from CI.
