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

const MAX_DEPTH = 3;

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

// Every cross-origin frame inside the current page, nested ones included, with
// its offset from the page's top-left corner. The page session is cdp.sessionId
// (null on a launched browser's page socket, where calls go to the page).
export async function childFrames(cdp) {
  let infos;
  try { ({ targetInfos: infos } = await cdp.send('Target.getTargets', {}, null)); } catch { return []; }
  const iframes = infos.filter(t => t.type === 'iframe');
  if (!iframes.length) return [];

  // A frame nested in another cross-origin frame has its <iframe> in that
  // frame's DOM, so getFrameOwner fails from the page and succeeds one level down.
  const found = [];
  const visit = async (session, base, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const t of iframes) {
      if (found.some(f => f.targetId === t.targetId)) continue;
      const box = await ownerBox(cdp, t.targetId, session);
      if (!box) continue;
      const frame = { targetId: t.targetId, url: t.url, ox: base.ox + box.ox, oy: base.oy + box.oy,
                      w: box.w, h: box.h, depth };
      found.push(frame);
      const sid = await attach(cdp, t.targetId).catch(() => null);
      if (!sid) continue;
      try { await visit(sid, frame, depth + 1); } finally { await detach(cdp, sid); }
    }
  };
  await visit(cdp.sessionId ?? undefined, { ox: 0, oy: 0 }, 0);
  return found;
}

// Run an expression inside one frame. The session lives for this call only:
// an attached session is the one thing a page could notice.
export async function inFrame(cdp, targetId, expression) {
  const sid = await attach(cdp, targetId);
  try { return await evaluateIn(cdp, sid, expression); } finally { await detach(cdp, sid); }
}

// Where a frame sits in the page now. The page may have scrolled since the snapshot.
export async function frameOffset(cdp, targetId) {
  const frames = await childFrames(cdp);
  return frames.find(f => f.targetId === targetId) ?? null;
}
