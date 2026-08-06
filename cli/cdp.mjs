// CDP transport and session resolution.
//
// A backgrounded Chrome window never acknowledges Input.* commands: it waits
// for a renderer frame that throttling does not produce, then times out after
// exactly 5000ms. The event is delivered regardless. So input is fired without
// awaiting a reply and paced by the caller's clock.
//
// Targets are discovered over the browser websocket, not over HTTP. Chrome and
// Edge M144+ expose remote debugging through chrome://inspect without the
// --remote-debugging-port flag. That server serves no /json/* routes: every
// path returns 404 and a root websocket upgrade returns 403. Only
// ws://127.0.0.1:<port>/devtools/browser/<uuid> accepts a connection, and
// DevToolsActivePort line 2 carries that path.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeName, probe } from './daemon.mjs';

const HOME = os.homedir();
const PROFILES = process.env.AGENT_HANDS_PROFILES
  || path.join(HOME, '.agent-browser-profiles');

// User data directories of browsers this machine did not launch.
const EXTERNAL = {
  edge: path.join(HOME, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
  chrome: path.join(HOME, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
};

// work -> main, work-2 -> main-2, matching the agent-browser profile pool.
export function profileDir(session) {
  const suffix = session === 'work' ? '' : '-' + session.replace(/^work-?/, '');
  return path.join(PROFILES, 'main' + suffix);
}

// Both lines matter. Line 1 is the port. Line 2 is the browser target path,
// which is the only route the M144 server accepts.
function readPortFile(dir) {
  const file = path.join(dir, 'DevToolsActivePort');
  if (!fs.existsSync(file)) return null;
  const [port, browserPath] = fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim());
  return { port, browserPath: browserPath || null, file };
}

// Resolve to { port, browserPath }. browserPath may be null on a classic
// endpoint, where HTTP discovery still works.
export function resolveEndpoint({ session, cdp, browser } = {}) {
  const explicit = cdp || process.env.AGENT_HANDS_CDP;

  if (explicit) {
    const m = String(explicit).match(/^wss?:\/\/[^/]+(\/devtools\/browser\/.+)$/);
    if (m) return { port: String(explicit).match(/:(\d+)/)[1], browserPath: m[1] };
    if (/^\d+$/.test(explicit)) return recoverPath(explicit);
    throw new Error(`--cdp expects a port or a ws://host:port/devtools/browser/<uuid> url, got "${explicit}"`);
  }

  if (browser) {
    const dir = EXTERNAL[browser];
    if (!dir) throw new Error(`unknown browser "${browser}". Use one of: ${Object.keys(EXTERNAL).join(', ')}`);
    const found = readPortFile(dir);
    if (!found) {
      throw Object.assign(new Error(
        `${browser} is not exposing a debugging endpoint.\n` +
        `  looked for: ${path.join(dir, 'DevToolsActivePort')}\n` +
        `  fix: open ${browser === 'edge' ? 'edge' : 'chrome'}://inspect/#remote-debugging\n` +
        `       and tick "Allow remote debugging for this browser instance"`
      ), { code: 'ENOSESSION' });
    }
    return found;
  }

  const dir = profileDir(session);
  const found = readPortFile(dir);
  if (!found) {
    throw Object.assign(new Error(
      `session "${session}" is not running.\n` +
      `  looked for: ${path.join(dir, 'DevToolsActivePort')}\n` +
      `  fix: launch it, then retry:\n` +
      `    agent-browser --session ${session} --profile "${dir}" open <url> --headed`
    ), { code: 'ENOSESSION' });
  }
  return found;
}

// A bare port gives no uuid. Classic endpoints do not need one. M144 endpoints
// do, so look through known user data directories for a file naming that port.
function recoverPath(port) {
  for (const dir of [PROFILES, ...Object.values(EXTERNAL)]) {
    for (const d of candidateDirs(dir)) {
      const found = readPortFile(d);
      if (found && found.port === String(port)) return found;
    }
  }
  return { port: String(port), browserPath: null };
}

function candidateDirs(root) {
  if (!fs.existsSync(root)) return [];
  const self = readPortFile(root) ? [root] : [];
  const kids = fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(root, e.name));
  return [...self, ...kids];
}

