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

import { sleep } from './motion.mjs';
import { urlLooksLikeLogin } from './guard.mjs';
import { holds } from './wait.mjs';

export const DEFAULT_HANDOFF_S = 600;
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
