// Who asked the daemon to touch a browser holding the user's live session.
//
// The daemon is the only thing in this codebase that can authorise a browser,
// so it is the only place worth recording. The value of the log is not that it
// proves who connected — a client self-reports and could lie or stay silent.
// The value is the opposite: a browser that got authorised with NO matching
// line here was authorised by something that is not agent-hands.
//
// PRIVACY. A hello carries the verb and the flag NAMES only. Never argument
// values: `fill "#pw" "hunter2"` must not write a password into a plaintext
// log that lives forever.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const STATE = path.join(os.homedir(), '.agent-browser', 'humanize', 'audit');
const MAX_BYTES = 1024 * 1024;

// Same hash as pipeName(), so a pipe, a ref store and a log line correlate.
export function auditPath(wsUrl) {
  const h = crypto.createHash('sha1').update(wsUrl).digest('hex').slice(0, 12);
  return path.join(STATE, `${h}.jsonl`);
}

export function record(wsUrl, event) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    const file = auditPath(wsUrl);
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
    } catch { /* first write */ }
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n');
  } catch { /* auditing must never break a connection */ }
}

export function tail(wsUrl, n = 50) {
  try {
    return fs.readFileSync(auditPath(wsUrl), 'utf8')
      .split('\n').filter(Boolean).slice(-n)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Flag names without their values, for a hello line.
export function safeCommand(cmd, argv) {
  const flags = argv.filter(a => a.startsWith('--')).join(' ');
  return [cmd, flags].filter(Boolean).join(' ');
}
