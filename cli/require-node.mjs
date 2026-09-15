// Refuse early on a Node that lacks the built-in WebSocket. Without this the
// first browser command died with "ReferenceError: WebSocket is not defined",
// which names neither the cause nor the fix. Imported first by the bin so it
// runs before any other module body.

export const NODE_MIN = 22;

const major = parseInt(process.versions.node.split('.')[0], 10) || 0;
if (major < NODE_MIN) {
  const msg = `agent-hands needs Node ${NODE_MIN} or newer; this is Node ${process.versions.node}.\n` +
    `  It drives the browser over the WebSocket built into Node ${NODE_MIN}+.\n` +
    `  Install a current Node: https://nodejs.org   (nvm: nvm install ${NODE_MIN})`;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: false, error: msg, code: 'ENODE' }));
  } else {
    console.error('✗ ' + msg);
  }
  process.exit(2);
}
