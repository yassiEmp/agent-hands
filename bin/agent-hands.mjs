#!/usr/bin/env node
// agent-hands — human-rate mouse and keyboard for an agent-browser session.
//
// Exit codes: 0 ok, 1 runtime failure, 2 usage error, 3 challenge unresolved.

import { readFileSync, createReadStream } from 'node:fs';
import readline from 'node:readline';
import { CDP, devtoolsPort, profileDir, browserInfo, resolveEndpoint } from '../cli/cdp.mjs';
import { moveTo, clickAt, typeText, pressKey, scrollBy, resolveTarget, resolveRef, selectAll, readPos, KEYS } from '../cli/gestures.mjs';
import { listSkills, getSkill } from '../cli/skills.mjs';
import { sleep, lognormal } from '../cli/motion.mjs';
import { staleness, banner, updateField, update, fetchLatest, cacheIsStale } from '../cli/version.mjs';
import { tail } from '../cli/audit.mjs';
import { capture, save, render, locate } from '../cli/snapshot.mjs';
import { survey, render as renderBrowsers } from '../cli/browsers.mjs';
import { check as checkChallenge, render as renderChallenge, waitUntilCleared } from '../cli/challenge.mjs';
import { launch, browserChoices } from '../cli/launch.mjs';
import { loginFlow } from '../cli/login.mjs';

// Read from the manifest. A hardcoded constant drifted from package.json twice
// and npm rejected the publish as a duplicate both times.
const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

