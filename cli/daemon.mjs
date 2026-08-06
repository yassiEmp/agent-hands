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
  approveWhilePending(approved.signal, msg => console.error(`daemon: ${msg}`));
  try {
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => bad(new Error('browser refused the socket')), { once: true });
    });
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
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.__ping) { sock.write(JSON.stringify({ __pong: true, wsUrl }) + '\n'); continue; }
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
