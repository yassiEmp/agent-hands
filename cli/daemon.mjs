// One browser websocket, many CLI invocations.
//
// Chrome and Edge M144+ prompt the user to authorize every new CDP connection.
// Persisting that approval is an open upstream request, not a feature. So the
// only way to ask once is to never open a second connection: this daemon holds
// the single browser socket and relays messages for short-lived CLI processes
// over a local pipe.
//
// It is a pure relay. Clients still run Target.getTargets and
// Target.attachToTarget themselves, so per-client flat sessions and all
// existing semantics are unchanged.

import net from 'node:net';
import crypto from 'node:crypto';

import { approveWhilePending } from './approve.mjs';
import { record } from './audit.mjs';

export function pipeName(wsUrl) {
  const h = crypto.createHash('sha1').update(wsUrl).digest('hex').slice(0, 12);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\agent-hands-${h}`
    : `/tmp/agent-hands-${h}.sock`;
}

// Resolves if a daemon is already listening.
export function probe(pipe, timeoutMs = 400) {
  return new Promise(resolve => {
    const s = net.connect(pipe);
    const done = ok => { s.removeAllListeners(); s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

async function main() {
  const [wsUrl] = process.argv.slice(2);
  if (!wsUrl) { console.error('usage: daemon.mjs <ws-url>'); process.exit(2); }
  const pipe = pipeName(wsUrl);

  if (await probe(pipe)) process.exit(0);   // someone won the race

  // The one and only authorization prompt happens here. The browser draws it in its own window
  // chrome, so CDP cannot dismiss it and this upgrade just hangs until somebody clicks. agent-win
  // clicks it for us while the handshake is pending; without agent-win, a human clicks instead.
  const ws = new WebSocket(wsUrl);
  const approved = new AbortController();
  record(wsUrl, { ev: 'approve-begin', pid: process.pid, auto: !process.env.AGENT_HANDS_NO_APPROVE });
  approveWhilePending(approved.signal, msg => {
    console.error(`daemon: ${msg}`);
    // The moment a machine clicked a security prompt on the user's behalf.
    record(wsUrl, { ev: 'approve-clicked', msg });
  });
  try {
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => bad(new Error('browser refused the socket')), { once: true });
    });
    record(wsUrl, { ev: 'open', pid: process.pid });
  } catch (e) {
    record(wsUrl, { ev: 'refused', err: String(e.message || e) });
    throw e;
  } finally {
    approved.abort();
  }

  // Client ids are rewritten so two concurrent CLIs cannot collide.
  let seq = 0;
  const route = new Map();            // upstreamId -> { sock, clientId }
  const clients = new Set();

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null && route.has(msg.id)) {
      const { sock, clientId } = route.get(msg.id);
      route.delete(msg.id);
      msg.id = clientId;
      if (!sock.destroyed) sock.write(JSON.stringify(msg) + '\n');
      return;
    }
    // Unsolicited event. Broadcast.
    for (const sock of clients) if (!sock.destroyed) sock.write(ev.data + '\n');
  });

  ws.addEventListener('close', () => process.exit(0));

  const server = net.createServer(sock => {
    clients.add(sock);
    // A Buffer concatenated onto a string decodes per chunk, so any multi-byte
    // character split across a chunk boundary becomes replacement characters.
    // Harmless while messages are small; a snapshot of a French page ("Autoriser")
    // crosses boundaries constantly, and the corrupted line throws below.
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        // One malformed line must not kill the relay: this handler has no
        // caller to catch it, and every concurrent CLI would hang.
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.__ping) { sock.write(JSON.stringify({ __pong: true, wsUrl }) + '\n'); continue; }
        if (msg.__hello) { sock.__said = true; record(wsUrl, { ev: 'client', ...msg.__hello }); continue; }
        // A client that drives the browser without introducing itself is worth
        // one line: silence is the only signal a bypass leaves behind.
        if (!sock.__said) { sock.__said = true; record(wsUrl, { ev: 'no-hello' }); }
        const clientId = msg.id;
        const upstreamId = ++seq;
        msg.id = upstreamId;
        // No id means fire-and-forget: relay without tracking a reply.
        if (clientId != null) route.set(upstreamId, { sock, clientId });
        ws.send(JSON.stringify(msg));
      }
    });
    const drop = () => { clients.delete(sock); };
    sock.on('close', drop);
    sock.on('error', drop);
  });

  server.on('error', () => process.exit(0));
  server.listen(pipe, () => {
    if (process.send) process.send('ready');
    console.error(`agent-hands daemon listening on ${pipe}`);
  });

  // Do not outlive the browser or linger forever unused.
  const idleExit = () => { if (!clients.size) { server.close(); ws.close(); process.exit(0); } };
  setInterval(idleExit, 30 * 60 * 1000).unref?.();
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
    || process.argv[1]?.endsWith('daemon.mjs')) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