const USAGE = `agent-hands ${VERSION} — human-rate input for a real browser

USAGE
  agent-hands <command> [args] [--session <name>] [--speed <n>] [--json]

START HERE  (agents: this is the whole loop)
  1. agent-hands browsers                  which browsers exist, which answer
  2. ask the user which one, if more than one answers
  3. agent-hands snapshot --browser edge   see the page, get @e1 @e2 refs
  4. agent-hands click --ref @e5 ...       act on what you saw

  Do every step through this CLI. Writing a raw CDP or Playwright script against
  the same browser dispatches input at machine speed, which is what bot
  detection looks for, and it bypasses the relay that holds the single approved
  connection — so it re-prompts the user and leaves no audit trail. If a command
  you need is missing, say so; do not route around it.

COMMANDS
  launch <url>                start a browser with the right flags, print its port
  login [--dry-run]           sign in through the OS layer, before CDP attaches
  run [--file f] [--gap ms]   MANY commands, ONE connection - see BATCH below
  browsers                    list every browser and whether it is reachable
  snapshot [--max <n>]        ref-labelled tree of what is on the page
  text [selector]             read visible text (default: body)
  challenge                   is an anti-bot challenge blocking this page?
  open <url>                  navigate this tab and wait for load
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
  update [--yes]              report a newer version; --yes applies it
  audit [--times <n>]         who authorised and drove this browser, and when
  skills list                 list bundled docs
  skills get core [--full]    print the agent guide

OPTIONS
  --session <name>   agent-browser session (default: $AGENT_HANDS_SESSION or work)
  --browser <name>   a browser you launched yourself, see below
  --user-data-dir <path>  any other Chromium build
  --cdp <port|url>   an explicit endpoint, or $AGENT_HANDS_CDP
  --tab <match>      choose the tab by title or url
  --no-activate      never bring a frozen tab to the front; error instead
  --speed <n>        1 = human, 1.6 = brisk, 0.7 = slow
  --pause-on-challenge   stop on an anti-bot challenge and wait for the human
  --challenge-wait <s>   how long to wait for you to clear it (default 180)
  --json             machine-readable output — for agents
  --quiet            exit code only

YOUR OWN BROWSER
  Chrome and Edge 144+ expose remote debugging without --remote-debugging-port.
  Open chrome://inspect/#remote-debugging or edge://inspect/#remote-debugging and
  tick "Allow remote debugging for this browser instance", then:

    agent-hands doctor --browser edge

  Browsers: chrome, chrome-beta, chrome-dev, chrome-canary, edge, edge-beta,
  edge-dev, edge-canary, chromium, brave, vivaldi. Anything else works with
  --user-data-dir. Paths are known for Windows, macOS and Linux.

  That endpoint serves no /json/* routes, so targets are read over the browser
  websocket instead. The browser asks you to authorize each new CDP connection
  and the approval cannot be persisted, so one background relay holds the single
  socket: you approve once per browser run, not once per command.

  A hidden tab is driven in place and keeps your foreground. A tab frozen by
  the browser's memory saver cannot answer at all; it is woken by bringing it
  forward for a moment, then your previous tab is restored. --no-activate turns
  that into an error.

  \`agent-hands snapshot\` works here and mints its own refs, stored per browser,
  so --ref works on your own browser too. Refs are bound to the tab they came
  from: navigate or switch tab and a stale ref refuses to click rather than
  hitting the wrong element. Re-snapshot after anything that changes the page.

BATCH  (use this for anything more than 2-3 steps)
  Every command pays a process start and a connect. "run" pays both once and
  streams NDJSON results, one per line, in order.

    printf '%s\n' 'open https://example.com' 'snapshot' 'text h1' \
      | agent-hands run --browser edge

  A batch line is just CLI arguments, so there is no new syntax to learn and
  every command above works unchanged. JSON lines work too, for generated input:
    {"cmd":"click","ref":"@e17"}
    {"cmd":"fill","args":["#q","hello"]}

  Blank lines and # comments are skipped. One failing line does not stop the
  batch: it emits {"ok":false,...} and the run continues. --stop-on-error
  changes that. Exit code is the worst line's.

  Human pacing still applies between input commands. Separate processes used to
  leave a natural gap; batching removes it, so a small pause is inserted (--gap
  ms, default 250, 0 disables). Reads are exempt - they emit no input event.

SIGNING IN  (UIA before CDP, never the other way round)
  Attaching CDP sets navigator.webdriver, and a login form is the worst moment
  to carry it. So authenticate through the OS accessibility layer with nothing
  attached, and connect CDP only afterwards.

    agent-hands launch https://example.com/login --browser edge --profile work
    agent-hands login --window "example" --email-env EMAIL --password-env PASSWORD
    agent-hands snapshot --cdp <port>          # now attach, and carry on

  launch passes the flags that matter: --force-renderer-accessibility (without
  it Chromium builds no page tree and the OS lane sees only toolbar),
  --disable-blink-features=AutomationControlled (removes navigator.webdriver at
  the source), a dedicated profile, and the URL as an argument rather than a
  later navigation.

  login reads any standard form: an identifier field, a password field, an
  optional "remember me", one submit button, matched by role then by name across
  languages. Two-step forms that ask for the identifier first are handled. If it
  is already signed in it says so and does nothing.

  CREDENTIALS NEVER GO IN ARGV. A value passed as --password lands in shell
  history and in the process list, readable by anything running as you.
    --email-env NAME --password-env NAME      read from the environment
    --password-stdin                          read one line from stdin
  --dry-run reports the form it found and types nothing.

  A challenge (Turnstile, hCaptcha) is detected and handed to you, never solved:
  a programmatic click leaves no pointer trace, which scores worse than not
  clicking, and the account is what pays. Exit 3 if it is still there.

CHALLENGES
  A Cloudflare, DataDome, HUMAN, Akamai or captcha wall is not something this
  tool tries to defeat. Those stacks score behaviour and correlate identity
  across sites, so a forged pass is temporary and costs the account it was
  spent on. You are already signed in as yourself, so the cheap move is to let
  the user click it.
    agent-hands challenge                       # is one blocking this page?
    agent-hands open <url> --pause-on-challenge # stop, tell them, resume
  Exit 3 means it was still there when the wait ran out. Nothing was bypassed.

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
    else if (a === '--browser') out.browser = argv[++i];
    else if (a === '--cdp') out.cdp = argv[++i];
    else if (a === '--user-data-dir') out.userDataDir = argv[++i];
    else if (a === '--tab') out.tab = argv[++i];
    else if (a === '--no-activate') out.activate = false;
    else if (a === '--speed') out.speed = Number(argv[++i]) || 1;
    else if (a === '--text') out.flags.text = argv[++i];
    else if (a === '--ref') out.flags.ref = argv[++i];
    else if (a === '--xy') { out.flags.x = Number(argv[++i]); out.flags.y = Number(argv[++i]); }
    else if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--full') out.flags.full = true;
    else if (a === '--times') out.flags.times = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--max') out.flags.max = Math.max(1, Number(argv[++i]) || 300);
    else if (a === '--append') out.flags.append = true;
    else if (a === '--yes' || a === '-y') out.flags.yes = true;
    else if (a === '--no-update-check') out.flags.noUpdateCheck = true;
    else if (a === '--pause-on-challenge') out.flags.pauseOnChallenge = true;
    else if (a === '--gap') out.flags.gap = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--file') out.flags.file = argv[++i];
    else if (a === '--stop-on-error') out.flags.stopOnError = true;
    else if (a === '--email') out.flags.email = argv[++i];
    else if (a === '--email-env') out.flags.emailEnv = argv[++i];
    else if (a === '--password') out.flags.password = argv[++i];
    else if (a === '--password-env') out.flags.passwordEnv = argv[++i];
    else if (a === '--password-stdin') out.flags.passwordStdin = true;
    else if (a === '--window') out.flags.window = argv[++i];
    else if (a === '--profile') out.flags.profile = argv[++i];
    else if (a === '--port') out.flags.port = Number(argv[++i]) || 0;
    else if (a === '--no-remember') out.flags.noRemember = true;
    else if (a === '--dry-run') out.flags.dryRun = true;
    else if (a === '--challenge-wait') out.flags.challengeWait = Math.max(5, Number(argv[++i]) || 180);
    else out._.push(a);
  }
  return out;
}

const CHALLENGE_WAIT_DEFAULT = 180000;
const NEEDS_TARGET = new Set(['move', 'hover', 'click', 'fill']);
const NEEDS_BROWSER = new Set([...NEEDS_TARGET, 'type', 'press', 'scroll', 'doctor', 'snapshot', 'text', 'open', 'challenge']);

async function run(args, cmd, rest, shared) {
  const { session, speed } = args;
  const CHALLENGE_WAIT = args.flags.challengeWait ? args.flags.challengeWait * 1000 : CHALLENGE_WAIT_DEFAULT;
  const endpoint = {
    session, cdp: args.cdp, browser: args.browser, userDataDir: args.userDataDir,
    tab: args.tab, activate: args.activate !== false,
  };
  const external = Boolean(args.cdp || args.browser || args.userDataDir);
  const label = args.browser || args.userDataDir || (args.cdp ? `cdp ${args.cdp}` : session);

  if (cmd === 'doctor') {
    const { port } = resolveEndpoint(endpoint);
    const cdp = shared ?? await CDP.connect(endpoint);
    // /json/version does not exist on a 144+ endpoint. Ask the browser itself.
    const info = await browserInfo(cdp.sessionId ? cdp : port);
    const out = {
      session: label, profile: external ? null : profileDir(session), port,
      browser: info.browser, headless: info.headless,
      url: cdp.url, cursor: readPos(session),
      title: await cdp.evaluate('document.title'),
      viewport: await cdp.evaluate('innerWidth + "x" + innerHeight'),
    };
    if (!shared) { await cdp.drain(); cdp.close(); }
    const warn = out.headless
      ? '\n  ⚠ HEADLESS — logins will not survive here and Google sign-in is refused.'
        + `\n    relaunch: agent-browser --session ${session} --profile "${profileDir(session)}" open <url> --headed`
      : '';
    return {
      data: out,
      human: `✓ ${label} ready — ${out.title || '(untitled)'} @ ${out.url}\n`
        + `  ${out.profile ? `profile ${out.profile}` : 'external browser — you launched it, not agent-browser'}\n`
        + `  browser ${out.browser}  port ${out.port}  viewport ${out.viewport}`
        + `  cursor ${out.cursor ? `${out.cursor.x},${out.cursor.y}` : 'unset'}${warn}`,
    };
  }

  const cdp = shared ?? await CDP.connect(endpoint);
  try {
    const hasXY = Number.isFinite(args.flags.x);
    // A ref belongs to the browser it was captured from. Passing `session` here
    // sent every external-browser lookup to the pool, because session defaults
    // to "work" even when --browser points elsewhere.
    const target = hasXY
      ? { x: args.flags.x, y: args.flags.y, w: 12, h: 12, tag: 'XY' }
      : args.flags.ref
        ? (cdp.external ? await locate(cdp, cdp.key, args.flags.ref, { speed })
                        : resolveRef(session, args.flags.ref))
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

      // Reading and navigating belong here for one reason: agent-browser cannot
      // attach to an external browser at all. Without these an agent hits a wall
      // mid-task and reaches for a raw script, which is the failure this CLI
      // exists to prevent. For a pooled session agent-browser is still better.
      case 'text': {
        const sel = rest[0] || 'body';
        const t = await cdp.evaluate(
          `(document.querySelector(${JSON.stringify(sel)})?.innerText || '')`
            + `.replace(/\\n{3,}/g, '\\n\\n').slice(0, ${args.flags.max ?? 20000})`);
        if (t == null || t === '') {
          throw Object.assign(new Error(`no element matches "${sel}", or it has no text.`),
            { code: 'EUSAGE' });
        }
        return { data: { selector: sel, chars: t.length, text: t }, human: t };
      }

      case 'open': {
        const url = rest[0];
        if (!url) throw Object.assign(new Error('open needs a url'), { code: 'EUSAGE' });
        await cdp.send('Page.navigate', { url }, cdp.sessionId ?? undefined);
        // Settle before returning: an agent that snapshots immediately would
        // otherwise capture the old page and mint refs that cannot resolve.
        let now = '';
        for (let i = 0; i < 20; i++) {
          await sleep(250);
          now = await cdp.evaluate('document.readyState + "|" + location.href');
          if (String(now).startsWith('complete')) break;
        }
        const href = String(now).split('|')[1] || url;

        if (args.flags.pauseOnChallenge) {
          const v = await checkChallenge(cdp);
          if (v.challenged) {
            // stderr: the human reads this while stdout stays the command's result.
            console.error(renderChallenge(v));
            console.error(`\n  waiting up to ${Math.round(CHALLENGE_WAIT / 1000)}s for you to clear it…`);
            const done = await waitUntilCleared(cdp, {
              timeoutMs: CHALLENGE_WAIT, log: m => console.error(m),
            });
            if (!done) {
              throw Object.assign(new Error(
                `challenge still present after ${Math.round(CHALLENGE_WAIT / 1000)}s — ${
                  v.blocking.map(b => b.vendor).join(', ')}.\n` +
                `  Clear it in the browser, then re-run. Nothing was bypassed.`
              ), { code: 'ECHALLENGE' });
            }
            return { data: { url: href, challenge: { vendor: v.blocking.map(b => b.vendor), cleared: true } },
                     human: `✓ open ${href}  (challenge cleared by you)` };
          }
        }
        return { data: { url: href }, human: `✓ open ${href}` };
      }

      case 'challenge': {
        const v = await checkChallenge(cdp);
        if (v.challenged) process.exitCode = 3;
        return { data: v, human: renderChallenge(v) };
      }

      case 'snapshot': {
        const snap = await capture(cdp, { max: args.flags.max ?? 300 });
        save(cdp.key, snap);
        const refs = Object.entries(snap.refs).map(([ref, e]) => ({
          ref, tag: e.tag, type: e.type, role: e.role, name: e.name,
          x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h),
          off: e.off, disabled: e.disabled,
        }));
        return {
          data: { url: snap.url, title: snap.title, count: refs.length,
                  truncated: snap.truncated, refs },
          human: render(snap),
        };
      }
    }
  } finally {
    if (!shared) { await cdp.drain(); cdp.close(); }
  }
}

// ---------------------------------------------------------------- batch ----

// Read-only verbs emit no input event, so no site can observe their timing and
// nothing needs pacing before them.
const READ_ONLY = new Set(['text', 'snapshot', 'doctor', 'challenge', 'where']);

// A batch line is just CLI arguments. That is the whole design: an agent that
// can use this CLI can already write a batch, and every verb added later works
// here for free with no extra wiring.
//
//   text h1
//   click --ref @e17
//   open https://example.com
//
// JSON is accepted too, for callers generating lines programmatically:
//   {"cmd":"click","ref":"@e17"}
//   {"cmd":"text","args":["h1"]}
function lineToArgv(line) {
  const t = line.trim();
  if (!t.startsWith('{')) return tokenize(t);
  const o = JSON.parse(t);
  if (!o.cmd) throw Object.assign(new Error('batch line needs "cmd"'), { code: 'EUSAGE' });
  const argv = [o.cmd];
  const positional = o.args == null ? [] : (Array.isArray(o.args) ? o.args : [o.args]);
  argv.push(...positional.map(String));
  for (const [k, v] of Object.entries(o)) {
    if (k === 'cmd' || k === 'args' || v === false || v == null) continue;
    const flag = '--' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    if (k === 'xy' && Array.isArray(v)) { argv.push('--xy', String(v[0]), String(v[1])); continue; }
    if (v === true) argv.push(flag);
    else argv.push(flag, String(v));
  }
  return argv;
}

// Shell-lite: quotes group, nothing else is special. Enough for a CLI line and
// small enough to reason about; anything harder should use the JSON form.
function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Credentials never come from argv by default: a value passed on the command
// line lands in shell history and in every process listing on the machine.
function readSecret(args, kind) {
  const envName = args.flags[`${kind}Env`];
  if (envName) {
    const v = process.env[envName];
    if (!v) throw Object.assign(new Error(`${envName} is empty or unset`), { code: 'EUSAGE' });
    return v;
  }
  const direct = args.flags[kind];
  if (direct) {
    if (kind === 'password') {
      console.error('⚠ --password puts the secret in shell history and in the process list,\n' +
                    '  where any process running as you can read it. Prefer --password-env NAME.');
    }
    return direct;
  }
  return null;
}

async function readStdinSecret() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').split('\n')[0].trim();
}

async function runBatch(args) {
  const endpoint = {
    session: args.session, cdp: args.cdp, browser: args.browser,
    userDataDir: args.userDataDir, tab: args.tab, activate: args.activate !== false,
  };
  // Connect BEFORE opening the reader. A readline interface starts consuming
  // immediately, so building it first meant the file drained into a listener
  // that did not exist yet while we awaited the socket, and every line was lost.
  const cdp = await CDP.connect(endpoint);
  const source = args.flags.file ? createReadStream(args.flags.file) : process.stdin;
  const rl = readline.createInterface({ input: source, crlfDelay: Infinity });
  const gap = args.flags.gap ?? 250;
  let i = -1, worst = 0, lastInput = false;

  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      i++;
      let out;
      try {
        const argv = lineToArgv(line);
        // Parse exactly as main() does, so a batch line behaves identically to
        // the same words typed on the command line.
        const la = parseArgs(argv);
        const [cmd, ...rest] = la._;
        // Connection belongs to the batch, never to a line: reusing one socket
        // is the whole point, and a per-line endpoint would defeat it.
        la.session = args.session; la.cdp = args.cdp; la.browser = args.browser;
        la.userDataDir = args.userDataDir; la.tab = args.tab; la.activate = args.activate;
        if (!argv.includes('--speed')) la.speed = args.speed;
        la.json = true;

        if (!NEEDS_BROWSER.has(cmd)) {
          throw Object.assign(new Error(`"${cmd}" is not a batch command`), { code: 'EUSAGE' });
        }
        // Pace between inputs. Separate processes used to leave a natural gap;
        // batching removes it, and a burst of clicks with no pause is exactly
        // the signal this tool exists to avoid. Reads are exempt.
        const isInput = !READ_ONLY.has(cmd);
        if (isInput && lastInput && gap > 0) await sleep(lognormal(gap, 0.28, gap * 3));
        lastInput = isInput;

        const r = await run(la, cmd, rest, cdp);
        out = { i, ok: true, command: cmd, ...r.data };
      } catch (e) {
        out = { i, ok: false, command: line.slice(0, 40), error: e.message, code: e.code ?? 'EFAIL' };
        worst = Math.max(worst, EXIT[e.code] ?? 1);
        if (args.flags.stopOnError) { process.stdout.write(JSON.stringify(out) + '\n'); break; }
      }
      process.stdout.write(JSON.stringify(out) + '\n');
    }
  } finally {
    await cdp.drain();
    cdp.close();
    rl.close();
  }
  process.exitCode = worst;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;

  // Every exit path gets the notice, including `skills`, `where` and errors.
  // A stale copy is most dangerous exactly when an agent is reading the docs
  // or hitting an error, because that is when it decides the tool cannot help.
  if (!args.flags.noUpdateCheck && cmd !== 'update') {
    const st = staleness();
    if (st.stale) process.on('exit', () => console.error(banner(st)));
  }

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

  if (cmd === 'launch') {
    const r = await launch({
      url: rest[0], browser: args.browser || 'edge',
      profile: args.flags.profile, port: args.flags.port ?? 0,
      log: m => { if (!args.json) console.error(m); },
    });
    if (args.json) return console.log(JSON.stringify({ ok: true, command: 'launch', ...r }));
    return console.log(
      `✓ ${r.browser} up on port ${r.port}
