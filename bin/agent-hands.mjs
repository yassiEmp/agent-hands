#!/usr/bin/env node
// agent-hands — human-rate mouse and keyboard for an agent-browser session.
//
// Exit codes: 0 ok, 1 runtime failure, 2 usage error, 3 challenge unresolved,
// 4 sign-in page while flagged, 5 several browsers live (ask the user), 6 dead pin.

import { readFileSync, createReadStream } from 'node:fs';
import readline from 'node:readline';
import { CDP, devtoolsPort, profileDir, browserInfo, resolveEndpoint } from '../cli/cdp.mjs';
import { moveTo, clickAt, typeText, pressKey, scrollBy, resolveTarget, resolveRef, selectAll, readPos, KEYS } from '../cli/gestures.mjs';
import { listSkills, getSkill } from '../cli/skills.mjs';
import { sleep, lognormal } from '../cli/motion.mjs';
import { staleness, banner, updateField, update, fetchLatest, cacheIsStale } from '../cli/version.mjs';
import { tail } from '../cli/audit.mjs';
import { capture, save, render, locate, load as loadSnapshot } from '../cli/snapshot.mjs';
import { survey, render as renderBrowsers } from '../cli/browsers.mjs';
import { check as checkChallenge, render as renderChallenge, waitUntilCleared } from '../cli/challenge.mjs';
import { load as loadConfig, save as saveConfig, clear as clearConfig, agentId, mintId,
         pinFrom, stamp, conflict } from '../cli/config.mjs';
import { resolve as resolveTargetCfg, endpointFor, flagFor } from '../cli/target.mjs';
import { probeEndpoint } from '../cli/browsers.mjs';
import { launch, browserChoices } from '../cli/launch.mjs';
import { loginFlow } from '../cli/login.mjs';
import { inspect as inspectPage, verdict, explain as explainGuard } from '../cli/guard.mjs';

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
  use [<n>|--cdp <port>]      pin a browser; later commands need no target flag
  launch <url>                start a browser with the right flags, print its port
  login @e2 @e3 @e5           fill a form with refs YOU chose; see SIGNING IN
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

STATE  (stop retyping the target)
  Pin a browser once and later commands need no target flag.

    agent-hands browsers        see what is live
    agent-hands use 2           pin number 2 (ask the user first, if unsure)
    agent-hands snapshot        no --cdp, no --browser
    agent-hands use             show what is pinned, and where the file is
    agent-hands use --clear     drop it

  Written to ./.agent-hands/config.json, found by walking up from the working
  directory. --global writes ~/.agent-hands/config.json instead.

  Three rules keep hidden state from becoming a hidden bug:
    An explicit flag ALWAYS wins, so the escape hatch never disappears.
    A pin is verified live before use. A dead one REFUSES and names the fix,
      it never falls back to another browser - silent fallback is the bug.
    Every result reports how it resolved: "via":"flag"|"pin"|"only-one".

  With several browsers live and nothing pinned, commands STOP and list them
  rather than choosing. That is the moment to ask the user which one.

  IDENTITY. Pins are per project and per agent. The agent id is discovered from
  the environment (any var named like *_SESSION_ID, *_CONVERSATION_ID), so it
  works on any harness, not just one. No harness exposes a PER-SUBAGENT id -
  measured: two sibling subagents share every environment variable, and it is an
  open request on claude-code #36981 and codex #20852. So parallel subagents
  that need DIFFERENT browsers must each set one:

    AGENT_HANDS_ID=sweep-3

  A parent assigning browsers to subagents is the natural place for it. Without
  it they share one pin, which is correct for delegation and wrong for a
  parallel sweep; replacing another writer's fresh pin prints a warning saying
  exactly this.

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

