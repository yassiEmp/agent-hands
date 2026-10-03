// Answer the browser's "Allow remote debugging?" modal so connecting needs no human.
//
// Chrome and Edge 144+ let a user enable remote debugging from chrome://inspect. That endpoint
// then gates EVERY new CDP connection behind a native modal drawn in the browser's own window
// chrome. CDP cannot see it and cannot dismiss it, so the websocket upgrade just hangs — no error,
// no 403 — until somebody clicks. Clients with a short handshake timeout give up first.
//
// The modal is a normal UI Automation control. approve.ps1 invokes it through the UI Automation
// client that ships with Windows, so this needs no install. It used to go through agent-win, whose
// search walks the whole browser window to reach the dialog. On a heavy profile (Edge 154, ten
// tabs) that walk hit its 8s budget before the Allow button, and approval silently stopped.
// approve.ps1 finds the dialog by its own window handle instead, in under a second.
//
// Everything is best-effort: if the approver cannot run, the connect still works, it just waits
// for a human.
//
// LOCALE. The dialog is fully translated, so matching "Allow" only works on an English browser.
// Narrowing is therefore structural first: ClassName is set by Chromium and never translated, so
// MdTextButton finds the dialog's buttons in any language. Only then is the affirmative chosen
// by name.
//
// WHY NOT PICK BY POSITION. The real dialog has THREE buttons — "Disable in settings", "Allow",
// "Cancel" — and Allow is neither first nor last. Guessing by order would disable the user's
// debugging or deny the connection. So an unknown language refuses to click and prints what it
// saw, which is recoverable; a wrong click is not.
//
// LIMITATION. The modal names no requester, so this approves ANY pending debugging prompt. Do not
// run it while a connection you did not start is waiting.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// "Allow" as Chromium ships it. Compared case-insensitively, accents intact.
// An unlisted language is not a failure: it prints the buttons it found so this list can grow.
const ALLOW = [
  'allow', 'autoriser', 'permitir', 'consenti', 'consentire', 'zulassen', 'erlauben',
  'toestaan', 'tillåt', 'tillad', 'tillat', 'salli', 'zezwól', 'zezwalaj', 'povolit',
  'povoliť', 'engedélyezés', 'engedélyez', 'permite', 'permiteți', 'dopusti', 'dozvoli',
  'разрешить', 'дозволити', 'позволи', 'izin ver', 'ver', 'izinkan', 'benarkan',
  'cho phép', 'อนุญาต', '허용', '許可', '允许', '允許', 'επιτρέπεται', 'να επιτρέπεται',
  'לאפשר', 'אפשר', 'السماح', 'اسمح', 'اجازه', 'अनुमति दें', 'अनुमति',
];

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'approve.ps1');

const CACHE = path.join(os.homedir(), '.agent-browser', 'humanize');

// -EncodedCommand runs the script under any execution policy, where -File is refused on
// machines set to Restricted. The DLL name carries a hash of the script, so an edit to the
// helper never loads a stale build.
function prepare() {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  try { fs.mkdirSync(CACHE, { recursive: true }); } catch { /* the script compiles in memory */ }
  return {
    command: Buffer.from(source, 'utf16le').toString('base64'),
    dll: path.join(CACHE, `approve-${hash}.dll`),
  };
}

function report(line, log, seen) {
  let e;
  try { e = JSON.parse(line); } catch { return; }
  if (e.ev === 'clicked') {
    log?.(`approving the browser prompt (${e.process} "${e.name}")`);
    return;
  }
  if (e.ev !== 'unmatched') return;
  const names = [...new Set(e.names || [])].filter(Boolean).join(' | ');
  if (!names || seen.has(names)) return;
  seen.add(names);
  log?.(`a browser prompt is open but no button matched a known "Allow": ${names}. ` +
        `Click it once by hand, or add the word to ALLOW in cli/approve.mjs.`);
}

// Watch for the modal until `signal` aborts — that is, until the socket opens or the caller gives
// up. Returns nothing: the socket is the real result, this is a side effect on the desktop.
export function approveWhilePending(signal, log) {
  if (process.env.AGENT_HANDS_NO_APPROVE || process.platform !== 'win32') return;
  if (signal?.aborted) return;
  let child;
  try {
    const { command, dll } = prepare();
    child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
        env: {
          ...process.env,
          AGENT_HANDS_DLL: dll,
          AGENT_HANDS_ALLOW: ALLOW.join('\n'),
          AGENT_HANDS_PARENT_PID: String(process.pid),
        },
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
  } catch {
    log?.('could not start the approver, so the browser prompt cannot be clicked for you. ' +
          'Click "Allow" in the browser now.');
    return;
  }
  const seen = new Set();
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      report(buf.slice(0, nl).trim(), log, seen);
      buf = buf.slice(nl + 1);
    }
  });
  // Silence here is the worst outcome: the connect hangs and nothing says why.
  child.on('error', () => log?.('could not start the approver (powershell.exe). ' +
                                'Click "Allow" in the browser now.'));
  // Kill only. The click that opened the socket was written just before, and the pipe still holds
  // it: destroying stdout here would drop the line the audit log needs.
  signal?.addEventListener?.('abort', () => child.kill(), { once: true });
}
