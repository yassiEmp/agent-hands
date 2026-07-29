// Gestures. Each returns a plain object so --json can print it directly.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { rand, sleep, lognormal, moveDuration, bezierPath } from './motion.mjs';

const TICK_MS = 10; // 100Hz dispatch; Chrome coalesces to a 60-125Hz trace
const STATE = path.join(os.homedir(), '.agent-browser', 'humanize');

// ------------------------------------------------------- cursor state

const posFile = session => path.join(STATE, `${session}.pos`);

export function readPos(session) {
  try {
    const [x, y] = fs.readFileSync(posFile(session), 'utf8').split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  } catch { /* first gesture of the session */ }
  return null;
}

function writePos(session, x, y) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(posFile(session), `${Math.round(x)},${Math.round(y)}`);
}

// ------------------------------------------------------------- mouse

function dispatchMove(cdp, x, y) {
  cdp.fire('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(x), y: Math.round(y),
    timestamp: Date.now() / 1000, pointerType: 'mouse',
  });
}

export async function moveTo(cdp, session, to, width, speed) {
  const from = readPos(session) || { x: rand(80, 400), y: rand(300, 600) };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 2) return { points: 0, ms: 0, overshoot: false };

  const steps = Math.max(8, Math.round(moveDuration(dist, width, speed) / TICK_MS));

  // Long reaches overshoot then correct. This is the strongest human signature
  // and the one straight-line automation never produces.
  const overshoot = dist > 180 && Math.random() < 0.75;
  const aim = overshoot ? { x: to.x + rand(-14, 14), y: to.y + rand(-14, 14) } : to;

  const t0 = Date.now();
  for (const p of bezierPath(from, aim, steps)) {
    dispatchMove(cdp, p.x, p.y);
    await sleep(TICK_MS);
  }
  if (overshoot) {
    await sleep(lognormal(45, 0.4, 140));
    for (const p of bezierPath(aim, to, Math.round(rand(5, 9)))) {
      dispatchMove(cdp, p.x, p.y);
      await sleep(TICK_MS);
    }
  }
  writePos(session, to.x, to.y);
  return { points: steps, ms: Date.now() - t0, overshoot };
}

export async function clickAt(cdp, session, to, width, speed) {
  const move = await moveTo(cdp, session, to, width, speed);
  await sleep(lognormal(90, 0.45, 320)); // settle before pressing
  const base = {
    x: Math.round(to.x), y: Math.round(to.y),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  };
  cdp.fire('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', timestamp: Date.now() / 1000 });
  await sleep(lognormal(72, 0.35, 200)); // button dwell
  cdp.fire('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', timestamp: Date.now() / 1000 });
  return move;
}

// ---------------------------------------------------------- keyboard

