// CDP transport and session resolution.
//
// A backgrounded Chrome window never acknowledges Input.* commands: it waits
// for a renderer frame that throttling does not produce, then times out after
// exactly 5000ms. The event is delivered regardless. So input is fired without
// awaiting a reply and paced by the caller's clock.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const PROFILES = process.env.AGENT_HANDS_PROFILES
  || path.join(HOME, '.agent-browser-profiles');

// work -> main, work-2 -> main-2, matching the agent-browser profile pool.
export function profileDir(session) {
  const suffix = session === 'work' ? '' : '-' + session.replace(/^work-?/, '');
  return path.join(PROFILES, 'main' + suffix);
}

export function devtoolsPort(session) {
  const dir = profileDir(session);
  const file = path.join(dir, 'DevToolsActivePort');
  if (!fs.existsSync(file)) {
    const err = new Error(
      `session "${session}" is not running.\n` +
      `  looked for: ${file}\n` +
      `  fix: launch it, then retry:\n` +
      `    agent-browser --session ${session} --profile "${dir}" open <url> --headed`
    );
    err.code = 'ENOSESSION';
    throw err;
  }
  return fs.readFileSync(file, 'utf8').split('\n')[0].trim();
}

async function pageTarget(port) {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch {
    throw new Error(`no CDP endpoint on port ${port}. The browser may have exited.`);
  }
  const page = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome://'))
    || targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target found. Open a tab first.');
  return page;
}

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }

  static async connect(session) {
    const port = devtoolsPort(session);
    const target = await pageTarget(port);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => bad(new Error('CDP socket refused')), { once: true });
    });

    const cdp = new CDP(ws);
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      const p = cdp.pending.get(msg.id);
      if (!p) return;
      cdp.pending.delete(msg.id);
      msg.error ? p.bad(new Error(msg.error.message)) : p.ok(msg.result);
    });
    cdp.url = target.url;

    // Without OS focus Chrome refuses DOM focus to clicked fields, so
    // keystrokes go nowhere. Emulate focus rather than raising the window,
    // which would steal focus from whatever the user is doing.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad }));
  }

  // Input.* and in-page scroll writes: send, do not await. See header note.
  fire(method, params = {}) {
    this.ws.send(JSON.stringify({ id: ++this.id, method, params }));
  }

  async evaluate(expression) {
    const { result } = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return result.value;
  }

  // Round-trip a cheap call so queued input flushes before the socket closes.
  async drain() { await this.evaluate('0').catch(() => {}); }

  close() { this.ws.close(); }
}
