// Change a type or fill that is already running.
//
// A long text typed at human speed can hold an agent for minutes, and the
// agent had no way to act on a command it had already started. Each typing
// process registers itself here; `agent-hands hurry` leaves it an order, and
// the typist reads that order every few characters.

import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './tab.mjs';

const typingFile = pid => path.join(STATE_DIR, `typing-${pid}.json`);
const orderFile = pid => path.join(STATE_DIR, `hurry-${pid}.json`);
const CHECK_EVERY = 8;

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Called by the typing process. Returns the hooks typeText polls.
export function register(key, total) {
  const pid = process.pid;
  const write = n => {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(typingFile(pid), JSON.stringify({ pid, key, total, done: n, at: Date.now() }));
    } catch { /* a typist nobody can hurry still types */ }
  };
  write(0);
  let i = 0;
  return {
    // null, or { speed } or { paste: true }. Read from disk every CHECK_EVERY chars.
    order(n) {
      if (++i % CHECK_EVERY) return null;
      write(n);
      try {
        const o = JSON.parse(fs.readFileSync(orderFile(pid), 'utf8'));
        fs.unlinkSync(orderFile(pid));
        return o;
      } catch { return null; }
    },
    end() {
      for (const f of [typingFile(pid), orderFile(pid)]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    },
  };
}

export function running(key = null) {
  let names = [];
  try { names = fs.readdirSync(STATE_DIR).filter(n => /^typing-\d+\.json$/.test(n)); } catch { return []; }
  const list = [];
  for (const n of names) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(STATE_DIR, n), 'utf8'));
      if (!alive(t.pid)) { fs.unlinkSync(path.join(STATE_DIR, n)); continue; }
      if (!key || t.key === key) list.push(t);
    } catch { /* half-written; the next check sees it */ }
  }
  return list;
}

export function order(pid, o) {
  fs.writeFileSync(orderFile(pid), JSON.stringify(o));
}