SIGNING IN
  Sign-in is where a site grades hardest, so the CLI guards it for you.

  Any command that lands on a sign-in page while the browser is advertising
  automation DISCONNECTS and tells you, instead of working there:

    $ agent-hands text body --cdp 9555
    x this is a sign-in page and the browser is advertising automation
      navigator.webdriver = true   file:///.../login.html
      Pick one: relaunch clean, use the OS lane, or --force

  It measures rather than assumes: it reads navigator.webdriver on the page in
  front of it. A browser started by "agent-hands launch" reports false, so the
  guard never fires and CDP is safe there. Exit 4. --force overrides.

  THE CLI NEVER GUESSES WHICH BOX IS WHICH. A form can label its fields anything
  in any language, and a wrong guess types a password into something that is not
  a password field. So YOU read the page and name the refs:

    agent-hands snapshot --cdp 9444
      @e2 [input type="email"] "Email address"
      @e3 [input type="password"] "Password"
      @e5 [button type="submit"] "Log in"

    agent-hands login @e2 @e3 @e5        identifier, password, submit

  snapshot prints that exact command for you when it sees a form, with this
  page's refs already filled in.

  Credentials default to $AGENT_HANDS_EMAIL and $AGENT_HANDS_PASSWORD, so the
  line above is usually the whole command.

  CREDENTIALS NEVER GO IN ARGV. A value passed as --password lands in shell
  history and in the process list, readable by anything running as you.
    --email-env NAME --password-env NAME     read from the environment
    --password-stdin                         read one line from stdin
  Omit --submit-ref to fill without submitting. A challenge is detected before
  submit and handed to you, never solved.

  When the browser is one you did NOT launch and it carries the flag anyway,
  there is a second lane: "agent-hands login --window <title>" drives the OS
  accessibility layer with nothing attached. It needs Chromium to publish a page
  tree (--force-renderer-accessibility, which launch passes); it says so plainly
  when the tree is withheld.

CHALLENGES
  A Cloudflare, DataDome, HUMAN, Akamai or captcha wall is not something this
  tool tries to defeat. Those stacks score behaviour and correlate identity
  across sites, so a forged pass is temporary and costs the account it was
  spent on. You are already signed in as yourself, so the cheap move is to let
  the user click it.
    agent-hands challenge                       # is one blocking this page?
    agent-hands open <url> --pause-on-challenge # stop, tell them, resume
  Exit 3 means it was still there when the wait ran out. Nothing was bypassed.

WHICH TOOL
  agent-browser and agent-hands drive the same browser and do different jobs.

    agent-browser   pooled throwaway sessions it launches and owns, and its own
                    snapshot/tabs/cookies there. Instant input, which is fine
                    when there is no account to lose.
    agent-hands     any browser it can reach, INCLUDING one you launched
                    yourself or attached to, which agent-browser cannot open at
                    all. Human-rate input, refs, sign-in guard, pinning.

  Use agent-hands when the browser carries a real account, when the site scores
  behaviour, or when the browser is not one agent-browser started. On a
  throwaway session with no login, agent-browser is faster and nothing is at
  risk either way.

  Earlier versions of this help called agent-hands a last resort behind
  agent-browser. That stopped being true once it grew launch, open, snapshot
  and text: it is now a complete loop on its own.

