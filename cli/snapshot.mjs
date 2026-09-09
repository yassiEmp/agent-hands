// Eyes. Without this the CLI can only act, never look, so an agent driving an
// external browser had no way to name an element and dropped to raw CDP —
// abandoning the human-rate input this tool exists to provide. Reading the page
// has to be as easy as clicking it, or the safe path loses.
//
// WHY A DOM WALK AND NOT Accessibility.getFullAXTree. AX nodes carry no
// geometry, and a ref here exists only to become click coordinates. Boxes would
// mean one DOM.getBoxModel per node, each a full parse and re-serialise inside
// the relay (daemon.mjs). One Runtime.evaluate returns role, name and rect
// together, and enables no domain, so it emits no event flood at a concurrent
// client — the daemon broadcasts events to every client, with no filtering.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scrollBy, refuseCovered } from './gestures.mjs';

const STATE = path.join(os.homedir(), '.agent-browser', 'humanize');
const refsFile = key => path.join(STATE, `${key}.refs.json`);

const INTERACTIVE = 'a,button,input,textarea,select,summary,[role=button],[role=link],'
  + '[role=tab],[role=checkbox],[role=radio],[role=combobox],[role=textbox],[role=switch],'
  + '[role=menuitem],[role=option],[onclick],[contenteditable],[tabindex]:not([tabindex="-1"])';
const STRUCTURAL = 'header,nav,main,footer,form,dialog,[role=dialog],iframe';

// Runs in the page. Returns a flat list; nesting is rebuilt from `depth`.
//
// The child-index path is deliberately not a data- attribute. Stamping the DOM
// of a page where the user is logged in with real credentials is exactly the
// automation tell that the Bezier motion exists to avoid, and a React re-render
// drops it anyway. A path leaves the page byte-identical.
const WALK = (interactive, structural, max) => `(() => {
  const INTERACTIVE = ${JSON.stringify(interactive)};
  const STRUCTURAL = ${JSON.stringify(structural)};
  const out = [];
  const seen = new Map();

  const nameOf = el => {
    const t = s => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (el.getAttribute('aria-label')) return t(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const parts = lb.split(/\\s+/).map(id => document.getElementById(id)).filter(Boolean);
      if (parts.length) return t(parts.map(p => p.innerText).join(' '));
    }
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) return t(lab.innerText);
    }
    const wrap = el.closest && el.closest('label');
    if (wrap && wrap !== el) return t(wrap.innerText);
    return t(el.alt || el.title || el.placeholder || el.innerText || el.value || '');
  };

  const pathOf = el => {
    const p = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const parent = n.parentNode;
      if (!parent) break;
      if (parent.host && parent.nodeType === 11) { p.unshift(-1); n = parent.host; continue; }
      p.unshift([...parent.children].indexOf(n));
      n = parent;
    }
    return p;
  };

  const selOf = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 5; i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + CSS.escape(n.id)); break; }
      const sibs = n.parentNode ? [...n.parentNode.children].filter(c => c.tagName === n.tagName) : [];
      if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
      parts.unshift(s);
      n = n.parentNode;
    }
    return parts.join(' > ');
  };

  const vis = el => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };

  const all = [...document.querySelectorAll(INTERACTIVE + ',' + STRUCTURAL)];
  const keep = all.filter(el => vis(el));
  // A container earns a ref only when it holds something actionable, so a page
  // of nested divs does not drown the tree it is meant to explain.
  const structural = new Set(keep.filter(el => el.matches(STRUCTURAL)));
  const interactives = keep.filter(el => el.matches(INTERACTIVE));
  const useful = new Set(interactives);
  for (const c of structural) if (interactives.some(i => c.contains(i))) useful.add(c);

  const ordered = keep.filter(el => useful.has(el)).slice(0, ${max});
  const vh = innerHeight, vw = innerWidth;
  for (const el of ordered) {
    const r = el.getBoundingClientRect();
    let depth = 0;
    for (const other of ordered) if (other !== el && other.contains(el)) depth++;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      role: el.getAttribute('role') || null,
      href: el.getAttribute('href') || null,
      name: nameOf(el),
      value: el.value != null && el.type !== 'password' ? String(el.value).slice(0, 40) : null,
      placeholder: el.placeholder || null,
      disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
      selected: el.getAttribute('aria-selected') === 'true' || Boolean(el.checked),
      depth,
      x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height,
      off: r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw,
      path: pathOf(el), sel: selOf(el),
    });
  }
  return JSON.stringify({
    url: location.origin + location.pathname, title: document.title,
    vw, vh, sx: scrollX, sy: scrollY,
    truncated: keep.filter(el => useful.has(el)).length > ${max},
    nodes: out,
  });
})()`;

export async function capture(cdp, { max = 300 } = {}) {
  const raw = await cdp.evaluate(WALK(INTERACTIVE, STRUCTURAL, max));
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const refs = {};
  data.nodes.forEach((n, i) => { refs['e' + (i + 1)] = n; });
  return { v: 1, key: cdp.key, targetId: cdp.targetId ?? null, url: data.url, title: data.title,
           viewport: { w: data.vw, h: data.vh }, scroll: { x: data.sx, y: data.sy },
           truncated: data.truncated, refs };
}

export function save(key, snap) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    const f = refsFile(key);
    // 40 KB is far past an atomic write, and a concurrent click reading a
    // half-written file would resolve a ref to nothing. Rename is atomic.
    fs.writeFileSync(f + '.tmp', JSON.stringify(snap));
    fs.renameSync(f + '.tmp', f);
  } catch { /* a snapshot that cannot be saved is still worth printing */ }
}

