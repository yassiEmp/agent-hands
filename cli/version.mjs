// Staleness check and self-update.
//
// Why this exists: the global install was a symlink to an old clone for weeks.
// Every command ran 0.3.0 while 0.4.2 sat on disk, so an agent reading the CLI
// concluded features were missing and wrote raw CDP instead. Nothing surfaced
// the mismatch. The version an agent runs must announce itself when it is old.
//
// Gesture commands never hit the network. They read a cached answer written by
// `doctor` or `update`, because a click that waits on registry latency is a
// click with the wrong timing.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STATE = path.join(os.homedir(), '.agent-browser', 'humanize');
const CACHE = path.join(STATE, '.version-check.json');
const TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY = 'https://registry.npmjs.org/agent-hands/latest';

// fileURLToPath, not .pathname: the URL form keeps %20 for a space in the
// path and a slash before the drive letter, and path.dirname on the
// trailing-slash form returned the PARENT of the package (C:/projects), so a
// linked clone was reported as a global install and `update --yes` would have
// run npm over it.
export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');

export function runningVersion() {
  return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

// semver compare, release tags only. Prerelease suffixes sort before release,
// which is enough for "is there something newer".
export function isOlder(a, b) {
  const parse = v => String(v).split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i];
  }
  return false;
}

export function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (typeof c.latest === 'string') return c;
  } catch { /* no check yet */ }
  return null;
}

function writeCache(latest) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    const tmp = CACHE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ latest, checkedAt: Date.now() }));
    fs.renameSync(tmp, CACHE);
  } catch { /* cache is an optimisation, never a failure */ }
}

// Network. Only `doctor` and `update` call this.
export async function fetchLatest({ timeout = 3000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(REGISTRY, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const { version } = await res.json();
    if (version) writeCache(version);
    return version ?? null;
  } catch {
    return null; // offline is not an error, it is just no new information
  } finally {
    clearTimeout(t);
  }
}

export function cacheIsStale() {
  const c = readCache();
  return !c || Date.now() - (c.checkedAt ?? 0) > TTL_MS;
}

// The answer every command needs, from cache only. Never throws, never blocks.
export function staleness({ latest } = {}) {
  const running = runningVersion();
  const known = latest ?? readCache()?.latest ?? null;
  return { running, latest: known, stale: Boolean(known && isOlder(running, known)) };
}

// How this copy got onto PATH decides how to update it.
//   link    — npm link / a symlink to a working clone. Update with git.
//   global  — a normal `npm i -g`. Update with npm.
export function installMode() {
  const dir = ROOT;
  const real = (() => { try { return fs.realpathSync(dir); } catch { return dir; } })();
  const isGit = fs.existsSync(path.join(real, '.git'));
  const linked = real.toLowerCase() !== dir.toLowerCase() || isGit;
  return { mode: linked ? (isGit ? 'link' : 'global') : 'global', dir: real, git: isGit };
}

export function banner(st) {
  if (!st.stale) return '';
  return `⚠ agent-hands ${st.running} is stale — ${st.latest} is available.`
    + `\n  This version may be missing commands you need. Update: agent-hands update --yes`;
}

// Machine-readable form, merged into every --json payload so an agent sees it
// without being told to look.
export function updateField(st) {
  if (!st.stale) return null;
  return { running: st.running, latest: st.latest, stale: true, run: 'agent-hands update --yes' };
}

export async function update({ yes = false, json = false } = {}) {
  const latest = await fetchLatest() ?? readCache()?.latest ?? null;
  const st = staleness({ latest });
  const install = installMode();

  const plan = install.mode === 'link'
    ? { cmd: `git -C "${install.dir}" pull --ff-only`, how: 'linked clone — pulling the repo it points at' }
    : { cmd: 'npm i -g agent-hands@latest', how: 'global npm install' };

  if (!st.latest) {
    return { data: { ok: false, reason: 'registry unreachable', running: st.running },
             human: `Could not reach the npm registry. Running ${st.running}. Try again, or run:\n  ${plan.cmd}` };
  }
  if (!st.stale) {
    return { data: { ...st, action: 'none' },
             human: `✓ agent-hands ${st.running} is current (npm latest ${st.latest}).` };
  }
  if (!yes) {
    // Propose, do not act. The agent decides, or relays the choice to the user.
    // Field is `apply`, not `command`: the caller merges this into a payload
    // that already has command:'update', and a spread would silently clobber it.
    return { data: { ...st, action: 'proposed', mode: install.mode, apply: plan.cmd },
             human: `agent-hands ${st.running} → ${st.latest} available.\n`
                  + `  ${plan.how}\n  ${plan.cmd}\n\nApply it: agent-hands update --yes` };
  }

  let out = '';
  try {
    out = execSync(plan.cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    const err = new Error(`update failed: ${(e.stderr || e.message || '').toString().trim().slice(0, 400)}`);
    err.code = 'EUPDATE';
    throw err;
  }
  const now = runningVersionOf(install.dir) ?? st.running;
  return { data: { ...st, action: 'updated', mode: install.mode, now },
           human: `✓ updated via ${plan.how}\n  ${plan.cmd}\n  now ${now}${out ? `\n\n${out}` : ''}` };
}

// After a git pull the manifest on disk changed, but this process already read
// the old one. Re-read from the directory that was actually updated.
function runningVersionOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch { return null; }
}
