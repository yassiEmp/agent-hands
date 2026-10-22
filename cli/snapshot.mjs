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
// One DOM.describeNode per ref then adds the browser's node id (nodeids.mjs):
// 160-180 ms for 300 refs, direct or through the relay, measured 22 Oct 2026.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scrollBy, refuseCovered, SCROLLER } from './gestures.mjs';
import { childFrames, withFrame, frameOffset, evaluateIn } from './frames.mjs';
import { evaluateWithIds, callOnNode } from './nodeids.mjs';

const STATE = path.join(os.homedir(), '.agent-browser', 'humanize');
const refsFile = key => path.join(STATE, `${key}.refs.json`);

const INTERACTIVE = 'a,button,input,textarea,select,summary,[role=button],[role=link],'
  + '[role=tab],[role=checkbox],[role=radio],[role=combobox],[role=textbox],[role=switch],'
  + '[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option],[onclick],[contenteditable],[tabindex]:not([tabindex="-1"])';
const STRUCTURAL = 'header,nav,main,footer,form,dialog,[role=dialog],iframe';

// Runs in the page. Returns a flat list; nesting is rebuilt from `depth`.
//
// The child-index path is deliberately not a data- attribute. Stamping the DOM
// of a page where the user is logged in with real credentials is exactly the
// automation tell that the Bezier motion exists to avoid, and a React re-render
// drops it anyway. A path leaves the page byte-identical.
// In-page source shared by the walk and the re-find. With `field` set, the name
// skips the text and the value, which typing changes.
const NAME_OF = `(el, field) => {
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
    if (field) return t(el.title || el.placeholder || el.getAttribute('name') || '');
    return t(el.alt || el.title || el.placeholder || el.innerText || el.value || '');
  }`;

// The identity a ref is checked against at click time.
const IDENT_OF = `el => nameOf(el, el.matches('input,textarea,select') || el.isContentEditable)`;

const WALK = (interactive, structural, max) => `(() => {
  const INTERACTIVE = ${JSON.stringify(interactive)};
  const STRUCTURAL = ${JSON.stringify(structural)};
  const out = [];
  const seen = new Map();

  const nameOf = ${NAME_OF};
  const identOf = ${IDENT_OF};

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
      path: pathOf(el), sel: selOf(el), ident: identOf(el),
    });
  }
  const json = JSON.stringify({
    url: location.origin + location.pathname, title: document.title,
    vw, vh, sx: scrollX, sy: scrollY,
    truncated: keep.filter(el => useful.has(el)).length > ${max},
    nodes: out,
  });
  return [json, ...ordered];
})()`;

// One walk, then the browser's node id for each element. A browser that
// refuses the ids still gets a snapshot, resolved by path and name alone.
async function walkIn(cdp, walk, session) {
  try {
    const { json, ids } = await evaluateWithIds(cdp, walk, session);
    const data = JSON.parse(json);
    data.nodes.forEach((n, i) => { if (ids[i]) n.node = ids[i]; });
    return data;
  } catch {
    const raw = await cdp.send('Runtime.evaluate', { expression: walk + '[0]', returnByValue: true }, session);
    return JSON.parse(raw.result.value);
  }
}

export async function capture(cdp, { max = 300 } = {}) {
  const walk = WALK(INTERACTIVE, STRUCTURAL, max);
  const data = await walkIn(cdp, walk, undefined);
  const nodes = [...data.nodes, ...await frameNodes(cdp, data, walk)];
  const { refs, next } = number(nodes, load(cdp.key), cdp.targetId ?? null);
  return { v: 1, key: cdp.key, targetId: cdp.targetId ?? null, url: data.url, title: data.title,
           viewport: { w: data.vw, h: data.vh }, scroll: { x: data.sx, y: data.sy },
           truncated: data.truncated, next, refs };
}

