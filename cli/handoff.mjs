// Hand a sign-in to the human, then take the tab back.
//
// An agent with no credentials used to open a background tab, ask the user to
// find it, and sit idle until the user typed "I'm in" in chat (4 Oct 2026,
// Inworld API key). Two round trips through the user for one fact the page can
// report itself. This puts the tab in front of the user and polls until the
// page stops looking like a sign-in surface, so the agent resumes on its own.
//
// Reads only. No input event is sent while the human types, so nothing here
// can collide with their keystrokes or show up in the site's timing.

import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './motion.mjs';
import { urlLooksLikeLogin } from './guard.mjs';
import { holds, conditionFrom } from './wait.mjs';
import { CDP, DaemonCDP } from './cdp.mjs';
import { STATE_DIR, recall as recallTab, remember as rememberTab } from './tab.mjs';
import { BOX, clickAt } from './gestures.mjs';
import { summon } from './summon.mjs';

export const DEFAULT_HANDOFF_S = 600;
// --wait returns inside a 10 min agent shell limit, with margin. Call it again to keep waiting.
export const DEFAULT_WAIT_S = 540;
const POLL_MS = 700;
// Redirect chains pass through pages that look signed in for a moment, e.g.
// an OAuth callback that renders before it bounces. Require the state to hold.
const STABLE_POLLS = 3;
// A closed tab answers nothing. Give a navigation time to finish first.
const DEAD_POLLS = 15;

