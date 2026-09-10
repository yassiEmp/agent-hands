// Runs automatically after `npm version <patch|minor|major>` commits + tags the bump.
// Pushes both, then opens a GitHub release from the tag — that release publish event is what
// triggers .github/workflows/publish.yml to push the new version to npm.
//
// So the whole release is one command: `npm version patch`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const tag = `v${version}`;

run("git", ["push"]);
run("git", ["push", "origin", tag]);
run("gh", ["release", "create", tag, "--title", tag, "--generate-notes"]);

console.log(`\nReleased ${tag} — publish workflow: https://github.com/yassiEmp/agent-hands/actions/workflows/publish.yml`);