// Numbers survive a new snapshot of the same tab, so @e12 still names the
// Create button after a click opens a section above it. An element keeps its
// number when it has the same node id, else when its tag and name are unique
// on both snapshots. A number is never given to another element in the same
// tab, even after a navigation, so an old ref names its element or nothing.
// Only a new tab starts again at @e1.
//
// Position is no evidence. A list of "Delete" buttons re-rendered after a row
// is removed puts row 4's button at row 3's path.
const shapeOf = e => JSON.stringify([e.frame?.targetId ?? '', e.tag, e.ident ?? e.name ?? '']);
const nodeKey = e => (e.frame?.targetId ?? '') + ':' + e.node;

// Shapes that occur once in `list`, mapped to their ref (or index).
function uniqueShapes(list) {
  const seen = new Map();
  for (const [r, e] of list) {
    if (!(e.ident ?? e.name)) continue;
    const s = shapeOf(e);
    seen.set(s, seen.has(s) ? null : r);
  }
  return seen;
}

function number(nodes, prev, targetId) {
  const same = targetId && prev?.targetId === targetId && prev.refs;
  const old = same ? Object.entries(prev.refs) : [];
  const refs = {};
  if (!same) {
    nodes.forEach((n, i) => { refs['e' + (i + 1)] = n; });
    return { refs, next: nodes.length + 1 };
  }
  // A node id alone is no proof. Ids come from a per-process counter, so a
  // new document in another process can reuse one, and a framework can reuse
  // a node for other content ("Edit" becoming "Save"). The name must match too.
  const byNode = new Map(old.filter(([, e]) => e.node).map(([r, e]) => [nodeKey(e) + shapeOf(e), r]));
  // Two passes: a node-id match must win over a shape match lower down.
  const shapes = uniqueShapes(old);
  const fresh = uniqueShapes(nodes.map((n, i) => [i, n]));
  const taken = new Set();
  const ids = nodes.map(n => {
    const r = n.node && byNode.get(nodeKey(n) + shapeOf(n));
    if (r && !taken.has(r)) { taken.add(r); return r; }
    return null;
  });
  nodes.forEach((n, i) => {
    if (ids[i] || fresh.get(shapeOf(n)) !== i) return;
    const r = shapes.get(shapeOf(n));
    if (r && !taken.has(r)) { taken.add(r); ids[i] = r; }
  });
  // `next` outlives the refs that used it: a number from two snapshots ago
  // must not come back.
  let next = Math.max(prev.next || 0, ...old.map(([r]) => (Number(r.slice(1)) || 0) + 1));
  nodes.forEach((n, i) => { refs[ids[i] ?? 'e' + next++] = n; });
  return { refs, next };
}

