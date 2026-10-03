// What this machine has, and what each missing piece would unlock.
//
// The CLI needs Node 22+ and a Chromium browser. Everything else is optional
// and degrades to a message that names the fix. `doctor` prints this block so
// a fresh install learns what is missing instead of failing on the first thing
// it cannot find, and every "install X" hint elsewhere checks here first so it
// never tells a developer to run a tool they do not have.

import fs from 'node:fs';
import path from 'node:path';
import { NODE_MIN } from './require-node.mjs';

export function nodeCheck(version = process.versions.node) {
  const major = parseInt(String(version).split('.')[0], 10) || 0;
  return { version, ok: major >= NODE_MIN, min: NODE_MIN };
}

// PATH lookup without a spawn. Windows resolves through PATHEXT, so a pip
// launcher (agent-win.exe) and an npm shim (agent-browser.cmd) both count.
export function whichSync(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')]
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

export const hasAgentBrowser = () => whichSync('agent-browser') !== null;

// A PATH hit answers without a spawn. The spawn starts Python, which cost 3s
// on an idle machine and 20s on a loaded one, and doctor is the first command
// a new user runs. $AGENT_WIN outranks PATH at run time, so when it is set,
// only the real probe tells which candidate answers.
async function findAgentWin() {
  const onPath = !process.env.AGENT_WIN || isDir(process.env.AGENT_WIN)
    ? whichSync('agent-win') : null;
  if (onPath) return { how: 'agent-win on PATH' };
  // Lazy: uia.mjs spawns, and nothing but doctor should pay for that.
  const { probe } = await import('./uia.mjs');
  return probe();
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export async function probeEnvironment() {
  const win = process.platform === 'win32' ? await findAgentWin() : null;
  const agentBrowser = whichSync('agent-browser');
  return {
    node: nodeCheck(),
    platform: process.platform,
    tools: {
      'agent-win': {
        found: Boolean(win), how: win?.how ?? null, optional: true, windowsOnly: true,
        unlocks: 'login --window',
        without: 'login --window refuses and says why',
        install: 'pip install agent-win',
      },
      'agent-browser': {
        found: Boolean(agentBrowser), how: agentBrowser, optional: true, windowsOnly: false,
        unlocks: 'pooled throwaway sessions (--session)',
        without: 'agent-hands launch <url>, --browser <name> or --cdp <port>',
        install: 'npm i -g agent-browser',
      },
    },
  };
}

export function renderEnvironment(env) {
  const names = ['node', 'platform', ...Object.keys(env.tools)];
  const w = Math.max(...names.map(n => n.length));
  const row = (name, state, note) => `  ${name.padEnd(w)}  ${state.padEnd(7)}  ${note}`;
  const more = note => row('', '', note);
  const lines = ['ENVIRONMENT'];
  lines.push(env.node.ok
    ? row('node', 'ok', env.node.version)
    : row('node', 'TOO OLD', `${env.node.version}; needs ${env.node.min}+ for the built-in WebSocket`));
  lines.push(row('platform', '', env.platform));
  for (const [name, t] of Object.entries(env.tools)) {
    if (t.windowsOnly && env.platform !== 'win32') {
      lines.push(row(name, 'n/a', 'Windows only (UI Automation); login --window is unavailable here'));
      continue;
    }
    if (t.found) { lines.push(row(name, 'found', t.how ?? '')); continue; }
    lines.push(row(name, 'missing', `optional: ${t.unlocks}`));
    lines.push(more(`without it: ${t.without}`));
    lines.push(more(`install: ${t.install}`));
  }
  return lines.join('\n');
}
