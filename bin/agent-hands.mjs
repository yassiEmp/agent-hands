#!/usr/bin/env node
// agent-hands — human-rate mouse and keyboard for an agent-browser session.
//
// Exit codes: 0 ok, 1 runtime failure, 2 usage error.

import { CDP, devtoolsPort, profileDir, browserInfo } from '../cli/cdp.mjs';
import { moveTo, clickAt, typeText, pressKey, scrollBy, resolveTarget, resolveRef, selectAll, readPos, KEYS } from '../cli/gestures.mjs';
import { listSkills, getSkill } from '../cli/skills.mjs';
import { sleep, lognormal } from '../cli/motion.mjs';

const VERSION = '0.3.0';

const USAGE = `agent-hands ${VERSION} — human-rate input for an agent-browser session

USAGE
  agent-hands <command> [args] [--session <name>] [--speed <n>] [--json]

COMMANDS
  click --ref @e12            target a snapshot ref — most robust, works in iframes
  click <selector>            target a CSS selector
  click --text "Label"        target by visible text (ranked, best match wins)
  click --xy <x> <y>          target raw viewport coordinates (last resort)
  hover <selector>            move onto the element, no click
  move --xy <x> <y>           move only
  fill <target> "text"        click, select all, replace. --append to keep old text
  type "text"                 type into whatever has focus
  press <Key> [--times n]     ${Object.keys(KEYS).join(' ')}
  scroll <pixels>             negative scrolls up
  where                       print last cursor position
  doctor                      check the session is reachable
  skills list                 list bundled docs
  skills get core [--full]    print the agent guide

OPTIONS
  --session <name>   agent-browser session (default: $AGENT_HANDS_SESSION or work)
  --speed <n>        1 = human, 1.6 = brisk, 0.7 = slow
  --json             machine-readable output — for agents
  --quiet            exit code only

WHEN TO USE THIS  (escalate, do not start here)
  1. Default — throwaway browser, no profile, no logins:
       agent-browser --session scratch open <url>
     Public pages, research, scraping. Most work belongs here.
  2. Logged-in profile — only when the task needs the user's account:
       agent-browser --session work ... open <url> --headed
  3. agent-hands — only when 2 applies AND the site can ban the account,
     or agent-browser's instant input is being rejected.
  Using this on a throwaway session buys nothing. There is no account to lose.

NOTES
  Never moves the physical cursor and never raises the window.
  Prefer a CSS selector; --text is ranked but a page with several matching
  controls can still resolve the wrong one. Get selectors from
  \`agent-browser --session <s> snapshot -i\`.
  Submit forms with \`press Enter\` rather than hunting for a submit button.
  Inside an iframe, --text and CSS selectors fail: page JS cannot cross the
  boundary. Use --ref with a ref from \`agent-browser snapshot -i\`, which
  carries frame context. --ref scrolls the element into view first.
  Refs go stale on every page change. Re-snapshot before reusing one.
  Google sign-in refuses any CDP-driven browser. That is a browser check, not
  a behaviour check, so this tool cannot help. Sign in by hand in a Chrome
  launched without a debugging port; the session then works here.

EXAMPLES
  export AGENT_HANDS_SESSION=work        # then omit --session everywhere
  agent-browser --session work snapshot -i
  agent-hands fill --ref @e63 "Auto-école Smoni"    # replaces existing text
  agent-hands click --ref @e64                      # re-resolves at click time
  agent-hands press Backspace --times 20
  agent-hands scroll 600 --json`;

function parseArgs(argv) {
  const out = { session: process.env.AGENT_HANDS_SESSION || 'work', speed: 1, json: false, quiet: false, _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') out.session = argv[++i];
    else if (a === '--speed') out.speed = Number(argv[++i]) || 1;
    else if (a === '--text') out.flags.text = argv[++i];
    else if (a === '--ref') out.flags.ref = argv[++i];
    else if (a === '--xy') { out.flags.x = Number(argv[++i]); out.flags.y = Number(argv[++i]); }
    else if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--full') out.flags.full = true;
    else if (a === '--times') out.flags.times = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--append') out.flags.append = true;
    else out._.push(a);
  }
  return out;
}

const NEEDS_TARGET = new Set(['move', 'hover', 'click', 'fill']);
const NEEDS_BROWSER = new Set([...NEEDS_TARGET, 'type', 'press', 'scroll', 'doctor']);