// A dashboard rarely offers "Sign in". A sign-in page without a password field
// (email first, magic link, SSO buttons) always offers one of these.
const PROBE = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const pw = [...document.querySelectorAll('input[type=password]')].some(vis);
  const rx = /^\\s*(sign\\s*in|log\\s*in|login|continue with|sign\\s*up|se connecter|connexion|anmelden)\\b/i;
  const cta = [...document.querySelectorAll('button, a, [role=button], input[type=submit]')]
    .some(el => vis(el) && rx.test(el.innerText || el.value || el.getAttribute('aria-label') || ''));
  const text = (document.body?.innerText || '').trim().length;
  return JSON.stringify({ url: location.href, title: document.title, ready: document.readyState, pw, cta, text });
})()`;

export async function readSignin(cdp) {
  try {
    const raw = await cdp.evaluate(PROBE);
    return typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return null;                       // mid-navigation, or the tab is gone
  }
}

// A blank new tab and an SPA shell that has not mounted its form yet both show
// no sign-in controls. Neither is a signed-in page, so both must have content.
export function looksSignedIn(s) {
  if (!s || (s.ready !== 'complete' && s.ready !== 'interactive')) return false;
  if (/^(about:|chrome-error:|edge-error:|data:)/.test(s.url) || s.text < 40) return false;
  return !s.pw && !s.cta && !urlLooksLikeLogin(s.url);
}

// c: an explicit wait condition (--url / --text) that replaces the heuristic.
export async function waitForHuman(cdp, { condition = null, timeoutMs, onTick = () => {} }) {
  const start = Date.now();
  let stable = 0, dead = 0, polls = 0, last = null;
  while (Date.now() - start < timeoutMs) {
    polls++;
    const s = await readSignin(cdp);
    if (s) { dead = 0; last = s; } else if (++dead >= DEAD_POLLS) {
      throw Object.assign(new Error(
        'the sign-in tab stopped answering. It was closed, or the browser quit.\n' +
        `  last page: ${last?.url ?? '(none)'}`), { code: 'EHANDOFF' });
    }
    const ok = condition
      ? await holds(cdp, condition).catch(() => false)
      : looksSignedIn(s);
    stable = ok ? stable + 1 : 0;
    if (stable >= STABLE_POLLS) {
      return { ok: true, waitedMs: Date.now() - start, already: polls === STABLE_POLLS,
               url: last?.url, title: last?.title };
    }
    onTick(Date.now() - start);
    await sleep(POLL_MS);
  }
  return { ok: false, waitedMs: Date.now() - start, url: last?.url, title: last?.title };
}

// ------------------------------------------------------------ detached ----
//
// On a browser reached through the relay, the sign-in tab carries no session
// while the human types. Measured 4 Oct 2026 on Edge 153 and Chrome through
// the inspect toggle: navigator.webdriver stays false with the socket open,
// with a session attached, and after it detaches. So the webdriver mask only
// adds a trace there (its getter is not native), and an attached session is
// the one thing left for the page to notice. The tab list gives url and title
// without touching the page. The page itself is read only to confirm.

// Re-read an unchanged page this often. An SPA can swap the form for the
// dashboard without changing url or title.
const RECHECK_MS = 10000;
const blank = u => /^(about:|chrome-error:|edge-error:|data:)/.test(u || '');

function urlHolds(c, href) {
  try {
    const u = new URL(href);
    return c.url.startsWith('/') ? u.pathname.startsWith(c.url) : href.includes(c.url);
  } catch { return false; }
}

async function tabInfo(cdp, targetId) {
  const { targetInfos } = await cdp.send('Target.getTargets', {}, null);
  return targetInfos.find(t => t.targetId === targetId) ?? null;
}

// Attach, read once, detach. The session lives for one probe.
async function confirm(cdp, targetId, condition) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
  cdp.sessionId = sessionId;
  try {
    const s = await readSignin(cdp);
    const ok = condition ? await holds(cdp, condition).catch(() => false) : looksSignedIn(s);
    return { ok, s };
  } finally {
    cdp.sessionId = null;
    await cdp.send('Target.detachFromTarget', { sessionId }, null).catch(() => {});
  }
}

// Which tab the human signs in on, with no session left on it.
export async function prepareDetached(cdp, { url, here }) {
  let targetId = cdp.targetId;
  if (url && !here) {
    ({ targetId } = await cdp.send('Target.createTarget', { url }, null));
  } else {
    if (url) await cdp.send('Page.navigate', { url });
    if (cdp.sessionId) await cdp.send('Target.detachFromTarget', { sessionId: cdp.sessionId }, null).catch(() => {});
    cdp.sessionId = null;
  }
  if (!targetId) throw Object.assign(new Error('handoff found no tab to hand over.'), { code: 'EHANDOFF' });
  await cdp.send('Target.activateTarget', { targetId }, null).catch(() => {});
  cdp.targetId = targetId;
  cdp.restoreTo = null;   // drain must not take the foreground back from the human
  return targetId;
}

export async function waitDetached(cdp, targetId, { condition = null, timeoutMs, onTick = () => {} }) {
  const start = Date.now();
  let key = null, same = 0, missing = 0, checked = null, checkedAt = 0, last = null;
  while (Date.now() - start < timeoutMs) {
    const t = await tabInfo(cdp, targetId);
    if (!t) {
      // The human closing the tab is their answer: they will not sign in now.
      if (++missing >= 3) {
        throw Object.assign(new Error(
          'the user closed the sign-in tab. Ask them before handing off again.\n' +
          `  last page: ${last?.url ?? '(none)'}`), { code: 'ECANCEL' });
      }
    } else {
      missing = 0; last = t;
      const k = `${t.url}|${t.title}`;
      same = k === key ? same + 1 : 0; key = k;
      const candidate = same >= STABLE_POLLS - 1 && !blank(t.url) && (
        condition?.kind === 'url' ? urlHolds(condition, t.url) : !urlLooksLikeLogin(t.url));
      const due = k !== checked || Date.now() - checkedAt > RECHECK_MS;
      if (candidate && due) {
        const r = await confirm(cdp, targetId, condition).catch(() => ({ ok: false }));
        checked = k; checkedAt = Date.now();
        if (r.ok) {
          return { ok: true, waitedMs: Date.now() - start, already: Date.now() - start < 4000,
                   url: r.s?.url ?? t.url, title: r.s?.title ?? t.title };
        }
      }
    }
    onTick(Date.now() - start);
    await sleep(POLL_MS);
  }
  return { ok: false, waitedMs: Date.now() - start, url: last?.url, title: last?.title };
}

// ------------------------------------------------------------- launched ----
//
// A browser started by `launch` is reached with one socket per page, and that
// socket is an attached client on the tab. The same port also serves a
// browser-level socket with no prompt. Waiting through it leaves the sign-in
// tab with nothing attached, as on the relay route.
async function browserSocket(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  const { webSocketDebuggerUrl } = await r.json();
  return CDP.open(webSocketDebuggerUrl);
}

// The socket handoff watches through. The relay socket already is one. For a
// launched browser the page socket closes here, after any --here navigation.
export async function handoffSocket(cdp, url, { flags }) {
  if (cdp instanceof DaemonCDP) return cdp;
  if (url && flags.here) await cdp.send('Page.navigate', { url });
  const watcher = await browserSocket(cdp.port);
  Object.assign(watcher, { key: cdp.key, targetId: cdp.targetId, url: cdp.url, external: cdp.external });
  cdp.close();
  return watcher;
}

// -------------------------------------------------------------- passkey ----
//
// The agent clicks the passkey button; the human only confirms with Windows
// Hello, a security key or a phone. A CDP click is a user gesture, which
// WebAuthn requires. The WebAuthn CDP domain is never touched: it swaps the
// user's real authenticators for virtual ones, and a page can tell.
const PASSKEY_RX = 'passkey|pass key|clé d.accès|cle d.acces|security key|clé de sécurité|windows hello|hauptschlüssel|clave de acceso';

// label: the button text on a site the default list misses, matched as a substring.
const FIND_PASSKEY = label => `(() => {
  const want = ${JSON.stringify(label ? label.toLowerCase() : null)};
  const rx = new RegExp(${JSON.stringify(PASSKEY_RX)}, 'i');
  const hit = s => want ? s.toLowerCase().includes(want) : rx.test(s);
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('button, a, [role=button], [role=link], input[type=submit]')]
    .find(el => vis(el) && hit(el.innerText || el.value || el.getAttribute('aria-label') || '')) || null;
})()`;

// Attach, click, detach. Returns the button text, or null when none is shown.
export async function clickPasskey(cdp, targetId, { label = null, speed = 1 } = {}) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
  cdp.sessionId = sessionId;
  try {
    for (let i = 0; i < 20; i++) {          // the sign-in form may still be mounting
      const box = await cdp.evaluate(`${BOX}(${FIND_PASSKEY(label)})`).catch(() => null);
      if (box) {
        const name = await cdp.evaluate(`(${FIND_PASSKEY(label)})?.innerText?.trim().slice(0, 60) ?? ''`).catch(() => '');
        await clickAt(cdp, cdp.key, box, box.w, speed);
        await cdp.evaluate('0').catch(() => {});      // flush the release before detaching
        return name || 'passkey';
      }
      await sleep(500);
    }
    return null;
  } finally {
    cdp.sessionId = null;
    await cdp.send('Target.detachFromTarget', { sessionId }, null).catch(() => {});
  }
}

// -------------------------------------------------------------- pending ----
//
// `handoff --start` returns at once so the agent's shell never sits on a
// 10 minute wait. The tab to watch is written here, and `handoff --wait`
// picks it up, as many times as it takes.
const pendingFile = key => path.join(STATE_DIR, `${key}.handoff.json`);

export function savePending(key, p) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(pendingFile(key), JSON.stringify({ ...p, at: Date.now() }));
}

export function loadPending(key) {
  try { return JSON.parse(fs.readFileSync(pendingFile(key), 'utf8')); } catch { return null; }
}

export function clearPending(key) {
  try { fs.unlinkSync(pendingFile(key)); } catch { /* nothing pending */ }
}

// ---------------------------------------------------------------- verb ----

const hostOf = u => { try { return new URL(u).host; } catch { return 'the site'; } };
const short = t => (t || '').slice(0, 60);

// The whole verb: prepare the tab, call the human, optionally press the
// passkey button, then wait (or return at once with --start).
export async function runHandoff(cdp, url, args) {
  const f = args.flags;
  const say = m => { if (!args.quiet) console.error(m); };

  let pending = null;
  if (f.wait) {
    pending = loadPending(cdp.key);
    if (!pending) {
      throw Object.assign(new Error('no handoff is pending for this browser.\n' +
        '  Start one: agent-hands handoff <url> --start'), { code: 'EUSAGE' });
    }
  } else {
    const before = recallTab(cdp.key);
    // A launched browser already navigated for --here in handoffSocket.
    const nav = f.here && !(cdp instanceof DaemonCDP) ? undefined : url;
    const targetId = await prepareDetached(cdp, { url: nav, here: f.here });
    rememberTab(cdp.key, { targetId, title: '', url: url ?? cdp.url });
    pending = {
      targetId,
      site: hostOf(url ?? cdp.url),
      condition: f.url || f.text ? conditionFrom(args, []) : null,
      previousTab: before && before.targetId !== targetId
        ? { targetId: before.targetId, title: before.title, url: before.url } : null,
    };

    // The raise must land before a passkey click: Windows Hello draws its
    // prompt over the focused window, and a background one leaves it hidden.
    const called = summon(cdp, { message: `Sign in to ${pending.site}. The agent continues when you are in.` });
    if (f.passkey) {
      pending.summon = await called;
      pending.passkey = await clickPasskey(cdp, targetId, { label: f.passkeyLabel, speed: args.speed });
      say(pending.passkey
        ? `  pressed "${pending.passkey}". The user confirms with Windows Hello, a key or a phone.`
        : '  no passkey button on the page. The user picks the sign-in method.');
    }
    if (f.start) {
      pending.summon ??= await called;
      savePending(cdp.key, pending);
      return {
        data: { state: 'waiting', site: pending.site, passkey: pending.passkey ?? null,
                summon: pending.summon, previousTab: pending.previousTab },
        human: `… waiting for the user to sign in to ${pending.site}.\n` +
          '  Tell them: "Sign in in the window I brought up. I continue by myself when you are in."\n' +
          '  Then: agent-hands handoff --wait',
      };
    }
    pending.called = called;
  }

  const timeoutS = f.timeout ?? (f.wait ? DEFAULT_WAIT_S : DEFAULT_HANDOFF_S);
  const onTick = ms => { if (ms >= 60000 && ms % 60000 < 700) say(`  still waiting (${Math.round(ms / 60000)} min)`); };
  say(`  waiting up to ${timeoutS}s for the user to sign in to ${pending.site} (nothing attached)…`);

  let r;
  try {
    r = await waitDetached(cdp, pending.targetId, { condition: pending.condition, timeoutMs: timeoutS * 1000, onTick });
  } catch (e) {
    if (e.code === 'ECANCEL') clearPending(cdp.key);
    throw e;
  } finally {
    // The summon child holds the event loop until it exits; never leave it behind.
    if (pending.called) pending.summon = await pending.called;
  }

  if (!r.ok) {
    const { called, ...keep } = pending;
    savePending(cdp.key, keep);
    throw Object.assign(new Error(
      `no sign-in after ${timeoutS}s.\n  page now: "${short(r.title)}" ${r.url}\n` +
      '  The tab is still waiting. Keep waiting: agent-hands handoff --wait'), { code: 'EWAIT' });
  }
  clearPending(cdp.key);
  const state = r.already ? 'already-signed-in' : 'signed-in';
  const back = pending.previousTab;
  return {
    data: { state, url: r.url, title: r.title, waitedMs: r.waitedMs, previousTab: back,
            summon: pending.summon ?? null },
    human: `✓ ${state} — "${short(r.title)}" ${r.url}  (${(r.waitedMs / 1000).toFixed(0)}s)` +
      (back ? `\n  commands now go to this tab. Your earlier tab: --tab "${short(back.title || back.url)}"` : ''),
  };
}
