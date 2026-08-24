// agent-win bridge: the OS accessibility lane.
//
// WHY THIS EXISTS SEPARATELY FROM CDP. Attaching CDP sets navigator.webdriver
// on Edge/Chrome 151, and a login form is the worst possible moment to be
// carrying that flag. UIA leaves no browser-automation trace at all, because it
// is the same layer a screen reader uses. So authentication happens through UIA
// with nothing attached, and CDP arrives only afterwards.
//
// This is a NARROW exception to "do not drive pages with UIA". It buys one
// thing — a clean sign-in — and it costs speed and breaks on re-renders. Once
// signed in, hand the page back to CDP and never come back here.

import { spawn } from 'node:child_process';
import fs from 'node:fs';

let RESOLVED;

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function candidates() {
  const python = process.env.AGENT_WIN_PYTHON || 'python';
  const list = [];
  // AGENT_WIN is documented as an executable, but a checkout path is the
  // obvious thing to put there, and spawning a directory fails silently.
  const win = process.env.AGENT_WIN;
  const winDir = win && isDir(win) ? win : null;
  if (win && !winDir) list.push({ cmd: win, pre: [] });
  list.push({ cmd: 'agent-win', pre: [] });
  list.push({ cmd: python, pre: ['-m', 'agent_win'], home: winDir });
  return list;
}

function spawnOnce({ cmd, pre, home }, args) {
  return new Promise(resolve => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], {
        env: {
          ...process.env,
          PYTHONPATH: home || process.env.AGENT_WIN_HOME || process.env.PYTHONPATH || '',
          PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['ignore', 'pipe', 'ignore'],
        // Otherwise Windows gives the child a console window that flashes up and
        // takes the foreground. Driving UIA is supposed to be invisible.
        windowsHide: true,
      });
    } catch {
      return resolve(null);
    }
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', code => resolve(code === 0 ? out : null));
  });
}

export async function agentWin(args) {
  if (RESOLVED === null) return null;
  if (RESOLVED) return spawnOnce(RESOLVED, args);
  for (const c of candidates()) {
    const out = await spawnOnce(c, args);
    if (out !== null) { RESOLVED = c; return out; }
  }
  RESOLVED = null;
  return null;
}

export function agentWinMissing() { return RESOLVED === null; }

export const MISSING_HINT =
  'agent-win is not installed, so the OS accessibility lane is unavailable.\n' +
  '  install: https://github.com/yassiEmp/agent-win  (or set AGENT_WIN_HOME to a checkout)';

async function json(args) {
  const out = await agentWin([...args, '--json']);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

export async function windows() {
  const j = await json(['windows']);
  return j?.windows ?? j?.matches ?? (Array.isArray(j) ? j : []);
}

export async function snapshot(win) {
  const j = await json(['snapshot', ...(win ? ['--window', win] : [])]);
  return j?.elements ?? j?.matches ?? (Array.isArray(j) ? j : []);
}

// -q so the post-action state dump never echoes what was typed. A password must
// not reach stdout, a log, or an agent transcript.
export const fill   = (ref, text) => agentWin(['fill', ref, text, '-q']);
export const invoke = ref => agentWin(['invoke', ref, '-q']);
export const toggle = ref => agentWin(['toggle', ref, '-q']);