async function run(args, cmd, rest) {
  const { session, speed } = args;

  if (cmd === 'doctor') {
    const port = devtoolsPort(session);
    const cdp = await CDP.connect(session);
    const info = await browserInfo(port);
    const out = {
      session, profile: profileDir(session), port,
      browser: info.browser, headless: info.headless,
      url: cdp.url, cursor: readPos(session),
      title: await cdp.evaluate('document.title'),
      viewport: await cdp.evaluate('innerWidth + "x" + innerHeight'),
    };
    await cdp.drain(); cdp.close();
    const warn = out.headless
      ? '\n  ⚠ HEADLESS — logins will not survive here and Google sign-in is refused.'
        + `\n    relaunch: agent-browser --session ${session} --profile "${out.profile}" open <url> --headed`
      : '';
    return {
      data: out,
      human: `✓ ${session} ready — ${out.title || '(untitled)'} @ ${out.url}\n`
        + `  profile ${out.profile}\n`
        + `  browser ${out.browser}  port ${out.port}  viewport ${out.viewport}`
        + `  cursor ${out.cursor ? `${out.cursor.x},${out.cursor.y}` : 'unset'}${warn}`,
    };
  }

  const cdp = await CDP.connect(session);
  try {
    const hasXY = Number.isFinite(args.flags.x);
    const target = hasXY
      ? { x: args.flags.x, y: args.flags.y, w: 12, h: 12, tag: 'XY' }
      : args.flags.ref ? resolveRef(session, args.flags.ref)
      : (NEEDS_TARGET.has(cmd) ? await resolveTarget(cdp, { selector: rest[0], text: args.flags.text }) : null);
    const at = target && `(${Math.round(target.x)},${Math.round(target.y)})`;

    switch (cmd) {
      case 'move': {
        const m = await moveTo(cdp, session, target, target.w, speed);
        return { data: { ...m, x: target.x, y: target.y }, human: `✓ move -> ${at} ${m.points} pts / ${m.ms}ms${m.overshoot ? ' +correction' : ''}` };
      }
      case 'hover': {
        const m = await moveTo(cdp, session, target, target.w, speed);
        return { data: { ...m, tag: target.tag }, human: `✓ hover ${target.tag} at ${at} ${m.points} pts / ${m.ms}ms` };
      }
      case 'click': {
        const m = await clickAt(cdp, session, target, target.w, speed);
        return { data: { ...m, tag: target.tag }, human: `✓ click ${target.tag} at ${at} ${m.points} pts / ${m.ms}ms${m.overshoot ? ' +correction' : ''}` };
      }
      case 'type': {
        const t = await typeText(cdp, rest[0] ?? '', speed);
        return { data: t, human: `✓ type ${t.chars} chars / ${t.ms}ms` };
      }
      case 'fill': {
        await clickAt(cdp, session, target, target.w, speed);
        await sleep(lognormal(180, 0.4, 500));
        const replaced = !args.flags.append;
        // A click puts the caret where it landed, mid-text. Select all to
        // overwrite, or jump to the end so --append really appends.
        if (replaced) await selectAll(cdp);
        else await pressKey(cdp, 'End', speed);
        // With --ref or --xy there is no selector positional, so the text is first.
        const text = (args.flags.ref || hasXY ? rest[0] : rest[1]) ?? '';
        const t = await typeText(cdp, text, speed);
        return {
          data: { ...t, tag: target.tag, replaced },
          human: `✓ fill ${target.tag} at ${at} — ${replaced ? 'replaced' : 'appended'} ${t.chars} chars / ${t.ms}ms`,
        };
      }
      case 'press': {
        const times = args.flags.times ?? 1;
        for (let i = 0; i < times; i++) await pressKey(cdp, rest[0], speed);
        return { data: { key: rest[0], times }, human: `✓ press ${rest[0]}${times > 1 ? ` x${times}` : ''}` };
      }
      case 'scroll': {
        const s = await scrollBy(cdp, Number(rest[0] ?? 400), speed);
        return { data: s, human: `✓ scroll ${s.pixels}px / ${s.ms}ms -> y=${s.y}` };
      }
    }
  } finally {
    await cdp.drain();
    cdp.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return console.log(USAGE);
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') return console.log(VERSION);

  if (cmd === 'skills') {
    const [sub, topic] = rest;
    if (sub === 'list') return console.log(listSkills().join('\n'));
    if (sub === 'get') return console.log(getSkill(topic || 'core', args.flags.full));
    console.error('usage: agent-hands skills list | agent-hands skills get core [--full]');
    process.exitCode = 2;
    return;
  }

  if (cmd === 'where') {
    const p = readPos(args.session);
    if (args.json) return console.log(JSON.stringify(p ?? null));
    return console.log(p ? `${p.x},${p.y}` : 'unset (no gesture yet in this session)');
  }

  if (!NEEDS_BROWSER.has(cmd)) {
    console.error(`unknown command "${cmd}"\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const result = await run(args, cmd, rest);
  if (args.quiet) return;
  console.log(args.json ? JSON.stringify({ ok: true, command: cmd, ...result.data }) : result.human);
}

main().catch(err => {
  const usage = err.code === 'EUSAGE';
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: false, error: err.message, code: err.code ?? 'EFAIL' }));
  } else {
    console.error('✗ ' + err.message);
  }
  process.exitCode = usage ? 2 : 1;
});