` +
      `  profile ${r.profile}
` +
      `  next:   agent-hands snapshot --cdp ${r.port}
` +
      `          agent-hands login --cdp ${r.port} --email-env EMAIL --password-env PASSWORD`);
  }

  if (cmd === 'login') {
    const email = readSecret(args, 'email');
    const password = args.flags.passwordStdin ? await readStdinSecret() : readSecret(args, 'password');
    if (!args.flags.dryRun && (!email || !password)) {
      throw Object.assign(new Error([
        'login needs an identifier and a password.',
        '  safest:  agent-hands login --email-env EMAIL --password-env PASSWORD',
        '  or:      echo "$PW" | agent-hands login --email you@example.com --password-stdin',
        '  --dry-run inspects the form without typing anything.',
      ].join('\n')), { code: 'EUSAGE' });
    }
    const r = await loginFlow({
      windowMatch: args.flags.window || args.tab, email, password,
      remember: !args.flags.noRemember, dryRun: args.flags.dryRun,
      challengeWaitMs: (args.flags.challengeWait ?? 180) * 1000,
      log: m => console.error('  ' + m),
    });
    if (r.state === 'challenge-unresolved') process.exitCode = 3;
    if (args.json) {
      return console.log(JSON.stringify({ ok: r.state !== 'challenge-unresolved', command: 'login', ...r }));
    }
    if (r.found) {
      return console.log(`window: ${r.window}\n${r.found}` + (r.challenge ? `\n  challenge: ${r.challenge}` : ''));
    }
    return console.log(`✓ ${r.state}${r.window ? ' — ' + r.window : ''}`);
  }

  if (cmd === 'run') return runBatch(args);

  if (cmd === 'browsers') {
    const rows = await survey();
    if (args.json) return console.log(JSON.stringify({ ok: true, command: 'browsers', browsers: rows }));
    return console.log(renderBrowsers(rows));
  }

  if (cmd === 'audit') {
    const { port, browserPath } = resolveEndpoint({
      session: args.session, cdp: args.cdp, browser: args.browser, userDataDir: args.userDataDir,
    });
    const rows = tail(`ws://127.0.0.1:${port}${browserPath ?? ''}`, args.flags.times ?? 50);
    if (args.json) return console.log(JSON.stringify({ ok: true, command: 'audit', events: rows }));
    if (!rows.length) return console.log('no audit events for this browser yet.');
    return console.log(rows.map(r =>
      `${r.t}  ${r.ev.padEnd(15)} ${r.cmd ?? r.msg ?? r.err ?? (r.pid ? `pid ${r.pid}` : '')}`).join('\n'));
  }

  if (cmd === 'update') {
    const result = await update({ yes: args.flags.yes, json: args.json });
    if (result.data.ok === false) process.exitCode = 1;
    return console.log(args.json ? JSON.stringify({ ok: result.data.ok !== false, command: 'update', ...result.data })
                                 : result.human);
  }

  if (!NEEDS_BROWSER.has(cmd)) {
    console.error(`unknown command "${cmd}"\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  // doctor is the one command where registry latency is acceptable, so it is
  // what keeps the cache warm for every gesture command.
  if (cmd === 'doctor' && !args.flags.noUpdateCheck && cacheIsStale()) await fetchLatest();

  const result = await run(args, cmd, rest);
  if (args.quiet) return;

  const upd = args.flags.noUpdateCheck ? null : updateField(staleness());
  if (args.json) {
    console.log(JSON.stringify({ ok: true, command: cmd, ...result.data, ...(upd ? { update: upd } : {}) }));
  } else {
    console.log(result.human);
  }
}

// 3 is its own code so a caller can tell "a human needs to click something"
// apart from a real failure, and retry instead of giving up.
const EXIT = { EUSAGE: 2, ECHALLENGE: 3 };

main().catch(err => {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: false, error: err.message, code: err.code ?? 'EFAIL' }));
  } else {
    console.error('✗ ' + err.message);
  }
  process.exitCode = EXIT[err.code] ?? 1;
});
