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

// Default user data directories of browsers this machine did not launch.
// Any Chromium fork works; this table only saves the user from typing a path.
// --user-data-dir covers forks, portable installs and non-default locations.
const CHANNELS = {
  win32: {
    chrome: 'Google/Chrome', 'chrome-beta': 'Google/Chrome Beta',
    'chrome-dev': 'Google/Chrome Dev', 'chrome-canary': 'Google/Chrome SxS',
    edge: 'Microsoft/Edge', 'edge-beta': 'Microsoft/Edge Beta',
    'edge-dev': 'Microsoft/Edge Dev', 'edge-canary': 'Microsoft/Edge SxS',
    chromium: 'Chromium', brave: 'BraveSoftware/Brave-Browser', vivaldi: 'Vivaldi',
  },
  darwin: {
    chrome: 'Google/Chrome', 'chrome-beta': 'Google/Chrome Beta',
    'chrome-dev': 'Google/Chrome Dev', 'chrome-canary': 'Google/Chrome Canary',
    edge: 'Microsoft Edge', 'edge-beta': 'Microsoft Edge Beta',
    'edge-dev': 'Microsoft Edge Dev', 'edge-canary': 'Microsoft Edge Canary',
    chromium: 'Chromium', brave: 'BraveSoftware/Brave-Browser', vivaldi: 'Vivaldi',
  },
  linux: {
    chrome: 'google-chrome', 'chrome-beta': 'google-chrome-beta',
    'chrome-dev': 'google-chrome-unstable', edge: 'microsoft-edge',
    'edge-beta': 'microsoft-edge-beta', 'edge-dev': 'microsoft-edge-dev',
    chromium: 'chromium', brave: 'BraveSoftware/Brave-Browser', vivaldi: 'vivaldi',
  },
};