NOTES
  Never moves the physical cursor and never raises the window.
  Prefer a CSS selector; --text is ranked but a page with several matching
  controls can still resolve the wrong one. Get selectors from
  \`agent-browser --session <s> snapshot -i\`.
  Submit forms with \`press Enter\` rather than hunting for a submit button.
  Inside an iframe, --text and CSS selectors fail: page JS cannot cross the
  boundary. Use --ref from \`agent-hands snapshot\`, which works on any browser
  this CLI can reach. --ref scrolls the element into view first.
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
    if (a === '--session') { out.session = argv[++i]; out.explicitSession = true; }
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
    else if (a === '--force') out.flags.force = true;
    else if (a === '--identifier-ref' || a === '-i') out.flags.identifierRef = argv[++i];
    else if (a === '--password-ref' || a === '-p') out.flags.passwordRef = argv[++i];
    else if (a === '--submit-ref' || a === '-s') out.flags.submitRef = argv[++i];
    else if (a === '--remember-ref' || a === '-r') out.flags.rememberRef = argv[++i];
    else if (a === '--no-hints') out.flags.noHints = true;
    else if (a === '--global') out.flags.global = true;
    else if (a === '--project') out.flags.projectScope = true;
    else if (a === '--clear') out.flags.clear = true;
    else if (a === '--challenge-wait') out.flags.challengeWait = Math.max(5, Number(argv[++i]) || 180);
    else out._.push(a);
  }
  return out;
}

const CHALLENGE_WAIT_DEFAULT = 180000;
// doctor is a diagnostic and must still answer on a login page; challenge is
// how you inspect one safely; login never attaches in the first place.
const GUARD_EXEMPT = new Set(['doctor', 'challenge', 'login', 'launch', 'browsers', 'audit', 'update', 'where']);
const NEEDS_TARGET = new Set(['move', 'hover', 'click', 'fill']);
const NEEDS_BROWSER = new Set([...NEEDS_TARGET, 'type', 'press', 'scroll', 'doctor', 'snapshot', 'text', 'open', 'challenge']);

async function run(args, cmd, rest, shared) {
  const { session, speed } = args;
  const CHALLENGE_WAIT = args.flags.challengeWait ? args.flags.challengeWait * 1000 : CHALLENGE_WAIT_DEFAULT;
// One resolution path for every command: flag > pin > only-live > default.
// Anything else and two call sites drift, which is how a command ends up
// driving a browser nobody chose.
const resolution = await resolveTargetCfg(args);
args._via = resolution.via;   // provenance, reported to the caller
const endpoint = { ...resolution.endpoint,
  ...(args.tab ? { tab: args.tab } : {}), activate: args.activate !== false };
  const external = Boolean(endpoint.cdp || endpoint.browser || endpoint.userDataDir);
  const label = endpoint.browser || endpoint.userDataDir
    || (endpoint.cdp ? `cdp ${endpoint.cdp}` : endpoint.session || session);

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
      human: `✓ ${label} ready [${args._via}] — ${out.title || '(untitled)'} @ ${out.url}\n`
        + `  ${out.profile ? `profile ${out.profile}` : 'external browser — you launched it, not agent-browser'}\n`
        + `  browser ${out.browser}  port ${out.port}  viewport ${out.viewport}`
        + `  cursor ${out.cursor ? `${out.cursor.x},${out.cursor.y}` : 'unset'}${warn}`,
    };
  }

  const cdp = shared ?? await CDP.connect(endpoint);
  // Sign-in guard. Runs once per connection, after attach and before the verb,
  // so a command that lands on a login page disconnects instead of working
  // there. `login` never attaches, `doctor` is diagnostic, and --force opts out.
  if (!shared && !args.flags.force && !GUARD_EXEMPT.has(cmd)) {
    const v = verdict(await inspectPage(cdp));
    if (v.block) {
      await cdp.drain(); cdp.close();
      throw Object.assign(new Error(explainGuard(v)), { code: 'ELOGINPAGE' });
    }
  }

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
        const lh = loginHint(snap);
        if (lh) hint(args, lh);
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
  const envName = args.flags[`${kind}Env`]
    || (process.env[kind === 'email' ? 'AGENT_HANDS_EMAIL' : 'AGENT_HANDS_PASSWORD'] !== undefined
        ? (kind === 'email' ? 'AGENT_HANDS_EMAIL' : 'AGENT_HANDS_PASSWORD') : null);
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

// Short form first. The long flags still work, but every extra character an
// agent has to type is another chance to mistype a ref, and a mistyped ref on a
// login form is the expensive kind of mistake.
//
//   agent-hands login @e2 @e3 @e5        identifier, password, submit
//   agent-hands login @e2 @e3            fill, do not submit
//
// Credentials default to $AGENT_HANDS_EMAIL / $AGENT_HANDS_PASSWORD so the
// common case needs no credential flags at all.
function loginRefs(args, rest) {
  const positional = rest.filter(a => /^@?e[0-9]+$/i.test(a));
  const norm = r => (r ? (r.startsWith('@') ? r : '@' + r) : null);
  return {
    identifier: norm(args.flags.identifierRef || positional[0]),
    password:   norm(args.flags.passwordRef   || positional[1]),
    submit:     norm(args.flags.submitRef     || positional[2]),
    remember:   norm(args.flags.rememberRef),
  };
}

// Sign in over CDP using refs the AGENT chose.
//
// No heuristic decides which box is which. A form can label its fields anything,
// in any language, and guessing wrong means typing a password into a field that
// is not one — the worst failure this tool could have. So the agent snapshots,
// reads the tree, and names the refs. The CLI does the typing at human rate and
// keeps the secret out of argv, logs and output.
//
// This lane needs the browser to be clean: the sign-in guard refuses to run here
// while navigator.webdriver is true, which is exactly when it would cost you.
async function loginViaCdp(args, cdp, speed, rest) {
  const refs = loginRefs(args, rest);
  if (!refs.identifier || !refs.password) {
    throw Object.assign(new Error([
      'login needs an identifier ref and a password ref.',
      '  agent-hands snapshot                 read the page and pick them',
      '  agent-hands login @e2 @e3 @e5        identifier, password, submit',
      '  (long form --identifier-ref/--password-ref/--submit-ref also works)',
    ].join('\n')), { code: 'EUSAGE' });
  }
  const idRef = refs.identifier;
  const pwRef = refs.password;
  const email = readSecret(args, 'email');
  const password = args.flags.passwordStdin ? await readStdinSecret() : readSecret(args, 'password');
  if (!email || !password) {
    throw Object.assign(new Error([
      'login needs an identifier and a password.',
      '  safest:  --email-env EMAIL --password-env PASSWORD',
      '  or:      echo "$PW" | agent-hands login ... --password-stdin',
    ].join('\n')), { code: 'EUSAGE' });
  }

  // Verify the agent's choice against what the snapshot recorded. Swapping two
  // refs is the easy mistake, and it is the expensive one: the email goes into
  // the password box and the password into a plain text input, which the page
  // may echo, log or submit in the clear. The types are already in the ref
  // store, so this costs nothing.
  const snap = loadSnapshot(cdp.key);
  const typeOf = r => snap?.refs?.[String(r).replace(/^@/, '')]?.type ?? null;
  const tagOf = r => snap?.refs?.[String(r).replace(/^@/, '')]?.tag ?? null;
  const pwType = typeOf(pwRef);
  const idType = typeOf(idRef);
  if (snap && pwType && pwType !== 'password') {
    throw Object.assign(new Error([
      `${pwRef} is not a password field (it is type="${pwType}").`,
      '  The password would be typed into a visible input, where the page can',
      '  echo, log or submit it in the clear. Refusing.',
      '  Order is: identifier, password, submit.',
      '  Re-read the page with: agent-hands snapshot',
    ].join('\n')), { code: 'EUSAGE' });
  }
  if (snap && idType === 'password') {
    throw Object.assign(new Error([
      `${idRef} is a password field, but it was given as the identifier.`,
      '  Order is: identifier, password, submit. Refusing.',
    ].join('\n')), { code: 'EUSAGE' });
  }
  if (snap && !pwType && tagOf(pwRef)) {
    console.error(`  note: ${pwRef} is a <${tagOf(pwRef)}> with no type; expected a password input.`);
  }

  const put = async (ref, value) => {
    const box = await locate(cdp, cdp.key, ref, { speed });
    await clickAt(cdp, args.session, box, box.w, speed);
    await sleep(lognormal(180, 0.4, 500));
    await selectAll(cdp);
    await typeText(cdp, value, speed);
    return box;
  };

  await put(idRef, email);
  await sleep(lognormal(320, 0.35, 900));
  await put(pwRef, password);

  if (refs.remember) {
    const box = await locate(cdp, cdp.key, refs.remember, { speed });
    await clickAt(cdp, args.session, box, box.w, speed);
  }

  // Checked after filling and before submitting, because a risk-adaptive widget
  // decides to appear exactly then. Never solved here.
  const v = verdict(await inspectPage(cdp));
  const ch = await checkChallenge(cdp);
  if (ch.challenged) {
    return { state: 'challenge', challenge: ch.blocking.map(b => b.vendor),
             human: renderChallenge(ch) + '\n\n  Filled but NOT submitted. Solve it, then re-run with --submit-only.' };
  }

  if (refs.submit) {
    await sleep(lognormal(400, 0.35, 1200));
    const box = await locate(cdp, cdp.key, refs.submit, { speed });
    await clickAt(cdp, args.session, box, box.w, speed);
    return { state: 'submitted', webdriver: v.webdriver === true };
  }
  return { state: 'filled', note: 'no submit ref given; filled but not submitted' };
}


// Hints: teach at the moment of use, not in a manual nobody opens.
//
// They go to stderr so --json stdout stays a single parseable object, and they
// carry the REAL refs from the page in front of you rather than placeholders,
// so the suggested command can be run exactly as printed.
function hint(args, lines) {
  if (args.flags.noHints || args.quiet) return;
  const body = Array.isArray(lines) ? lines : [lines];
  console.error(body.map(l => '  ' + l).join('\n'));
}

// A form is the one place a wrong guess is expensive, so when one is on screen
// the hint spells out the exact command with this page's refs already in it.
function loginHint(snap) {
  const refs = Object.entries(snap.refs);
  const pw = refs.find(([, e]) => e.type === 'password')?.[0];
  if (!pw) return null;
  // Only real fields. A <form> carries the concatenated text of everything
  // inside it, so matching on name alone proposes the form as the input box.
  const fields = refs.filter(([, e]) => /^(input|textarea|select)$/.test(e.tag) && e.type !== 'password');
  const id = fields.find(([, e]) => /email|user|login|identifiant|utilisateur/i
        .test(`${e.type || ''} ${e.name || ''} ${e.placeholder || ''}`))?.[0]
    || fields.find(([, e]) => e.type !== 'checkbox' && e.type !== 'submit')?.[0];
  const submit = refs.find(([, e]) => e.type === 'submit' || e.tag === 'button')?.[0];
  const remember = refs.find(([, e]) => e.type === 'checkbox')?.[0];
  const order = [id ?? 'eN', pw, submit].filter(Boolean).map(r => '@' + r).join(' ');
  return [
    'this page has a sign-in form. Fill it without guessing:',
    '  agent-hands login ' + order + '   (identifier, password, submit)',
    remember ? '  add -r @' + remember + ' to tick "remember me"' : null,
    'You pick the refs; the CLI types at human rate. Credentials come from',
    '$AGENT_HANDS_EMAIL and $AGENT_HANDS_PASSWORD, or --email-env/--password-env.',
    'Drop the last ref to fill without submitting.',
  ].filter(Boolean);
}

// `use` — pin a browser once, stop retyping it, and give the agent a way to put
// the choice in front of the human instead of guessing.
async function useCommand(args, rest) {
  const cwd = process.cwd();
  const scope = args.flags.global ? 'global' : args.flags.projectScope ? 'project' : 'agent';

  if (args.flags.clear) {
    const f = clearConfig({ scope, cwd });
    return console.log(f ? `✓ cleared the ${scope} pin (${f})` : 'nothing pinned here.');
  }

  // No argument: report, do not change. The pin must be discoverable in one
  // word, or it is hidden state and this feature is a net loss.
  if (!rest.length && !args.cdp && !args.browser && !args.userDataDir) {
    const { merged, id, projectPath, globalPath } = loadConfig(cwd);
    const lines = ['CURRENT'];
    lines.push(`  identity   ${id ?? '(none — pins are project-wide)'}`);
    lines.push(`  project    ${projectPath ?? '(no .agent-hands here; a pin would create one)'}`);
    lines.push(`  global     ${globalPath}`);
    if (merged.target) {
      const t = merged.target;
      lines.push(`  pinned     ${t.cdp ? `--cdp ${t.cdp}` : t.browser ? `--browser ${t.browser}`
        : t.session ? `--session ${t.session}` : t.userDataDir}`);
      if (t.profile) lines.push(`             profile ${t.profile}`);
      if (t.tab) lines.push(`             tab "${t.tab}"`);
    } else {
      lines.push('  pinned     nothing');
    }
    const others = Object.entries(merged).filter(([k]) => !k.startsWith('_') && k !== 'target');
    for (const [k, v] of others) lines.push(`  ${k.padEnd(10)} ${JSON.stringify(v)}`);
    lines.push('');
    lines.push('  agent-hands use <n>        pin one of the live browsers');
    lines.push('  agent-hands use --clear    drop it');
    return console.log(lines.join('\n'));
  }

  // Resolve what to pin: a number from the live list, or explicit flags.
  let endpoint, row = null;
  const n = Number(rest[0]);
  if (Number.isInteger(n) && n > 0) {
    const live = (await survey()).filter(r => r.state === 'running');
    row = live[n - 1];
    if (!row) {
      throw Object.assign(new Error(
        `there is no browser ${n}. ${live.length} live:\n` +
        live.map((r, i) => `  ${i + 1}  ${r.name}  ${flagFor(r)}`).join('\n')), { code: 'EUSAGE' });
    }
    endpoint = endpointFor(row);
  } else {
    endpoint = { ...(args.cdp && { cdp: args.cdp }), ...(args.browser && { browser: args.browser }),
                 ...(args.userDataDir && { userDataDir: args.userDataDir }) };
    if (!Object.keys(endpoint).length) {
      throw Object.assign(new Error(
        'nothing to pin. Give a number from `agent-hands browsers`, or a target:\n' +
        '  agent-hands use 2\n  agent-hands use --cdp 60066\n  agent-hands use --browser edge'),
        { code: 'EUSAGE' });
    }
  }
  if (args.tab) endpoint.tab = args.tab;

  // Verify before pinning. Pinning something dead just moves the failure later.
  const port = row?.port ?? endpoint.cdp ?? null;
  const probe = port ? await probeEndpoint(port) : { state: 'running', detail: null };
  if (probe.state !== 'running') {
    throw Object.assign(new Error(
      `that browser is not answering (${probe.detail}). Nothing pinned.\n` +
      '  agent-hands browsers   see what is live'), { code: 'EUSAGE' });
  }

  // Identity, and the honest bit: no harness exposes a per-subagent id, so two
  // siblings look identical here. Mint one and say so, rather than pretending.
  const pin0 = pinFrom(endpoint, {});
  const existing = loadConfig(cwd).merged;
  const clash = conflict(existing, pin0);
  let issued = null;
  if (!agentId()) issued = mintId();

  const pin = pinFrom(endpoint, {
    port, browserVersion: probe.detail, profile: row?.dir ?? null, now: Date.now(),
  });
  const { file, scope: wrote } = saveConfig(stamp({ target: pin }), { scope, cwd });

  const out = [`✓ pinned ${row ? row.name : (endpoint.cdp ? `cdp ${endpoint.cdp}` : endpoint.browser)}`
    + `   ${flagFor(row ?? { kind: endpoint.cdp ? 'launched' : 'external', name: endpoint.browser, port })}`,
    `  written to ${file} (${wrote} scope)`];
  if (endpoint.tab) out.push(`  tab "${endpoint.tab}"`);
  out.push('  later commands need no target flag. An explicit flag still wins.');
  if (clash) {
    out.push('');
    out.push(`  ! replaced a pin set ${clash.ageSec}s ago by a different writer.`);
    out.push('    If several agents share this project, give each its own identity —');
    out.push('    no harness exposes a per-subagent id, so they are identical to me:');
    out.push('      AGENT_HANDS_ID=<name>   (set it in each agent, once)');
  }
  if (issued) {
    out.push('');
    out.push(`  identity: none found, so pins here are shared by every agent in this project.`);
    out.push(`  To make this pin yours alone: AGENT_HANDS_ID=${issued}`);
  }
  return console.log(out.join('\n'));
}


async function runBatch(args) {
// One resolution path for every command: flag > pin > only-live > default.
// Anything else and two call sites drift, which is how a command ends up
// driving a browser nobody chose.
const resolution = await resolveTargetCfg(args);
args._via = resolution.via;   // provenance, reported to the caller
const endpoint = { ...resolution.endpoint,
  ...(args.tab ? { tab: args.tab } : {}), activate: args.activate !== false };
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

        // The guard runs here too. run() skips it on a borrowed connection, so
        // without this the protection was absent in exactly the mode the docs
        // tell an agent to prefer. One evaluate per line, a couple of ms.
        if (!args.flags.force && !GUARD_EXEMPT.has(cmd)) {
          const g = verdict(await inspectPage(cdp));
          if (g.block) throw Object.assign(new Error(explainGuard(g)), { code: 'ELOGINPAGE' });
        }
        const r = await run(la, cmd, rest, cdp);
        out = { i, ok: true, command: cmd, ...r.data };
      } catch (e) {
        out = { i, ok: false, command: line.slice(0, 40), error: e.message, code: e.code ?? 'EFAIL' };
        worst = Math.max(worst, EXIT[e.code] ?? 1);
        // A sign-in block is not a per-line failure: every remaining line would
        // hit the same wall and repeat the same paragraph. Stop and say it once.
        if (args.flags.stopOnError || e.code === 'ELOGINPAGE') {
          process.stdout.write(JSON.stringify(out) + '\n');
          break;
        }
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

  if (cmd === 'login' && (args.flags.identifierRef || args.flags.passwordRef
      || rest.some(a => /^@?e[0-9]+$/i.test(a)))) {
  // One resolution path for every command: flag > pin > only-live > default.
  // Anything else and two call sites drift, which is how a command ends up
  // driving a browser nobody chose.
  const resolution = await resolveTargetCfg(args);
  args._via = resolution.via;   // provenance, reported to the caller
  const endpoint = { ...resolution.endpoint,
    ...(args.tab ? { tab: args.tab } : {}), activate: args.activate !== false };
  // Provenance travels with the result. An agent that can see "via":"pin" can
  // notice it is on the wrong browser now, instead of after twenty commands.
  args._via = resolution.via;
    const cdp = await CDP.connect(endpoint);
    try {
      if (!args.flags.force) {
        const g = verdict(await inspectPage(cdp));
        if (g.block) throw Object.assign(new Error(explainGuard(g)), { code: 'ELOGINPAGE' });
      }
      const r = await loginViaCdp(args, cdp, args.speed, rest);
      if (r.state === 'challenge') process.exitCode = 3;
      if (args.json) return console.log(JSON.stringify({ ok: r.state !== 'challenge', command: 'login', ...r }));
      return console.log(r.human ?? `✓ ${r.state}`);
    } finally {
      await cdp.drain(); cdp.close();
    }
  }

  if (cmd === 'login' && !args.flags.window && !args.tab) {
    throw Object.assign(new Error([
      'login needs to know what to fill.',
      '',
      '  Read the page, then name the refs:',
      '    agent-hands snapshot --cdp <port>',
      '    agent-hands login @e2 @e3 @e5      identifier, password, submit',
      '',
      '  snapshot prints that exact line for you when it sees a form.',
      '  Credentials come from $AGENT_HANDS_EMAIL and $AGENT_HANDS_PASSWORD,',
      '  or --email-env NAME / --password-env NAME. Never as a bare --password.',
      '',
      '  For a browser you cannot relaunch, the OS-accessibility lane instead:',
      '    agent-hands login --window "<part of the window title>"',
    ].join('\n')), { code: 'EUSAGE' });
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

  if (cmd === 'use') return useCommand(args, rest);

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
    console.log(JSON.stringify({ ok: true, command: cmd, ...result.data,
      ...(args._via ? { via: args._via } : {}), ...(upd ? { update: upd } : {}) }));
  } else {
    console.log(result.human);
  }
}

// 3 is its own code so a caller can tell "a human needs to click something"
// apart from a real failure, and retry instead of giving up.
const EXIT = { EUSAGE: 2, ECHALLENGE: 3, ELOGINPAGE: 4, ECHOOSE: 5, EPIN: 6 };

main().catch(err => {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: false, error: err.message, code: err.code ?? 'EFAIL' }));
  } else {
    console.error('✗ ' + err.message);
  }
  process.exitCode = EXIT[err.code] ?? 1;
});
