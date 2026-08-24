// Persistent targeting, so a command stops being amnesiac.
//
// The whole risk of this file is hidden state: after it exists, a command can
// behave differently because of something the agent never typed and cannot see
// in its own transcript. Three rules pay for that, and none is optional:
//
//   1. An explicit flag ALWAYS wins. The escape hatch never disappears.
//   2. The pin is discoverable in one word: `agent-hands use`.
//   3. A pin is verified live before it is used, and a dead one REFUSES rather
//      than falling through to whatever else is open. Silent fallback is the
//      bug this feature exists to remove.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const DIR = '.agent-hands';
const FILE = 'config.json';
export const GLOBAL_DIR = path.join(os.homedir(), DIR);

// Identity, harness-agnostically.
//
// Not a vendor list: those rot, and this has to work on Codex, Cursor, Pi and
// whatever ships next. Match env NAMES against a shape instead. Claude Code's
// CLAUDE_CODE_SESSION_ID matches today; a terminal's WT_SESSION_ID matches with
// no change. Measured stable across calls, which is the property that matters —
// process.ppid is not, and a WMI tree walk costs 822ms against a 246ms command.
const ID_SHAPE = /(SESSION|CONVERSATION|THREAD)_?ID$/;

export function agentId() {
  if (process.env.AGENT_HANDS_ID) return short(process.env.AGENT_HANDS_ID);
  const names = Object.keys(process.env).filter(k => ID_SHAPE.test(k)).sort();
  for (const k of names) if (process.env[k]) return short(process.env[k]);
  return null;                       // no agent layer; project scope still works
}

const short = v => crypto.createHash('sha1').update(String(v)).digest('hex').slice(0, 8);

// Walk up for a project config the way git and eslint do, so a subdirectory of
// the project inherits it.
export function projectDir(from = process.cwd()) {
  let d = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(d, DIR))) return path.join(d, DIR);
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function readFileSafe(dir) {
  if (!dir) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch { return null; }
}

function writeFileSafe(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, FILE);
  fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(f + '.tmp', f);
  return f;
}

// global defaults < global agent < project defaults < project agent.
// Most specific wins, and an explicit flag beats all of it back in the caller.
export function load(cwd = process.cwd()) {
  const id = agentId();
  const pDir = projectDir(cwd);
  const g = readFileSafe(GLOBAL_DIR) || {};
  const p = readFileSafe(pDir) || {};
  const layer = (c, key) => (key && c.agents ? c.agents[key] : null) || {};
  const merged = {
    ...(g.defaults || {}), ...layer(g, id),
    ...(p.defaults || {}), ...layer(p, id),
  };
  return { merged, id, projectPath: pDir, globalPath: GLOBAL_DIR, hasProject: Boolean(pDir) };
}

export function save(patch, { scope = 'agent', cwd = process.cwd() } = {}) {
  const id = agentId();
  const dir = scope === 'global'
    ? GLOBAL_DIR
    : (projectDir(cwd) || path.join(path.resolve(cwd), DIR));
  const cur = readFileSafe(dir) || {};
  if (scope === 'agent' && id) {
    cur.agents = cur.agents || {};
    cur.agents[id] = { ...(cur.agents[id] || {}), ...patch };
  } else {
    cur.defaults = { ...(cur.defaults || {}), ...patch };
  }
  return { file: writeFileSafe(dir, cur), scope: scope === 'agent' && !id ? 'project' : scope, id };
}

export function clear({ scope = 'agent', cwd = process.cwd() } = {}) {
  const id = agentId();
  const dir = scope === 'global' ? GLOBAL_DIR : projectDir(cwd);
  if (!dir) return null;
  const cur = readFileSafe(dir);
  if (!cur) return null;
  if (scope === 'agent' && id && cur.agents) delete cur.agents[id];
  else delete cur.defaults;
  return writeFileSafe(dir, cur);
}

// A pin records enough to prove the SAME browser is still there. A port alone is
// not identity: a different browser can take a freed port, and driving it would
// be the exact wrong-window failure this is meant to stop.
export function pinFrom(endpoint, info = {}) {
  return {
    kind: endpoint.cdp ? 'cdp' : endpoint.browser ? 'browser' : endpoint.userDataDir ? 'dir' : 'session',
    cdp: endpoint.cdp ?? null,
    browser: endpoint.browser ?? null,
    userDataDir: endpoint.userDataDir ?? null,
    session: endpoint.session ?? null,
    tab: endpoint.tab ?? null,
    port: info.port ?? null,
    browserVersion: info.browserVersion ?? null,
    profile: info.profile ?? null,
    pinnedAt: info.now ?? null,
  };
}

// The endpoint options a pin implies, ready for CDP.connect.
export function pinToEndpoint(pin) {
  if (!pin) return null;
  const e = {};
  if (pin.cdp) e.cdp = pin.cdp;
  if (pin.browser) e.browser = pin.browser;
  if (pin.userDataDir) e.userDataDir = pin.userDataDir;
  if (pin.session) e.session = pin.session;
  if (pin.tab) e.tab = pin.tab;
  return e;
}

// ---------------------------------------------------------------- identity --

// A fresh identity, handed to an agent that turns out to need one. Printed, not
// hidden: the agent can carry it into later commands or pass it to a sibling.
export function mintId() {
  return 'ah-' + crypto.randomBytes(3).toString('hex');
}

// ------------------------------------------------------------- provenance ---

const nonce = () => crypto.randomBytes(4).toString('hex');

// Two indistinguishable siblings can still overwrite each other's pin. We
// cannot prevent that — no harness exposes a per-agent identity, which is an
// open request on both claude-code (#36981) and codex (#20852). So make it
// LOUD instead: a pin records who wrote it and when, and replacing a fresh one
// written by somebody else is reported with the fix. Visibility is the fix when
// prevention is not available.
export function stamp(patch) {
  return { ...patch, _writer: nonce(), _at: Date.now() };
}

export function conflict(existing, next, { windowMs = 2 * 60 * 1000 } = {}) {
  if (!existing?._writer || !existing?._at) return null;
  if (Date.now() - existing._at > windowMs) return null;
  // Only a CHANGE of target is worth reporting. An agent re-pinning the same
  // browser is the ordinary case and must not be nagged, or the warning becomes
  // noise and stops being read on the one occasion it matters.
  const same = JSON.stringify(pinKey(existing.target)) === JSON.stringify(pinKey(next));
  if (same) return null;
  return {
    writer: existing._writer,
    ageSec: Math.round((Date.now() - existing._at) / 1000),
    was: existing.target ?? null,
  };
}

const pinKey = t => (t ? [t.cdp, t.browser, t.session, t.userDataDir] : null);

// -------------------------------------------------------------- resolution --

// Precedence, and the first rule is the one that keeps this safe:
// an explicit flag ALWAYS wins, so the escape hatch never disappears.
export function targetFlagsPresent(args) {
  return Boolean(args.cdp || args.browser || args.userDataDir || args.explicitSession
    || process.env.AGENT_HANDS_CDP);
}

export function pinnedTarget(cwd = process.cwd()) {
  const { merged, id, projectPath, globalPath, hasProject } = load(cwd);
  return { pin: merged.target ?? null, extras: merged, id, projectPath, globalPath, hasProject };
}