export async function typeText(cdp, text, speed) {
  const t0 = Date.now();
  for (const ch of text) {
    // Insertion happens on `char`. keyDown must not carry text or every
    // character lands twice.
    cdp.fire('Input.dispatchKeyEvent', { type: 'keyDown', key: ch });
    cdp.fire('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
    await sleep(lognormal(48, 0.32, 150) / speed);          // dwell
    cdp.fire('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });

    let flight = lognormal(95, 0.5, 400) / speed;
    if (ch === ' ') flight *= rand(1.1, 1.8);               // word boundaries lag
    if (Math.random() < 0.03) flight += rand(250, 900);     // occasional think-pause
    await sleep(flight);
  }
  return { chars: [...text].length, ms: Date.now() - t0 };
}

export const KEYS = {
  Enter: { code: 'Enter', key: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', key: 'Tab', vk: 9, text: '\t' },
  Escape: { code: 'Escape', key: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', key: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', key: 'Delete', vk: 46 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', vk: 39 },
};

export async function pressKey(cdp, name, speed) {
  const k = KEYS[name];
  if (!k) {
    const err = new Error(`unknown key "${name}". known: ${Object.keys(KEYS).join(', ')}`);
    err.code = 'EUSAGE';
    throw err;
  }
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await sleep(lognormal(140, 0.4, 400) / speed); // humans pause before committing
  cdp.fire('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' });
  if (k.text) cdp.fire('Input.dispatchKeyEvent', { ...base, type: 'char', text: k.text });
  await sleep(lognormal(70, 0.35, 200) / speed);
  cdp.fire('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  return { key: name };
}

// ------------------------------------------------------------ scroll

// CDP wheel events are dropped while the window is backgrounded: they route
// through the compositor, which throttling stops. Mouse moves survive because
// they do not. So drive the scroller directly, keeping the burst-and-pause
// rhythm a wheel produces. The native `scroll` event still fires, so lazy
// loading and IntersectionObserver behave normally. Pages listening for
// `wheel` specifically will not see it.
export async function scrollBy(cdp, deltaY, speed) {
  const t0 = Date.now();
  const dir = Math.sign(deltaY);
  const total = Math.abs(deltaY);
  let done = 0;

  while (done < total) {
    const notch = Math.min(total - done, rand(90, 190));
    const frames = Math.max(3, Math.round(notch / 22));
    let prev = 0;
    for (let i = 1; i <= frames; i++) {
      const eased = 1 - Math.pow(1 - i / frames, 3);
      const at = notch * eased;
      cdp.fire('Runtime.evaluate', { expression: `window.scrollBy(0,${dir * (at - prev)})` });
      prev = at;
      await sleep(16);
    }
    done += notch;
    await sleep(rand(70, 260) / speed); // pause between bursts
  }
  return { pixels: deltaY, ms: Date.now() - t0, y: await cdp.evaluate('Math.round(window.scrollY)') };
}

// ------------------------------------------------- element resolution

// Ranked, never first-match. A search box whose aria-label is "Search" must
// not beat the button whose text is "Search".
const RESOLVER = `(t => {
  const els = [...document.querySelectorAll('a,button,input,textarea,select,[role=button],[onclick]')];
  const score = e => {
    const own = (e.innerText || '').trim().toLowerCase();
    const alt = (e.getAttribute('aria-label') || e.value || '').trim().toLowerCase();
    if (!own.includes(t) && !alt.includes(t)) return -1;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return -1;
    let s = 0;
    if (own === t || alt === t) s += 40;
    if (own.includes(t)) s += 20;
    if (/^(BUTTON|A)$/.test(e.tagName)) s += 15;
    if (e.type === 'submit') s += 15;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) s -= 10;
    return s;
  };
  return els.map(e => [e, score(e)]).filter(p => p[1] >= 0)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
})`;

const BOX = `(el => {
  if (!el) return null;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, tag: el.tagName };
})`;

// Resolve an agent-browser snapshot ref (@e12) by asking agent-browser for its
// box. Refs carry frame context, so this reaches inside cross-origin iframes
// that `--text` and `--xy` cannot: page JS is blocked there, but CDP is not.
export function resolveRef(session, ref) {
  // Validate before building a shell string. agent-browser is a .cmd shim on
  // Windows, so it needs a shell; an args array plus shell:true is deprecated
  // and unescaped. Whitelisting both inputs makes interpolation safe.
  if (!/^[\w.-]+$/.test(session)) {
    const err = new Error(`invalid session name "${session}"`); err.code = 'EUSAGE'; throw err;
  }
  if (!/^@?[a-zA-Z]\d+$/.test(ref)) {
    const err = new Error(`invalid ref "${ref}". Expected a snapshot ref such as @e12.`);
    err.code = 'EUSAGE'; throw err;
  }

  const run = sub => execSync(`agent-browser --session ${session} ${sub} ${ref}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  try { run('scrollintoview'); } catch { /* already in view, or not scrollable */ }

  let out;
  try {
    out = run('get box');
  } catch (e) {
    const err = new Error(
      `could not read box for ${ref}. Refs go stale on every page change.\n` +
      `  fix: agent-browser --session ${session} snapshot -i    then use the new ref.`
    );
    err.code = 'ENOTFOUND';
    throw err;
  }

  const num = key => {
    const m = out.match(new RegExp(`${key}:\\s*(-?[\\d.]+)`));
    return m ? Number(m[1]) : null;
  };
  const x = num('x'), y = num('y'), w = num('width') ?? 12, h = num('height') ?? 12;
  if (x === null || y === null) {
    const err = new Error(`agent-browser returned no geometry for ${ref}`);
    err.code = 'ENOTFOUND';
    throw err;
  }
  if (w < 1 || h < 1) {
    const err = new Error(`${ref} has zero size, so it cannot be clicked. It may be hidden.`);
    err.code = 'ENOTFOUND';
    throw err;
  }
  return {
    x: x + w / 2 + rand(-w / 5, w / 5),
    y: y + h / 2 + rand(-h / 5, h / 5),
    w, h, tag: ref,
  };
}

export async function resolveTarget(cdp, { selector, text }) {
  const finder = text
    ? `${RESOLVER}(${JSON.stringify(text.toLowerCase())})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  const box = await cdp.evaluate(`${BOX}(${finder})`);

  if (!box) {
    const what = text ? `text "${text}"` : `selector "${selector}"`;
    const err = new Error(
      `no element matched ${what}.\n` +
      `  hint: run \`agent-browser --session <s> snapshot -i\` to see what is on the page.`
    );
    err.code = 'ENOTFOUND';
    throw err;
  }
  // Aim off-centre. Humans do not hit the exact middle of a button.
  return {
    x: box.x + rand(-box.w / 5, box.w / 5),
    y: box.y + rand(-box.h / 5, box.h / 5),
    w: box.w, h: box.h, tag: box.tag,
  };
}
