// A short, rare note asking for a GitHub star, and the `star` command it points to.
//
// agent-hands has users and no marketing. The note shows on a first run, then
// again only after long use: STAR_AFTER_RUNS successful commands over at least
// STAR_AFTER_DAYS days, and after that once a month at most. It goes to stderr,
// so --json output stays clean, and `agent-hands star --off` ends it for good.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STATE_DIR } from './tab.mjs';

export const REPO_URL = 'https://github.com/yassiEmp/agent-hands';
export const X_URL = 'https://x.com/yassi_yari';

const FILE = path.join(STATE_DIR, 'star.json');
const DAY = 86400000;
const STAR_AFTER_RUNS = 150;
const STAR_AFTER_DAYS = 7;
const REPEAT_DAYS = 30;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { firstSeen: Date.now(), runs: 0 }; }
}

function save(s) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s)); } catch { /* no note is fine */ }
}

// Called once per process, on a successful exit. Returns the note, or null.
export function noteAfterRun({ now = Date.now() } = {}) {
  if (process.env.AGENT_HANDS_NO_STAR || process.env.CI) return null;
  const s = load();
  s.runs = (s.runs ?? 0) + 1;
  let show = false;
  if (!s.off) {
    if (!s.shownFirst) { show = true; s.shownFirst = now; }
    else if (!s.shownLong) {
      show = s.runs >= STAR_AFTER_RUNS && now - s.firstSeen >= STAR_AFTER_DAYS * DAY;
      if (show) s.shownLong = now;
    } else if (now - (s.lastShown ?? 0) >= REPEAT_DAYS * DAY && s.runs - (s.runsAtShow ?? 0) >= STAR_AFTER_RUNS) {
      show = true;
    }
  }
  if (show) { s.lastShown = now; s.runsAtShow = s.runs; }
  save(s);
  if (!show) return null;
  return s.shownLong
    ? `\n★ You have run agent-hands ${s.runs} times. It is a solo project; a star helps: agent-hands star`
    : '\n★ agent-hands is built by one person, for fun. If it helps you: agent-hands star';
}

const MESSAGE = `agent-hands is made by one developer, in spare time, for fun.
No company, no funding, no marketing. People use it, but few know it exists.

If it saved you time, two clicks go a long way:
  ★ a star on GitHub   ${REPO_URL}
  ✚ follow on X        ${X_URL}

  agent-hands star --open    open the GitHub page (and stop this note)
  agent-hands star --x       open the X profile
  agent-hands star --off     never show the note again`;

function openUrl(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// Agents run this without a terminal, so every choice is also a flag.
export async function starCommand(args) {
  const f = args.flags;
  const s = load();
  if (f.open || f.x) {
    openUrl(f.x ? X_URL : REPO_URL);
    if (f.open) { s.off = true; save(s); }
    return console.log(`✓ opened ${f.x ? X_URL : REPO_URL}${f.open ? '. Thank you. The note will not show again.' : ''}`);
  }
  if (f.off) {
    s.off = true; save(s);
    return console.log('✓ the star note is off for good. agent-hands star still works if you change your mind.');
  }
  if (f.on) {
    s.off = false; save(s);
    return console.log('✓ the star note is back on.');
  }
  console.log(MESSAGE);
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('\n[g] open GitHub   [x] open X   [n] never show again   [enter] later  > ')).trim().toLowerCase();
  rl.close();
  if (a === 'g') { openUrl(REPO_URL); s.off = true; save(s); console.log('Thank you.'); }
  else if (a === 'x') openUrl(X_URL);
  else if (a === 'n') { s.off = true; save(s); console.log('Done. It will not show again.'); }
}
