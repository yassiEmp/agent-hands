# Security policy

agent-hands drives a browser that holds real logins, so a flaw here can reach
real accounts. Please report it privately.

## Report a vulnerability

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/yassiEmp/agent-hands/security/advisories/new).
Do not open a public issue, and do not post details in a discussion or on X.

Include the version (`agent-hands version`), the OS and browser, and the
steps that show the problem.

## What to expect

- A first answer within 7 days. agent-hands is maintained by one person.
- A fix in the next release, and a published advisory that credits you,
  unless you ask not to be named.

## Supported versions

Only the latest release on npm receives fixes. `npm view agent-hands version`
shows it.

## In scope

- Anything that exposes credentials, cookies or page content outside the
  browser, for example in argv, logs, audit lines or the clipboard.
- The relay daemon and its local pipe: anything that lets another local
  process drive the browser without the approval prompt.
- The approval auto-click (`cli/approve.ps1`) clicking a prompt that agent-hands
  did not start.
