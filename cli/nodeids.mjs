// The browser's own id for an element: DOM backendNodeId. It stays the same
// while the element exists, even when the page moves it, and the page cannot
// see it. A child-index path breaks as soon as a form inserts a section.
//
// No domain is enabled. DOM.describeNode and DOM.resolveNode answer without
// DOM.enable, so no mutation events reach the relay's other clients.

// One group per call. A shared name let a concurrent click release a
// snapshot's objects halfway through, and every id after that came back null.
let calls = 0;
const group = () => `agent-hands-${process.pid}-${++calls}`;

const release = (cdp, session, objectGroup) =>
  cdp.send('Runtime.releaseObjectGroup', { objectGroup }, session).catch(() => {});

// `expression` evaluates to [json, el1, el2, ...]. Returns the json and one
// backendNodeId (or null) per element, in order.
export async function evaluateWithIds(cdp, expression, session) {
  const objectGroup = group();
  try {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate',
      { expression, returnByValue: false, objectGroup }, session);
    if (exceptionDetails || !result?.objectId) throw new Error('walk failed');
    const { result: props } = await cdp.send('Runtime.getProperties',
      { objectId: result.objectId, ownProperties: true, objectGroup }, session);
    const items = props.filter(p => /^\d+$/.test(p.name)).sort((a, b) => a.name - b.name);
    const json = items[0]?.value?.value;
    const ids = await Promise.all(items.slice(1).map(p =>
      cdp.send('DOM.describeNode', { objectId: p.value.objectId, depth: 0 }, session)
        .then(r => r.node.backendNodeId, () => null)));
    return { json, ids };
  } finally {
    await release(cdp, session, objectGroup);
  }
}

// Run `fn` (a function declaration, `this` is the element) on a stored node.
// Null when the node no longer exists.
export async function callOnNode(cdp, backendNodeId, fn, session) {
  const objectGroup = group();
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId, objectGroup }, session);
    const { result } = await cdp.send('Runtime.callFunctionOn',
      { objectId: object.objectId, functionDeclaration: fn, returnByValue: true }, session);
    return result?.value ?? null;
  } catch {
    return null;
  } finally {
    await release(cdp, session, objectGroup);
  }
}
