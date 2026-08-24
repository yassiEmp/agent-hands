// Deciding which browser a command drives, and saying why.
//
// This is the riskiest layer in the tool: get precedence wrong and commands
// quietly target the wrong browser, which is worse than the repetition it
// replaces. Three invariants hold it together.
//
//   An explicit flag always wins.       The escape hatch never disappears.
//   A pin is verified before use.       A dead pin refuses; it never falls back.
//   Ambiguity stops.                    Guessing is the bug we are removing.

import { load, pinToEndpoint } from './config.mjs';
import { survey } from './browsers.mjs';

export async function resolve(args, { cwd = process.cwd() } = {}) {
  const explicit = Boolean(args.cdp || args.browser || args.userDataDir
    || args.explicitSession || process.env.AGENT_HANDS_CDP || process.env.AGENT_HANDS_SESSION);

  if (explicit) {
    return { via: 'flag', endpoint: fromArgs(args), extras: {} };
  }

  const { merged, id, projectPath } = load(cwd);
  if (merged.target) {
    const check = await verify(merged.target);
    if (!check.ok) {
      throw Object.assign(new Error(deadPin(merged.target, check, projectPath)), { code: 'EPIN' });
    }
    return {
      via: 'pin', id, projectPath,
      endpoint: { ...pinToEndpoint(merged.target), ...fromArgs(args, { onlyOverrides: true }) },
      extras: merged,
    };
  }

  // Nothing explicit, nothing pinned. One live browser is unambiguous; more
  // than one is the moment the agent must ask rather than choose.
  const rows = await survey();
  const live = rows.filter(r => r.state === 'running');
  if (live.length > 1) {
    throw Object.assign(new Error(chooseOne(live)), { code: 'ECHOOSE', choices: live });
  }
  if (live.length === 1) {
    return { via: 'only-one', endpoint: endpointFor(live[0]), only: live[0], extras: {} };
  }
  return { via: 'default', endpoint: fromArgs(args), extras: {} };
}

function fromArgs(args, { onlyOverrides = false } = {}) {
  const e = {};
  if (args.cdp) e.cdp = args.cdp;
  if (args.browser) e.browser = args.browser;
  if (args.userDataDir) e.userDataDir = args.userDataDir;
  if (args.tab) e.tab = args.tab;
  if (!onlyOverrides) {
    e.session = args.session;
    e.activate = args.activate !== false;
  }
  return e;
}

export function endpointFor(row) {
  if (row.kind === 'pool') return { session: row.name };
  if (row.kind === 'launched') return { cdp: String(row.port) };
  return { browser: row.name };
}

export function flagFor(row) {
  if (row.kind === 'pool') return `--session ${row.name}`;
  if (row.kind === 'launched') return `--cdp ${row.port}`;
  return `--browser ${row.name}`;
}

// A port is not an identity: another browser can take a freed port, and driving
// it would be the exact wrong-window failure this feature exists to remove. So
// compare what answers now against what was recorded when the pin was made.
async function verify(pin) {
  const { probeEndpoint } = await import('./browsers.mjs');
  if (!pin.port) return { ok: true, note: 'no port recorded; nothing to verify' };
  const p = await probeEndpoint(pin.port);
  if (p.state !== 'running') return { ok: false, reason: p.detail };
  if (pin.browserVersion && p.detail && p.detail !== pin.browserVersion
      && !/^144\+/.test(p.detail) && !/^144\+/.test(pin.browserVersion)) {
    return { ok: false, reason: `a different browser answers there now (${p.detail}, expected ${pin.browserVersion})` };
  }
  return { ok: true };
}

function deadPin(pin, check, projectPath) {
  const what = pin.cdp ? `--cdp ${pin.cdp}` : pin.browser ? `--browser ${pin.browser}`
    : pin.session ? `--session ${pin.session}` : pin.userDataDir;
  return [
    'the pinned browser is gone.',
    `  pinned: ${what}${pin.profile ? `  profile ${pin.profile}` : ''}`,
    `  now:    ${check.reason}`,
    projectPath ? `  pin file: ${projectPath}` : '',
    '',
    '  Not falling back to another browser on purpose — that is the failure this',
    '  pin exists to prevent. Pick one deliberately:',
    '    agent-hands browsers          what is actually live',
    '    agent-hands use <n>           pin one of them',
    '    agent-hands launch <url>      start a fresh one',
    '    agent-hands use --clear       drop the pin and go back to flags',
  ].filter(Boolean).join('\n');
}

function chooseOne(live) {
  const list = live.map((r, i) => `  ${i + 1}  ${r.name.padEnd(12)} ${flagFor(r).padEnd(18)} ${r.detail}`);
  return [
    'several browsers are live and none is pinned.',
    ...list,
    '',
    '  ASK THE USER which one to drive, then pin their answer:',
    '    agent-hands use <number>',
    '',
    '  Not choosing for you on purpose: logins live in a specific profile, and',
    '  the wrong one looks logged out rather than wrong.',
  ].join('\n');
}
