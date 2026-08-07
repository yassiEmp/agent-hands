// Answer the browser's "Allow remote debugging?" modal so connecting needs no human.
//
// Chrome and Edge 144+ let a user enable remote debugging from chrome://inspect. That endpoint
// then gates EVERY new CDP connection behind a native modal drawn in the browser's own window
// chrome. CDP cannot see it and cannot dismiss it, so the websocket upgrade just hangs — no error,
// no 403 — until somebody clicks. Clients with a short handshake timeout give up first.
//
// The modal is a normal UI Automation control, so agent-win can invoke it. Authorising that
// connection is agent-win's ONLY job here. Page, tab and DOM work belongs to this tool.
//
// Everything is best-effort: without agent-win the connect still works, it just waits for a human.
//
// LOCALE. The dialog is fully translated, so matching "Allow" only works on an English browser.
// Narrowing is therefore structural first: ClassName is set by Chromium and never translated, so
// `--class MdTextButton` finds the dialog's buttons in any language (it cut ~200 buttons to 7 on
// a French Edge). Only then is the affirmative chosen by name.
//
// WHY NOT PICK BY POSITION. The real dialog has THREE buttons — "Disable in settings", "Allow",
// "Cancel" — and Allow is neither first nor last. Guessing by order would disable the user's
// debugging or deny the connection. So an unknown language refuses to click and prints what it
// saw, which is recoverable; a wrong click is not.
//
// LIMITATION. The modal names no requester, so this approves ANY pending debugging prompt. Do not
// run it while a connection you did not start is waiting.

import { spawn } from 'node:child_process';

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

const DIALOG_BUTTON_CLASS = 'MdTextButton';   // Chromium's dialog button, same in every locale
const BROWSERS = ['msedge.exe', 'chrome.exe', 'brave.exe', 'vivaldi.exe', 'chromium.exe'];
const POLL_MS = 400;

// How to invoke agent-win, in order of what a real install looks like:
//   1. $AGENT_WIN  — an explicit command
//   2. `agent-win` on PATH (pip install, or the repo's shim)
//   3. `python -m agent_win` (pip install), optionally with $AGENT_WIN_HOME for a git checkout
// Resolved once, then cached, so a missing tool costs one probe rather than one per poll.
let RESOLVED;

function candidates() {
  const python = process.env.AGENT_WIN_PYTHON || 'python';
  const list = [];
  if (process.env.AGENT_WIN) list.push({ cmd: process.env.AGENT_WIN, pre: [] });
  // No shell. Node warns that shell:true concatenates rather than escapes arguments, and these
  // arguments contain user-visible button text. `pip install agent-win` puts a real executable on
  // PATH, and `python -m agent_win` covers both a pip install and a checkout via AGENT_WIN_HOME.
  list.push({ cmd: 'agent-win', pre: [] });
  list.push({ cmd: python, pre: ['-m', 'agent_win'] });
  return list;
}

function spawnOnce({ cmd, pre }, args) {
  return new Promise(resolve => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], {
        env: {
          ...process.env,
          PYTHONPATH: process.env.AGENT_WIN_HOME || process.env.PYTHONPATH || '',
          PYTHONIOENCODING: 'utf-8',            // button names are not ascii
        },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return resolve(null);
    }
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', code => resolve(code === 0 ? out : null));
  });
}

async function agentWin(args) {
  if (RESOLVED === null) return null;                 // known absent
  if (RESOLVED) return spawnOnce(RESOLVED, args);
  for (const c of candidates()) {
    const probe = await spawnOnce(c, ['help']);
    if (probe !== null) {
      RESOLVED = c;
      return spawnOnce(c, args);
    }
  }
  RESOLVED = null;
  return null;
}

export function agentWinMissing() {
  return RESOLVED === null;
}

function isAllow(name) {
  const n = (name || '').trim().toLowerCase().replace(/[.…!]+$/, '');
  return ALLOW.some(w => n === w || n.startsWith(`${w} `) || n.endsWith(` ${w}`));
}

async function clickPending(log, seen) {
  const out = await agentWin(['find', '', '--type', 'Button', '--class', DIALOG_BUTTON_CLASS, '--json']);
  if (!out) {
    // Silence here is the worst outcome: the connect hangs and nothing says why.
    if (agentWinMissing() && !seen.has('#missing')) {
      seen.add('#missing');
      log?.('agent-win not found, so the browser prompt cannot be clicked for you. ' +
            'Click "Allow" in the browser now. To automate it: pip install agent-win, ' +
            'or set AGENT_WIN_HOME to a checkout.');
    }
    return false;
  }
  let matches;
  try {
    matches = JSON.parse(out).matches || [];
  } catch {
    return false;
  }
  const inBrowser = matches.filter(m => BROWSERS.includes((m.process || '').toLowerCase()));
  if (!inBrowser.length) return false;

  const allow = inBrowser.filter(m => isAllow(m.name));
  if (!allow.length) {
    const names = [...new Set(inBrowser.map(m => m.name).filter(Boolean))].join(' | ');
    if (names && !seen.has(names)) {
      seen.add(names);
      log?.(`a browser prompt is open but no button matched a known "Allow": ${names}. ` +
            `Click it once by hand, or add the word to ALLOW in cli/approve.mjs.`);
    }
    return false;
  }
  // One button appears per pending attempt, so retries stack them. Clicking an old one approves a
  // connection that already timed out while the live socket keeps waiting. Click them all.
  for (const m of allow) {
    log?.(`approving the browser prompt (${m.ref} "${m.name}")`);
    await agentWin(['click', m.ref, '-q']);
  }
  return true;
}

// Poll for the modal until `signal` aborts — that is, until the socket opens or the caller gives
// up. Returns nothing: the socket is the real result, this is a side effect on the desktop.
export function approveWhilePending(signal, log) {
  if (process.env.AGENT_HANDS_NO_APPROVE) return;
  let stopped = false;
  const seen = new Set();
  signal?.addEventListener?.('abort', () => { stopped = true; }, { once: true });
  (async () => {
    while (!stopped) {
      try {
        await clickPending(log, seen);
      } catch {
        // a failed probe must never break the connect it is trying to help
      }
      if (stopped) return;
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  })();
}
