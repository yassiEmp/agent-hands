// One row of adoption numbers, for docs/metrics.csv. Run weekly.
//
// GitHub keeps traffic for 14 days, so a missed fortnight is gone. npm and
// stars can be recovered later; referrers cannot. Prints CSV to stdout;
// --append writes the row to docs/metrics.csv and prints it.
//
//   node scripts/metrics.mjs            # print
//   node scripts/metrics.mjs --append   # print and append

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'yassiEmp/agent-hands';
const PKG = 'agent-hands';
const CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'metrics.csv');
const HEADER = 'date,npm_week,npm_month,stars,forks,watchers,views_14d,uniques_14d,clones_14d,clone_uniques_14d,stranger_issues,top_referrers';

function gh(route) {
  try {
    return JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return null; }
}

async function npm(range) {
  try {
    const r = await fetch(`https://api.npmjs.org/downloads/point/${range}/${PKG}`);
    return (await r.json()).downloads ?? '';
  } catch { return ''; }
}

const [week, month] = await Promise.all([npm('last-week'), npm('last-month')]);
const repo = gh(`repos/${REPO}`) ?? {};
const views = gh(`repos/${REPO}/traffic/views`) ?? {};
const clones = gh(`repos/${REPO}/traffic/clones`) ?? {};
const refs = gh(`repos/${REPO}/traffic/popular/referrers`) ?? [];
// Issues by anyone but the owner: the strongest sign that a stranger ran it.
const owner = REPO.split('/')[0];
const strangers = (gh(`repos/${REPO}/issues?state=all&per_page=100`) ?? [])
  .filter(i => !i.pull_request && i.user?.login !== owner).length;

const row = [
  new Date().toISOString().slice(0, 10),
  week, month,
  repo.stargazers_count ?? '', repo.forks_count ?? '', repo.subscribers_count ?? '',
  views.count ?? '', views.uniques ?? '', clones.count ?? '', clones.uniques ?? '',
  strangers,
  '"' + refs.slice(0, 5).map(r => `${r.referrer}:${r.uniques}`).join(' ') + '"',
].join(',');

if (process.argv.includes('--append')) {
  const fresh = !fs.existsSync(CSV);
  fs.appendFileSync(CSV, (fresh ? HEADER + '\n' : '') + row + '\n');
}
console.log(HEADER);
console.log(row);
