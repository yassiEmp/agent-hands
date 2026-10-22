// Cross-origin iframes: payment forms, embedded sign-ins, captchas.
//
// Page JS cannot see into a cross-origin frame, so the snapshot walk missed
// every field inside one. Reported 22 Oct 2026: Stripe's card number, expiry
// and CVC sit in js.stripe.com frames, and an agent could not pay. Chromium
// runs such a frame in its own process and lists it as a target of type
// "iframe". This file finds the frames of a page, runs a script inside each,
// and places frame coordinates in page coordinates. Input needs nothing
// special: a mouse event at page coordinates reaches the frame under it, and
// keys go to whichever frame holds focus.
//
// COST. The first version visited frames one at a time and attached to each
// twice: a snapshot of docs.stripe.com (11 frames) took 4.75 s. Most of those
// frames are 0-1 px helpers (controller, analytics, invisible captcha) that
// hold nothing to click. Frames under MIN_PX are skipped, frames are visited
// in parallel, and the caller's work runs inside the same attach.

const MAX_DEPTH = 3;
const MIN_PX = 8;

// A child frame belongs to this page when DOM.getFrameOwner finds its <iframe>
// in the page. Its content box gives the offset from frame to page coordinates.
async function ownerBox(cdp, frameId, session) {
  try {
    const { backendNodeId } = await cdp.send('DOM.getFrameOwner', { frameId }, session);
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId }, session);
    const [x, y] = model.content;
    return { ox: x, oy: y, w: model.width, h: model.height };
  } catch {
    return null;
  }
}

async function attach(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
  return sessionId;
}

function detach(cdp, sessionId) {
  return cdp.send('Target.detachFromTarget', { sessionId }, null).catch(() => {});
}

export async function evaluateIn(cdp, sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  return r.result?.value;
}

async function iframeTargets(cdp) {
  try {
    const { targetInfos } = await cdp.send('Target.getTargets', {}, null);
    return targetInfos.filter(t => t.type === 'iframe');
  } catch { return []; }
}

// Every visible cross-origin frame inside the current page, nested ones
// included, with its offset from the page's top-left corner. onFrame(frame,
// sessionId) runs while the frame is attached; its result lands in frame.result.
export async function childFrames(cdp, { onFrame = null } = {}) {
  const pending = await iframeTargets(cdp);
  if (!pending.length) return [];
  const found = [];
  const claimed = new Set();

  // A frame nested in another cross-origin frame has its <iframe> in that
  // frame's DOM, so getFrameOwner fails from the page and succeeds one level down.
  const visit = async (session, base, depth) => {
    const open = pending.filter(t => !claimed.has(t.targetId));
    const boxes = await Promise.all(open.map(t => ownerBox(cdp, t.targetId, session)));
    const mine = [];
    open.forEach((t, i) => {
      const b = boxes[i];
      if (!b || claimed.has(t.targetId)) return;
      claimed.add(t.targetId);
      if (b.w < MIN_PX || b.h < MIN_PX) return;
      // `parent`: the frame that holds this one, null for the page. A frame
      // scrolled out of its parent's view sits outside the parent's box, so
      // containment cannot name the parent.
      mine.push({ targetId: t.targetId, url: t.url, ox: base.ox + b.ox, oy: base.oy + b.oy, w: b.w, h: b.h, depth,
                  parent: base.targetId ?? null });
    });
    found.push(...mine);
    await Promise.all(mine.map(async f => {
      const sid = await attach(cdp, f.targetId).catch(() => null);
      if (!sid) return;
      try {
        if (onFrame) f.result = await onFrame(f, sid).catch(() => null);
        if (depth + 1 <= MAX_DEPTH) await visit(sid, f, depth + 1);
      } finally { await detach(cdp, sid); }
    }));
  };
  await visit(cdp.sessionId ?? undefined, { ox: 0, oy: 0 }, 0);
  return found.sort((a, b) => a.depth - b.depth || a.oy - b.oy || a.ox - b.ox);
}

// Run an expression inside one frame. The session lives for this call only:
// an attached session is the one thing a page could notice.
export async function withFrame(cdp, targetId, fn) {
  const sid = await attach(cdp, targetId);
  try { return await fn(sid); } finally { await detach(cdp, sid); }
}

export const inFrame = (cdp, targetId, expression) =>
  withFrame(cdp, targetId, sid => evaluateIn(cdp, sid, expression));

// Where a frame sits in the page now. The page may have scrolled since the
// snapshot. A top-level frame costs two calls; only a nested one needs the search.
export async function frameOffset(cdp, targetId, depth = 0) {
  if (depth === 0) {
    const b = await ownerBox(cdp, targetId, cdp.sessionId ?? undefined);
    if (b) return { targetId, ox: b.ox, oy: b.oy, w: b.w, h: b.h, depth: 0 };
  }
  return (await childFrames(cdp)).find(f => f.targetId === targetId) ?? null;
}
