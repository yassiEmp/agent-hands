// Size, screenshot or record a page over CDP, without touching the screen.
//
// A screen-region capture records whatever window is on top, which on a
// desktop with the user's own browser open is a privacy failure. This attaches
// to the throwaway browser as a second CDP client and saves what the page
// paints, nothing else. Used by record-hero.sh and docs/evidence.md.
//
//   node docs/assets/screencast.mjs size   <port> <width> <height>
//   node docs/assets/screencast.mjs shot   <port> <out.png>          (full page)
//   node docs/assets/screencast.mjs record <port> <outdir> <seconds>
//
// `record` writes numbered JPEG frames, frames.txt (ffmpeg concat format with
// per-frame durations, because the screencast only sends a frame when the
// page changes) and start.txt (epoch ms of the first frame, for captions).

import fs from 'node:fs';
import path from 'node:path';

const [mode, port, a, b = '20'] = process.argv.slice(2);
if (!mode || !port || !a) {
  console.error('usage: screencast.mjs size <port> <w> <h> | shot <port> <out.png> | record <port> <outdir> <seconds>');
  process.exit(2);
}

async function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = e => bad(new Error(String(e.message || e))); });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.bad(new Error(m.error.message)) : p.ok(m.result); }
    else if (m.method && listeners.has(m.method)) listeners.get(m.method)(m.params);
  };
  const send = (method, params = {}) => new Promise((ok, bad) => { pending.set(++id, { ok, bad }); ws.send(JSON.stringify({ id, method, params })); });
  return { send, on: (ev, fn) => listeners.set(ev, fn), close: () => ws.close() };
}

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(p => p.type === 'page' && !/^(devtools|chrome|edge):/.test(p.url));
if (!page) { console.error('no page target on that port'); process.exit(1); }

if (mode === 'size') {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const c = await client(webSocketDebuggerUrl);
  const { windowId } = await c.send('Browser.getWindowForTarget', { targetId: page.id });
  await c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await c.send('Browser.setWindowBounds', { windowId, bounds: { left: 40, top: 40, width: Number(a), height: Number(b) } });
  console.log(`window ${windowId} -> ${a}x${b}`);
  c.close();
} else if (mode === 'shot') {
  const c = await client(page.webSocketDebuggerUrl);
  const { contentSize, cssVisualViewport: v } = await c.send('Page.getLayoutMetrics');
  const clip = { x: 0, y: 0, width: Math.max(v.clientWidth, 1), height: Math.min(contentSize.height, 4000), scale: 1 };
  const { data } = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  fs.writeFileSync(a, Buffer.from(data, 'base64'));
  console.log(`saved ${a} ${clip.width}x${clip.height}`);
  c.close();
} else if (mode === 'record') {
  const out = a;
  fs.mkdirSync(out, { recursive: true });
  const frames = [];
  const c = await client(page.webSocketDebuggerUrl);
  c.on('Page.screencastFrame', async p => {
    if (!frames.length) fs.writeFileSync(path.join(out, 'start.txt'), String(Math.round(p.metadata.timestamp * 1000)));
    const file = path.join(out, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(p.data, 'base64'));
    frames.push({ file: path.basename(file), t: p.metadata.timestamp });
    await c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  await c.send('Page.enable');
  await c.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  console.log(`recording ${b}s from ${page.url}`);
  await new Promise(r => setTimeout(r, Number(b) * 1000));
  await c.send('Page.stopScreencast').catch(() => {});
  c.close();
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? Math.max(0.02, frames[i + 1].t - frames[i].t) : 2;
    lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(3)}`);
  }
  if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(out, 'frames.txt'), lines.join('\n') + '\n');
  console.log(`${frames.length} frames -> ${out}/frames.txt`);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