function userDataRoot() {
  if (process.platform === 'win32') return path.join(HOME, 'AppData', 'Local');
  if (process.platform === 'darwin') return path.join(HOME, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
}

export function browserNames() {
  return Object.keys(CHANNELS[process.platform] || CHANNELS.linux);
}

function browserDir(name) {
  const table = CHANNELS[process.platform] || CHANNELS.linux;
  const rel = table[name];
  if (!rel) return null;
  const dir = path.join(userDataRoot(), ...rel.split('/'));
  // Windows and macOS append "User Data"; Linux uses the directory itself.
  return process.platform === 'linux' ? dir : path.join(dir, 'User Data');
}

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
export function resolveEndpoint({ session, cdp, browser, userDataDir } = {}) {
  const explicit = cdp || process.env.AGENT_HANDS_CDP;

  if (explicit) {
    const m = String(explicit).match(/^wss?:\/\/[^/]+(\/devtools\/browser\/.+)$/);
    if (m) return { port: String(explicit).match(/:(\d+)/)[1], browserPath: m[1] };
    if (/^\d+$/.test(explicit)) return recoverPath(explicit);
    throw new Error(`--cdp expects a port or a ws://host:port/devtools/browser/<uuid> url, got "${explicit}"`);
  }

  const dir = userDataDir || (browser ? browserDir(browser) : null);
  if (browser && !dir) {
    throw new Error(
      `unknown browser "${browser}" on ${process.platform}.\n` +
      `  known: ${browserNames().join(', ')}\n` +
      `  any other Chromium build works with --user-data-dir <path>`
    );
  }
  if (dir) {
    const found = readPortFile(dir);
    if (!found) {
      const scheme = /edge/.test(browser || '') ? 'edge' : 'chrome';
      throw Object.assign(new Error(
        `${browser || dir} is not exposing a debugging endpoint.\n` +
        `  looked for: ${path.join(dir, 'DevToolsActivePort')}\n` +
        `  fix: open ${scheme}://inspect/#remote-debugging in that browser and tick\n` +
        `       "Allow remote debugging for this browser instance"`
      ), { code: 'ENOSESSION' });
    }
    return found;
  }

  const pooled = profileDir(session);
  const found = readPortFile(pooled);
  if (!found) {
    throw Object.assign(new Error(
      `session "${session}" is not running.\n` +
      `  looked for: ${path.join(pooled, 'DevToolsActivePort')}\n` +
      `  fix: launch it, then retry:\n` +
      `    agent-browser --session ${session} --profile "${pooled}" open <url> --headed`
    ), { code: 'ENOSESSION' });
  }
  return found;
}

// A bare port gives no uuid. Classic endpoints do not need one. M144 endpoints
// do, so look through known user data directories for a file naming that port.
function recoverPath(port) {
  const external = browserNames().map(browserDir).filter(Boolean);
  for (const dir of [PROFILES, ...external]) {
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
    return CDP.attachFlat(port, browserPath, opts);
  }

  // Pre-existing path. One socket per page, no sessionId.
  static async attachPerPage(targets) {
    const page = pickPage(targets);
    const cdp = await CDP.open(page.webSocketDebuggerUrl);
    cdp.url = page.url;
    await enableFocusEmulation(cdp);
    return cdp;
  }

  // M144 path. One browser socket, targets over CDP, flat session.
  //
  // The socket is opened by a daemon, not here. M144 prompts the user to
  // authorize every new CDP connection, so a per-invocation socket would ask
  // on every command. One daemon means one prompt per browser run.
  static async attachFlat(port, browserPath, opts = {}) {
    const { shared = true, tab, activate = true } = opts;
    const wsUrl = `ws://127.0.0.1:${port}${browserPath}`;
    const cdp = shared ? await DaemonCDP.open(wsUrl) : await CDP.open(wsUrl);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = await choosePage(cdp, targetInfos, { tab, activate });
    cdp.sessionId = page.sessionId;
    cdp.url = page.url;
    await enableFocusEmulation(cdp);
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

  // sessionId is injected here so gestures.mjs needs no change. Browser-domain
  // calls must not carry a page sessionId.
  envelope(method, params, id, session = this.sessionId) {
    const browserDomain = method.startsWith('Target.') || method.startsWith('Browser.');
    const sid = browserDomain ? null : session;
    return { ...(id != null ? { id } : {}), method, params, ...(sid ? { sessionId: sid } : {}) };
  }

  // session overrides this.sessionId for one call, so several tabs can be
  // probed without mutating shared state.
  send(method, params = {}, session) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(this.envelope(method, params, id, session ?? this.sessionId)));
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad }));
  }

  // Input.* and in-page scroll writes: send, do not await. See header note.
  fire(method, params = {}) {
    this.ws.send(JSON.stringify(this.envelope(method, params, ++this.id)));
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

  // Waits for the pipe rather than sleeping a fixed time: the user may take a
  // moment to click Allow. A dead relay must say why — polling a pipe that will
  // never appear, in silence, is the worst possible failure here.
  static spawnDaemon(wsUrl, pipe) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const child = spawn(process.execPath, [path.join(here, 'daemon.mjs'), wsUrl], {
      detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.unref();

    return new Promise((ok, bad) => {
      let dead = false;
      child.on('exit', code => { if (code !== 0) dead = true; });
      // The stderr pipe holds the parent's event loop open. unref() covers the
      // child handle, not this stream, so drop it once we have an answer.
      const settle = fn => v => { child.stderr.destroy(); fn(v); };
      ok = settle(ok); bad = settle(bad);
      const deadline = Date.now() + 60_000;
      (async function poll() {
        if (await probe(pipe)) return ok();
        if (dead) {
          const why = stderr.trim().split('\n').pop() || `exited without a message`;
          return bad(new Error(`relay failed to start: ${why}`));
        }
        if (Date.now() > deadline) {
          return bad(new Error(
            'relay did not start within 60s.\n' +
            '  The browser asks you to approve each new debugging connection.\n' +
            '  If no prompt appeared, the endpoint may be stale — reopen\n' +
            '  chrome://inspect#remote-debugging and read the current port.'
          ));
        }
        setTimeout(poll, 250);
      })();
    });
  }

  #write(obj) { this.sock.write(JSON.stringify(obj) + '\n'); }

  send(method, params = {}, session) {
    const id = ++this.id;
    this.#write(this.envelope(method, params, id, session ?? this.sessionId));
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad }));
  }

  // No id: the daemon relays without tracking a reply. See CDP.fire.
  fire(method, params = {}) {
    this.#write(this.envelope(method, params, null));
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

// Without OS focus Chrome refuses DOM focus to clicked fields, so keystrokes
// go nowhere. Emulate focus rather than raising the window, which would steal
// focus from whatever the user is doing.
//
// A backgrounded tab can accept this command and never acknowledge it. The
// promise then neither resolves nor rejects, so .catch() cannot rescue it and
// the caller hangs forever. The call is best-effort, so bound it and continue.
async function enableFocusEmulation(cdp) {
  await Promise.race([
    cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {}),
    new Promise(r => setTimeout(r, 2000)),
  ]);
}