export function load(key) {
  try { return JSON.parse(fs.readFileSync(refsFile(key), 'utf8')); } catch { return null; }
}

// What the agent reads, so every byte here is paid on every look at a page.
// Measured on a GitHub repo page (92 refs): hrefs with query strings were a
// third of the output, `type="button"` on a button says nothing, and a
// container's 80-char text excerpt repeats what its children already show.
// Geometry is never printed: --ref re-resolves it at click time.
const STRUCTURAL_TAGS = new Set(['header', 'nav', 'main', 'footer', 'form', 'dialog', 'iframe', 'div', 'section']);
const HREF_MAX = 48;

function shortHref(href) {
  const bare = href.replace(/[?#].*$/, '');
  if (!bare) return href.length > HREF_MAX ? href.slice(0, HREF_MAX - 1) + '…' : href;
  const cut = bare.length > HREF_MAX ? bare.slice(0, HREF_MAX - 1) + '…' : bare;
  return bare === href ? cut : cut + (cut.endsWith('…') ? '' : '?…');
}

export function render(snap) {
  const lines = [];
  lines.push(`Page: ${snap.title || '(untitled)'}`);
  lines.push(`URL: ${snap.url}`);
  const n = Object.keys(snap.refs).length;
  lines.push(`${snap.viewport.w}x${snap.viewport.h} · scroll ${snap.scroll.x},${snap.scroll.y}`
    + ` · ${n} refs${snap.truncated ? ' (truncated)' : ''}`);
  lines.push('');
  for (const [ref, e] of Object.entries(snap.refs)) {
    const showType = e.type && !(e.tag === 'button' && e.type === 'button');
    const attrs = [showType && `type="${e.type}"`, e.href && `href="${shortHref(e.href)}"`,
                   e.role && !['button', 'link'].includes(e.role) && `role="${e.role}"`]
      .filter(Boolean).join(' ');
    const name = STRUCTURAL_TAGS.has(e.tag) && e.name && e.name.length > 40
      ? e.name.slice(0, 39) + '…' : e.name;
    const bits = [e.placeholder && `placeholder="${e.placeholder}"`,
                  e.value && `value="${e.value}"`,
                  e.disabled && 'disabled', e.selected && 'selected',
                  e.off && '↓ offscreen'].filter(Boolean).join(' ');
    lines.push(`${'  '.repeat(Math.min(e.depth, 6))}@${ref} [${e.tag}${attrs ? ' ' + attrs : ''}]`
      + (name ? ` "${name}"` : ' (unnamed)') + (bits ? '  ' + bits : ''));
  }
  return lines.join('\n');
}

// Re-resolve a stored ref against the live page. Cached coordinates alone are
// wrong: an agent snapshots, scrolls, then clicks.
const RELOCATE = (p, sel, tag) => `(() => {
  const walk = path => {
    let n = document.documentElement;
    for (const i of path) {
      if (!n) return null;
      n = i === -1 ? n.shadowRoot : (n.children || [])[i];
    }
    return n;
  };
  const ok = el => el && el.tagName && el.tagName.toLowerCase() === ${JSON.stringify(tag)};
  let el = walk(${JSON.stringify(p)});
  if (!ok(el)) el = document.querySelector(${JSON.stringify(sel)});
  if (!ok(el)) return null;
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  const covered = top && top !== el && !el.contains(top) && !top.contains(el);
  const label = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')
    + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
    + ((n.innerText || '').trim() ? ' "' + (n.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '"' : '');
  return JSON.stringify({ x: cx, y: cy, w: r.width, h: r.height, tag: el.tagName, vh: innerHeight,
                          coveredBy: covered ? label(top) : null });
})()`;

export async function locate(cdp, key, ref, { speed = 1, force = false } = {}) {
  const snap = load(key);
  const id = String(ref).replace(/^@/, '');
  if (!snap) {
    throw usage(`no snapshot for this browser yet. Run: agent-hands snapshot${flagFor(cdp)}`);
  }
  if (cdp.targetId && snap.targetId && cdp.targetId !== snap.targetId) {
    throw usage(`those refs came from a different tab. Re-run: agent-hands snapshot${flagFor(cdp)}`);
  }
  const e = snap.refs[id];
  if (!e) throw usage(`unknown ref "@${id}". Run: agent-hands snapshot${flagFor(cdp)}`);

  let box = await read(cdp, e);
  if (!box) throw usage(`@${id} ("${e.name || e.tag}") is no longer on the page. Re-snapshot.`);

  // Reach an offscreen element the way a human does. scrollIntoView jumps
  // instantly, which is precisely the signal this tool spends motion to avoid.
  if (box.y < 0 || box.y > box.vh) {
    await scrollBy(cdp, Math.round(box.y - box.vh / 2), speed);
    box = await read(cdp, e) || box;
  }
  refuseCovered(box, `@${id} ("${e.name || e.tag}")`, force);
  return { x: box.x, y: box.y, w: box.w, h: box.h, tag: box.tag };
}

async function read(cdp, e) {
  const raw = await cdp.evaluate(RELOCATE(e.path, e.sel, e.tag));
  return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
}

const flagFor = cdp => (cdp.external ? ' --browser <name>' : '');
const usage = m => Object.assign(new Error(m), { code: 'EUSAGE' });
