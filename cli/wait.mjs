// Waiting on the page, so a batch can be written before the page is seen.
//
// Without this an agent has to snapshot after every step to learn whether
// the step landed, and each snapshot is a model turn. With it the agent names
// what it expects ("Saved" appears, the url changes, a button becomes
// clickable) and the batch pauses until that is true. Polling reads the page
// and emits no input event, so a site sees nothing. A human notices a change
// and then acts, so a wait that actually waited ends with a reaction pause.

import { sleep, lognormal } from './motion.mjs';
import { finderFor } from './gestures.mjs';

export const DEFAULT_TIMEOUT_S = 15;
const POLL_MS = 200;
const SETTLE_MS = 500;

// One condition per line. Returns null when the flags name none.
export function conditionFrom(args, rest) {
  const f = args.flags;
  if (f.settled) return { kind: 'settled' };
  if (f.url) return { kind: 'url', url: f.url };
  const target = { selector: rest[0], text: f.text, label: f.label };
  const hasTarget = target.selector || target.text || target.label;
  if (f.enabled) return hasTarget ? { kind: 'enabled', target } : null;
  if (!hasTarget) return null;
  return { kind: f.gone ? 'gone' : 'present', target };
}

export function describe(c) {
  const t = c.target ? (c.target.text ? `text "${c.target.text}"`
    : c.target.label ? `label "${c.target.label}"` : `"${c.target.selector}"`) : '';
  return { settled: 'the page to settle', url: `url to match "${c.url}"`,
           enabled: `${t} to be enabled`, gone: `${t} to be gone`, present: t }[c.kind];
}

const PRESENT = target => `(() => {
  const el = ${finderFor(target)};
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
})()`;

const ENABLED = target => `(() => {
  const el = ${finderFor(target)};
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !el.disabled
    && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]');
})()`;

// Text anywhere on the page counts, so a toast or a heading both satisfy it.
// finderFor scores clickables, which a toast is not.
const TEXT_PRESENT = t => `document.body.innerText.toLowerCase().includes(${JSON.stringify(t.toLowerCase())})`;

const FINGERPRINT = `document.body.innerHTML.length + ':' + document.body.innerText.length + ':' + location.href`;

async function check(cdp, c) {
  switch (c.kind) {
    // Two traps measured 9 Sep 2026 on a form that posts to /post from
    // /forms/post. A substring match on "/post" was true before the click
    // landed, and a url matches the instant navigation commits, before the
    // new document has a body. So a pattern that starts with "/" must match
    // the start of the path, and the document must be ready.
    case 'url': {
      const v = String(await cdp.evaluate('location.href + "|" + location.pathname + "|" + document.readyState'));
      const [href, pathname, state] = v.split('|');
      const hit = c.url.startsWith('/') ? pathname.startsWith(c.url) : href.includes(c.url);
      return hit && (state === 'complete' || state === 'interactive');
    }
    case 'present':
      return c.target.text && !c.target.selector && !c.target.label
        ? Boolean(await cdp.evaluate(TEXT_PRESENT(c.target.text)))
        : Boolean(await cdp.evaluate(PRESENT(c.target)));
    case 'gone':
      return c.target.text && !c.target.selector && !c.target.label
        ? !(await cdp.evaluate(TEXT_PRESENT(c.target.text)))
        : !(await cdp.evaluate(PRESENT(c.target)));
    case 'enabled': return Boolean(await cdp.evaluate(ENABLED(c.target)));
    case 'settled': {
      const a = await cdp.evaluate(FINGERPRINT);
      await sleep(SETTLE_MS);
      return a === await cdp.evaluate(FINGERPRINT);
    }
    default: return false;
  }
}

// Read the condition once. `if` and `expect` use this; `wait` loops on it.
export async function holds(cdp, c) {
  return check(cdp, c);
}

export async function waitFor(cdp, c, { timeoutMs = DEFAULT_TIMEOUT_S * 1000 } = {}) {
  const start = Date.now();
  let polls = 0;
  for (;;) {
    polls++;
    if (await check(cdp, c)) {
      const waited = Date.now() - start;
      // Reaction time: a human sees the change, then moves. A click in the
      // same millisecond the toast appeared is the tell this tool avoids.
      if (polls > 1) await sleep(lognormal(500, 0.35, 1400));
      return { ok: true, waitedMs: waited };
    }
    if (Date.now() - start > timeoutMs) return { ok: false, waitedMs: Date.now() - start };
    await sleep(POLL_MS);
  }
}

// What the page looks like when a wait or expect fails, in one short line.
export async function nowOn(cdp) {
  const s = await cdp.evaluate('document.title + "|" + location.href').catch(() => '|');
  const [title, url] = String(s).split('|');
  return { title, url };
}

export function failMessage(c, now, timeoutS) {
  const head = timeoutS == null ? `expected ${describe(c)}, and it is not so.` :
    `waited ${timeoutS}s for ${describe(c)}.`;
  return `${head}\n  page now: "${(now.title || '').slice(0, 60)}" ${now.url}`;
}