// null means the endpoint serves no /json/list, not that there are no tabs.
// A port that accepts TCP but never answers would hang an unbounded fetch.
async function listTargets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
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

const INTERNAL = /^(chrome|edge|devtools|about|brave|vivaldi):/;

// Chrome's Memory Saver freezes tabs the user has not touched. A frozen tab
// accepts page-session commands and never answers them, so anything awaiting a
// reply hangs forever. A tab that is merely hidden answers normally, so the
// probe has to distinguish the two rather than assume background means broken.
async function tabState(cdp, sessionId) {
  try {
    const { result } = await Promise.race([
      cdp.send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, sessionId),
      new Promise((_, bad) => setTimeout(() => bad(new Error('frozen')), 2500)),
    ]);
    return result.value;            // 'visible' | 'hidden'
  } catch {
    return 'frozen';
  }
}

// Only Target.activateTarget thaws a frozen tab. Page.setWebLifecycleState
// returns without thawing it and Emulation.setFocusEmulationEnabled hangs.
// Activating steals the user's foreground, so put it back straight after: a
// woken tab keeps answering once it is hidden again.
async function choosePage(cdp, targets, { tab, activate }) {
  const pages = targets.filter(t => t.type === 'page');
  if (!pages.length) throw new Error('no page target found. Open a tab first.');

  const wanted = tab
    ? pages.filter(p => `${p.title} ${p.url}`.toLowerCase().includes(tab.toLowerCase()))
    : pages.filter(p => !INTERNAL.test(p.url));
  if (tab && !wanted.length) {
    throw new Error(
      `no tab matches "${tab}". Open tabs:\n` +
      pages.map(p => `  ${(p.title || '(untitled)').slice(0, 48)}  ${p.url.slice(0, 60)}`).join('\n')
    );
  }
  const candidates = wanted.length ? wanted : pages;

  // Probed together: frozen tabs all time out concurrently instead of adding
  // 2.5s each. Knowing which tab is visible is also what makes focus
  // restoration possible later.
  const probed = await Promise.all(pages.map(async p => {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: p.targetId, flatten: true });
    return { ...p, sessionId, state: await tabState(cdp, sessionId) };
  }));
  const byId = new Map(probed.map(p => [p.targetId, p]));
  const wantedProbed = candidates.map(c => byId.get(c.targetId));
  const visibleNow = probed.find(p => p.state === 'visible');

  const live = wantedProbed.find(p => p.state === 'visible')
    || wantedProbed.find(p => p.state === 'hidden');
  if (live) return live;

  const target = wantedProbed[0];
  const name = (target.title || target.url).slice(0, 48);
  if (!activate) {
    throw new Error(
      `"${name}" is frozen by the browser's memory saver.\n` +
      `  Waking it means bringing it to the front for a moment.\n` +
      `  Drop --no-activate to allow that, or switch to the tab yourself.`
    );
  }

  await cdp.send('Target.activateTarget', { targetId: target.targetId });
  const woken = await tabState(cdp, target.sessionId);
  if (visibleNow && visibleNow.targetId !== target.targetId) {
    await cdp.send('Target.activateTarget', { targetId: visibleNow.targetId });
  }
  if (woken === 'frozen') throw new Error(`"${name}" stayed frozen after being activated.`);
  return target;
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