// Kept for callers that still pass a session name only.
export function devtoolsPort(session) {
  return resolveEndpoint({ session }).port;
}

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessionId = null; }

  // Classic HTTP discovery stays authoritative. agent-browser sessions also
  // write line 2, so keying off its presence would silently move every
  // existing session onto the flat-attach path. Probe first, fall back only
  // when /json/list is genuinely absent, which is the M144 case.
  static async connect(sessionOrOpts) {
    const opts = typeof sessionOrOpts === 'string' ? { session: sessionOrOpts } : sessionOrOpts;
    const { port, browserPath } = resolveEndpoint(opts);

    const targets = await listTargets(port);
    if (targets) return CDP.attachPerPage(targets);

    if (!browserPath) {
      throw new Error(`no CDP endpoint on port ${port}. The browser may have exited.`);
    }
    return CDP.attachFlat(port, browserPath);
  }

  // Pre-existing path. One socket per page, no sessionId.
  static async attachPerPage(targets) {
    const page = pickPage(targets);
    const cdp = await CDP.open(page.webSocketDebuggerUrl);
    cdp.url = page.url;
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    return cdp;
  }

  // M144 path. One browser socket, targets over CDP, flat session.
  //
  // The socket is opened by a daemon, not here. M144 prompts the user to
  // authorize every new CDP connection, so a per-invocation socket would ask
  // on every command. One daemon means one prompt per browser run.
  static async attachFlat(port, browserPath, { shared = true } = {}) {
    const wsUrl = `ws://127.0.0.1:${port}${browserPath}`;
    const cdp = shared ? await DaemonCDP.open(wsUrl) : await CDP.open(wsUrl);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = pickPage(targetInfos);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    cdp.sessionId = sessionId;
    cdp.url = page.url;
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    return cdp;
  }

  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
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
    return cdp;
  }

  // sessionId is injected here so gestures.mjs needs no change.
  #envelope(method, params, id) {
    return JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) });
  }

  send(method, params = {}) {
    const id = ++this.id;
    // Browser-domain calls must not carry a page sessionId.
    const browserDomain = method.startsWith('Target.') || method.startsWith('Browser.');
    const body = browserDomain
      ? JSON.stringify({ id, method, params })
      : this.#envelope(method, params, id);
    this.ws.send(body);
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad }));
  }

  // Input.* and in-page scroll writes: send, do not await. See header note.
  fire(method, params = {}) {
    this.ws.send(this.#envelope(method, params, ++this.id));
  }

  async evaluate(expression) {
    const { result } = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return result.value;
  }

  // Round-trip a cheap call so queued input flushes before the socket closes.
  async drain() { await this.evaluate('0').catch(() => {}); }

  close() { this.ws.close(); }
}

// Same surface as CDP, but the browser socket lives in the daemon. Every
// method gestures.mjs touches — send, fire, evaluate, drain, close — behaves
// identically, so callers cannot tell the difference.
export class DaemonCDP extends CDP {
  constructor(sock) { super(null); this.sock = sock; }

  static async open(wsUrl) {
    const pipe = pipeName(wsUrl);
    if (!(await probe(pipe))) await DaemonCDP.spawnDaemon(wsUrl, pipe);

    const sock = await new Promise((ok, bad) => {
      const s = net.connect(pipe);
      s.once('connect', () => ok(s));
      s.once('error', e => bad(new Error(`daemon unreachable on ${pipe}: ${e.message}`)));
    });

    const cdp = new DaemonCDP(sock);
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        const p = cdp.pending.get(msg.id);
        if (!p) continue;
        cdp.pending.delete(msg.id);
        msg.error ? p.bad(new Error(msg.error.message)) : p.ok(msg.result);
      }
    });
    return cdp;
  }

  static spawnDaemon(wsUrl, pipe) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const child = spawn(process.execPath, [path.join(here, 'daemon.mjs'), wsUrl], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    // Wait for the pipe rather than a fixed sleep: the user may take a
    // moment to click Allow on the authorization dialog.
    return new Promise((ok, bad) => {
      const deadline = Date.now() + 60_000;
      (async function poll() {
        if (await probe(pipe)) return ok();
        if (Date.now() > deadline) return bad(new Error('daemon did not start within 60s (was the browser prompt approved?)'));
        setTimeout(poll, 250);
      })();
    });
  }

  #write(obj) { this.sock.write(JSON.stringify(obj) + '\n'); }

  send(method, params = {}) {
    const id = ++this.id;
    const browserDomain = method.startsWith('Target.') || method.startsWith('Browser.');
    this.#write({ id, method, params, ...(!browserDomain && this.sessionId ? { sessionId: this.sessionId } : {}) });
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad }));
  }

  // No id: the daemon relays without tracking a reply. See CDP.fire.
  fire(method, params = {}) {
    this.#write({ method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) });
  }

  // Closing a client must not close the shared browser socket. Tear the pipe
  // down synchronously: an end() still in flight when the process exits trips
  // a libuv assertion on Windows (UV_HANDLE_CLOSING in async.c).
  close() {
    for (const p of this.pending.values()) p.bad(new Error('connection closed'));
    this.pending.clear();
    this.sock.removeAllListeners();
    this.sock.destroy();
    this.sock.unref?.();
  }
}

// null means the endpoint serves no /json/list, not that there are no tabs.
async function listTargets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function pickPage(targets) {
  const pages = targets.filter(t => t.type === 'page');
  const page = pages.find(t => !/^(chrome|edge|devtools):/.test(t.url)) || pages[0];
  if (!page) throw new Error('no page target found. Open a tab first.');
  return page;
}

// Ground truth about the running browser. Browser.getVersion works on both
// endpoint styles; /json/version does not exist on M144.
export async function browserInfo(portOrCdp) {
  if (portOrCdp instanceof CDP) {
    try {
      const v = await portOrCdp.send('Browser.getVersion');
      return { browser: v.product, headless: /Headless/i.test(v.product || v.userAgent || '') };
    } catch { return { browser: null, headless: null }; }
  }
  try {
    const v = await (await fetch(`http://127.0.0.1:${portOrCdp}/json/version`)).json();
    return {
      browser: v.Browser,
      headless: /Headless/i.test(v.Browser || '') || /Headless/i.test(v['User-Agent'] || ''),
    };
  } catch {
    return { browser: null, headless: null };
  }
}