// The fields inside cross-origin frames, in page coordinates. Each frame gets
// one heading ref, so the agent sees where the fields live.
async function frameNodes(cdp, top, walk) {
  const frames = await childFrames(cdp, { onFrame: (f, sid) => walkIn(cdp, walk, sid) });
  const out = [];
  for (const f of frames) {
    const data = f.result;
    if (!data?.nodes?.length) continue;
    const frame = { targetId: f.targetId, url: data.url, depth: f.depth };
    const off = (y, h) => y + h / 2 < 0 || y - h / 2 > top.vh;
    out.push({ tag: 'iframe', name: new URL(data.url).host, depth: f.depth, frameBox: true, frame,
               x: f.ox + f.w / 2, y: f.oy + f.h / 2, w: f.w, h: f.h, off: off(f.oy + f.h / 2, f.h) });
    for (const n of data.nodes) {
      const y = n.y + f.oy;
      out.push({ ...n, x: n.x + f.ox, y, depth: n.depth + f.depth + 1, frame, off: off(y, n.h) });
    }
  }
  return out;
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
// The page expression for a stored element: its child-index path, else its
// selector, else the one element of its tag with its name. Path and selector
// are both positions. When a form inserts a section, the path lands on the
// next button along, so a match also needs the same name. Measured on the
// Cloudflare R2 token form: Create resolved to Cancel and was clicked.
//
// A ref with a node id reaches here only when that node is gone. Its old
// position then holds a lookalike at best: a non-keyed list re-render put
// row 4's Delete at row 3's path. So only a unique name is accepted.
// `positional` keeps the position steps for choosing what to scroll, where a
// lookalike in the same container is harmless.
const FIND = (e, { positional = !e.node } = {}) => `(() => {
  const nameOf = ${NAME_OF};
  const identOf = ${IDENT_OF};
  const tag = ${JSON.stringify(e.tag)}, ident = ${JSON.stringify(e.ident ?? null)};
  const walk = path => {
    let n = document.documentElement;
    for (const i of path) {
      if (!n) return null;
      n = i === -1 ? n.shadowRoot : (n.children || [])[i];
    }
    return n;
  };
  const ok = el => el && el.tagName && el.tagName.toLowerCase() === tag
    && (ident === null || identOf(el) === ident);
  let el = ${positional} ? walk(${JSON.stringify(e.path)}) : null;
  if (${positional} && !ok(el)) el = document.querySelector(${JSON.stringify(e.sel)});
  if (!ok(el) && ident) {
    const named = [...document.querySelectorAll(tag)].filter(ok);
    el = named.length === 1 ? named[0] : null;
  }
  return ok(el) ? el : null;
})()`;

// The <iframe> whose content box starts at (ox, oy): the owner of a frame ref,
// as the page sees it. Page JS cannot name a cross-origin frame any other way.
const FRAME_AT = (ox, oy) => `[...document.querySelectorAll('iframe')].find(f => {
  const r = f.getBoundingClientRect();
  return Math.abs(r.x + f.clientLeft - ${ox}) < 2 && Math.abs(r.y + f.clientTop - ${oy}) < 2;
}) || null`;

const RELOCATE = e => `(() => {
  const el = ${FIND(e)};
  return el ? (${MEASURE}).call(el) : null;
})()`;

// The stored node itself, when it is still in the page and still the same
// element. A framework may reuse a node for other content, so the name is
// checked here too. A live node under another name is CHANGED: the search by
// position would then find a lookalike, so the click is refused.
const CHANGED = 'changed';
const CHECKED = e => `function () {
  const nameOf = ${NAME_OF};
  const identOf = ${IDENT_OF};
  const ident = ${JSON.stringify(e.ident ?? null)};
  if (!this.isConnected) return null;
  if (this.tagName.toLowerCase() !== ${JSON.stringify(e.tag)}) return '${CHANGED}';
  if (ident !== null && identOf(this) !== ident) return '${CHANGED}';
  return (${MEASURE}).call(this);
}`;

const MEASURE = `function () {
  const el = this;
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  const covered = top && top !== el && !el.contains(top) && !top.contains(el);
  const label = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')
    + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
    + ((n.innerText || '').trim() ? ' "' + (n.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '"' : '');
  return JSON.stringify({ x: cx, y: cy, w: r.width, h: r.height, tag: el.tagName, vw: innerWidth, vh: innerHeight,
                          coveredBy: covered ? label(top) : null });
}`;

export async function locate(cdp, key, ref, { speed = 1, force = false } = {}) {
  const snap = load(key);
  const id = String(ref).replace(/^@/, '');
  if (!snap) {
    throw usage(`no snapshot for this browser yet. Run: agent-hands snapshot${flagFor(cdp)}`);
  }
  if ((cdp.targetId ?? null) !== (snap.targetId ?? null)) {
    throw usage(`those refs came from a different tab. Re-run: agent-hands snapshot${flagFor(cdp)}`);
  }
  const e = snap.refs[id];
  if (!e) {
    const n = Object.keys(snap.refs).length;
    throw usage(`unknown ref "@${id}": it is not in the last snapshot (${n} refs). ` +
      `Its element left the page, or the page is new.\n  Read it again: agent-hands snapshot${flagFor(cdp)}`);
  }

  let box = await read(cdp, e);
  if (!box) throw usage(`@${id} ("${e.name || e.tag}") is no longer on the page, or the page changed around it.\n` +
    `  Re-run: agent-hands snapshot${flagFor(cdp)}`);

  // Reach an offscreen element the way a human does. scrollIntoView jumps
  // instantly, which is precisely the signal this tool spends motion to avoid.
  // Innermost document first: no outer scroll brings an element below a
  // frame's own fold into view. Measured on example.com in a 600x300 frame:
  // the page scrolled, the press landed outside the window, and the click
  // reported success.
  const depth = e.frame?.depth ?? 0;
  if (box.inner) {
    const near = FIND(e, { positional: true });
    await withFrame(cdp, box.frame.targetId, session => bring(cdp, box.inner, near, session, speed, { exact: true }));
    box = await read(cdp, e) || box;
  }
  // The frames between the page and the ref's frame, innermost first. Each
  // scrolls its own document to the <iframe> of the frame it holds.
  if (box.frame && depth > 0) {
    for (const { frame: p, child } of await chainOf(cdp, box.frame.targetId)) {
      const view = viewIn(box, p);
      if (!outside(view)) continue;
      await withFrame(cdp, p.targetId, async session =>
        bring(cdp, view, await iframeAt(cdp, session, child.ox - p.ox, child.oy - p.oy), session, speed));
      box = await read(cdp, e) || box;
    }
  }
  if (!box.frame || outside(box)) {
    const near = box.frame ? await rootFrameOwner(cdp, box.frame) : FIND(e, { positional: true });
    await bring(cdp, box, near, undefined, speed, { exact: !box.frame });
    box = await read(cdp, e) || box;
  }
  const what = `@${id} ("${e.name || e.tag}")`;
  await refuseOutside(cdp, box, depth, what);
  refuseCovered(box, what, force);
  return { x: box.x, y: box.y, w: box.w, h: box.h, tag: box.tag, ...(box.frame && { frame: box.frame }) };
}

// A view is a point and the window it must sit in: {x, y, vw, vh}. A window
// that reports no size (minimised) cannot tell, so that axis never refuses.
const offAxis = (v, axis) => axis === 'x'
  ? v.vw > 0 && (v.x < 0 || v.x > v.vw)
  : v.vh > 0 && (v.y < 0 || v.y > v.vh);
const outside = v => offAxis(v, 'x') || offAxis(v, 'y');

// How far `el` sits from the middle of what the scroller of `level` shows,
// clipped to the window. Zero when it is already inside. A carousel 500 px
// wide shows less than the window, so centring on the window left a button
// past the carousel's edge.
const OFFSET = (el, level, axis) => `((el, s) => {
  if (!el) return null;
  const x = ${axis === 'x'};
  const e = el.getBoundingClientRect();
  const win = x ? innerWidth : innerHeight;
  let lo = 0, hi = win;
  if (s !== window) {
    const r = s.getBoundingClientRect();
    lo = Math.max(0, x ? r.left : r.top); hi = Math.min(win, x ? r.right : r.bottom);
  }
  const mid = x ? e.left + e.width / 2 : e.top + e.height / 2;
  return { d: mid >= lo && mid <= hi ? 0 : Math.round(mid - (lo + hi) / 2), win: s === window };
})(${el}, ${SCROLLER(axis)}(${level}))`;

// Each scroller from the nearest out to the window, at most four deep.
// False when the page cannot find the element.
async function bringExact(cdp, el, axis, session, speed) {
  let level = el;
  for (let k = 0; k < 4; k++) {
    const o = await evaluateIn(cdp, session, OFFSET(el, level, axis));
    if (!o) return k > 0;
    if (o.d) await scrollBy(cdp, o.d, speed, { near: level, session, axis });
    if (o.win) return true;
    level = `${SCROLLER(axis)}(${level})`;
  }
  return true;
}

// Scroll one document until the point is in view on each axis it is off.
// With `exact`, `near` is the element itself: each scroller from the nearest
// out to the window moves just enough to show it. Otherwise `near` is an
// <iframe> holding the point, and its scroller centres the point.
async function bring(cdp, view, near, session, speed, { exact = false } = {}) {
  for (const axis of ['y', 'x']) {
    // Exact runs even inside the window: a container can clip the element.
    // An element the page cannot find by position falls back to the view.
    if (exact && await bringExact(cdp, near, axis, session, speed)) continue;
    if (!offAxis(view, axis)) continue;
    const d = axis === 'x' ? view.x - view.vw / 2 : view.y - view.vh / 2;
    await scrollBy(cdp, Math.round(d), speed, { near, session, axis });
  }
}

// The point as frame `f` sees it: f's box is its window.
const viewIn = (box, f) => ({ x: box.x - f.ox, y: box.y - f.oy, vw: f.w, vh: f.h });

// The frames that hold the ref's frame, innermost first, each with the frame
// it holds. Excludes the ref's own frame and the page.
async function chainOf(cdp, targetId) {
  const byId = new Map((await childFrames(cdp)).map(f => [f.targetId, f]));
  const out = [];
  for (let c = byId.get(targetId); c?.parent && byId.has(c.parent); c = byId.get(c.parent)) {
    out.push({ frame: byId.get(c.parent), child: c });
  }
  return out;
}

// A press outside any window on its way reaches nothing, so it must not
// report success.
async function refuseOutside(cdp, box, depth, what) {
  let off = outside(box) || Boolean(box.inner && outside(box.inner));
  if (!off && box.frame && depth > 0) {
    off = (await chainOf(cdp, box.frame.targetId)).some(({ frame: p }) => outside(viewIn(box, p)));
  }
  if (!off) return;
  throw Object.assign(new Error(`${what} is still out of view after scrolling.
` +
    `  A press there reaches nothing. Snapshot again; if it stays offscreen, its container does not scroll.`),
    { code: 'ECOVERED' });
}

// The <iframe> whose content box starts at (ox, oy) in a document, as an
// index. The frame moves while it scrolls, so a position match fails after
// the first step; the index does not change.
async function iframeAt(cdp, session, ox, oy) {
  const i = await evaluateIn(cdp, session, `[...document.querySelectorAll('iframe')].indexOf(${FRAME_AT(ox, oy)})`);
  return i >= 0 ? `document.querySelectorAll('iframe')[${i}]` : 'null';
}

// The page scrolls the outermost frame that holds the ref's frame.
async function rootFrameOwner(cdp, frame) {
  const frames = await childFrames(cdp);
  const byId = new Map(frames.map(f => [f.targetId, f]));
  let root = byId.get(frame.targetId);
  while (root?.parent && byId.has(root.parent)) root = byId.get(root.parent);
  return root ? iframeAt(cdp, undefined, root.ox, root.oy) : 'null';
}

// The stored node first, then path, selector and name.
async function measure(cdp, e, session) {
  const byNode = e.node ? await callOnNode(cdp, e.node, CHECKED(e), session) : null;
  if (byNode === CHANGED) return null;
  return byNode ?? await evaluateIn(cdp, session, RELOCATE(e));
}

async function read(cdp, e) {
  if (!e.frame) {
    const raw = await measure(cdp, e, undefined);
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }
  // Inside a frame: find where the frame sits now, then the element inside it.
  const f = await frameOffset(cdp, e.frame.targetId, e.frame.depth ?? 1);
  if (!f) return null;
  const [vw, vh] = await cdp.evaluate('[innerWidth, innerHeight]');
  const frame = { targetId: f.targetId, ox: f.ox, oy: f.oy };
  if (e.frameBox) return { x: f.ox + f.w / 2, y: f.oy + f.h / 2, w: f.w, h: f.h, tag: 'IFRAME', vw, vh, frame };
  const raw = await withFrame(cdp, f.targetId, sid => measure(cdp, e, sid)).catch(() => null);
  if (!raw) return null;
  const b = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // `inner`: where the element sits in the frame's own window.
  return { ...b, x: b.x + f.ox, y: b.y + f.oy, vw, vh, frame, inner: { x: b.x, y: b.y, vw: b.vw, vh: b.vh } };
}

// The flag that reaches this same browser again. The store key carries the
// browser name; a raw --cdp connection has none, so its port is named instead.
const flagFor = cdp => {
  if (!cdp.external) return '';
  const name = String(cdp.key || '').replace(/-[0-9a-f]{8}$/, '');
  return name && name !== 'cdp' && name !== 'dir' ? ` --browser ${name}` : ` --cdp ${cdp.port}`;
};
const usage = m => Object.assign(new Error(m), { code: 'EUSAGE' });
