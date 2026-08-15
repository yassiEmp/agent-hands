// Which browsers can this machine drive, and which one holds the login?
//
// Without this an agent guesses. It picks a pooled profile, finds no session,
// loses minutes, and eventually reaches for a raw script. Worse, a stale
// DevToolsActivePort left by a closed browser looks identical to a live one, so
// "not signed in" and "not running" are indistinguishable until something
// probes. Both failures are one command away from being obvious.

import fs from 'node:fs';
import path from 'node:path';
import { browserNames, browserDir, profileDir, readPortFile, portAlive } from './cdp.mjs';

const POOL = ['work', 'work-2', 'work-3', 'work-4', 'work-5'];

// A listening port is not proof of a browser. On this machine a closed Edge
// left a background process holding its old port while refusing every
// debugging socket, so TCP alone reported "running" for a browser with no
// windows. Ask for HTTP: a real endpoint answers, classic with 200 and M144
// with 404. Anything else is squatting on the port.
async function probeEndpoint(port) {
  if (!(await portAlive(port, 800))) return { state: 'dead', detail: 'nothing listening' };
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) {
      const v = await r.json().catch(() => ({}));
      return { state: 'running', detail: v.Browser || 'classic endpoint' };
    }
    // 144+ serves no /json/* but still answers HTTP. Note the honest limit: a
    // closed browser can leave a background process answering here while
    // refusing every websocket. Only a real connect settles it, and probing
    // that way would stack an approval modal per browser listed.
    return { state: 'running', detail: `144+ endpoint (HTTP ${r.status})` };
  } catch {
    return { state: 'stale', detail: 'port held, but no debugging endpoint' };
  }
}

export async function survey() {
  const rows = [];

  for (const session of POOL) {
    const dir = profileDir(session);
    const found = readPortFile(dir);
    if (!found && !fs.existsSync(dir)) continue;         // slot never used
    const probe = found ? await probeEndpoint(found.port) : { state: 'off', detail: 'not running' };
    rows.push({ kind: 'pool', name: session, dir, port: found?.port ?? null,
                state: probe.state, detail: probe.detail, portFile: found?.file ?? null });
  }

  for (const name of browserNames()) {
    const dir = browserDir(name);
    if (!dir || !fs.existsSync(dir)) continue;           // browser not installed
    const found = readPortFile(dir);
    const probe = found ? await probeEndpoint(found.port)
                        : { state: 'off', detail: 'remote debugging not enabled' };
    rows.push({ kind: 'external', name, dir, port: found?.port ?? null,
                state: probe.state, detail: probe.detail, portFile: found?.file ?? null });
  }

  return rows;
}

const MARK = { running: '●', stale: '✗', dead: '✗', off: '○' };

export function render(rows) {
  if (!rows.length) return 'no browsers found on this machine.';
  const live = rows.filter(r => r.state === 'running');
  const w = Math.max(...rows.map(r => r.name.length));
  const out = [];

  out.push('BROWSERS');
  for (const r of rows) {
    const flag = r.kind === 'pool' ? `--session ${r.name}` : `--browser ${r.name}`;
    out.push(`  ${MARK[r.state] ?? '?'} ${r.name.padEnd(w)}  ${String(r.port ?? '-').padEnd(6)}`
      + `  ${r.detail}`.padEnd(38) + `  ${flag}`);
  }

  out.push('');
  if (!live.length) {
    out.push('Nothing is reachable right now.');
    const off = rows.filter(r => r.kind === 'external' && r.state !== 'running');
    if (off.length) {
      out.push(`  To use a browser you already have open, enable debugging in it:`);
      out.push(`    ${/edge/.test(off[0].name) ? 'edge' : 'chrome'}://inspect/#remote-debugging`
        + `  ->  "Allow remote debugging for this browser instance"`);
    }
    out.push(`  Or start a throwaway one:`);
    out.push(`    agent-browser --session work --profile "${profileDir('work')}" open <url> --headed`);
  } else if (live.length === 1) {
    const r = live[0];
    out.push(`One endpoint answers: ${r.name}`
      + `  (${r.kind === 'pool' ? `--session ${r.name}` : `--browser ${r.name}`})`);
    if (r.kind === 'external') {
      out.push('  Answering HTTP is not proof the browser is open — a closed one can');
      out.push('  leave this port behind. Confirm with: agent-hands doctor '
        + `--browser ${r.name}`);
    }
  } else {
    out.push('More than one browser is reachable. ASK THE USER which one to drive —');
    out.push('logins live in a specific profile, and the wrong one silently looks logged out.');
  }

  const stale = rows.filter(r => r.state === 'stale' || r.state === 'dead');
  if (stale.length) {
    out.push('');
    out.push('Stale port files (a closed browser left these behind):');
    for (const r of stale) out.push(`  ${r.portFile}`);
  }
  return out.join('\n');
}
