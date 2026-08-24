// Sign in through the OS accessibility layer, before any CDP client attaches.
//
// THE RULE THAT MAKES THIS WORK: UIA before CDP, never the other way round.
// Attaching CDP sets navigator.webdriver, and a login form is the worst moment
// to carry it. UIA is the layer a screen reader uses, so it leaves no
// browser-automation trace. Sign in first, attach second.
//
// Nothing here is specific to one site. A login form is one of the most
// standardised things on the web: an identifier field, a password field, an
// optional "remember me", one submit button. Those are matched by role and by
// name across languages, so this works on a form it has never seen.
//
// CREDENTIALS NEVER APPEAR IN ARGV. A value passed as --password lands in shell
// history and in every process listing on the machine, readable by any other
// process running as this user. Environment variables and stdin do not.

import { snapshot, windows, fill, invoke, toggle, agentWinMissing, MISSING_HINT } from './uia.mjs';

const rx = {
  password: /pass|mot\s*de\s*passe|mdp|senha|contrase|passwort|wachtwoord|hasło|пароль|密码|パスワード/i,
  identifier: /e-?mail|mail|user|login|identifiant|utilisateur|usuario|benutzer|nome|account|phone|téléphone/i,
  remember: /remember|souvenir|recordar|angemeldet|resta\s*connesso|lembrar|запомнить|保持登录/i,
  submit: /log\s*in|sign\s*in|connect|connexion|je\s*me\s*connecte|s'identifier|entrar|acceder|anmelden|accedi|login|continue|continuer|submit|valider|weiter/i,
  challenge: /vérifiez\s*que\s*vous\s*êtes\s*humain|verify\s*you\s*are\s*human|i'?m\s*not\s*a\s*robot|je\s*ne\s*suis\s*pas\s*un\s*robot|hcaptcha|turnstile|recaptcha|are\s*you\s*human|cloudflare/i,
};

// Chromium gives its OWN toolbar, tab strip and address bar automationIds of
// the form view_<n>; page content never has one. Structural and untranslated,
// the same reasoning that picks dialog buttons by class rather than by label.
//
// This is not cosmetic. Without it the address bar matches as the identifier
// field — measured on a real Edge window — and a password would be typed into
// the omnibox and sent to the default search engine.
const isChrome = e => /^view_[0-9]+$/.test(String(e.automationId ?? e.automationid ?? ''));
export const pageOnly = els => els.filter(e => !isChrome(e));

const text = e => `${e.name || ''} ${e.automationId || ''} ${e.automationid || ''}`.trim();
const type = e => String(e.type || e.controlType || '').toLowerCase();
const disabled = e => (e.states || []).some(s => /disabled/i.test(String(s)));

// Identify the parts of a login form. Role first, then name — the reverse
// breaks on any language this file does not list.
export function readForm(elements) {
  const edits = elements.filter(e => /edit|text|combobox/.test(type(e)));
  const buttons = elements.filter(e => /button/.test(type(e)));
  const checks = elements.filter(e => /check|toggle/.test(type(e)));

  const password = edits.find(e => e.isPassword === true || rx.password.test(text(e))) || null;
  // Fall back to position: on a form with no usable labels, the identifier is
  // the field before the password. Never guess the password field this way.
  const identifier =
    edits.find(e => e !== password && rx.identifier.test(text(e)))
    || (password ? edits[Math.max(0, edits.indexOf(password) - 1)] : edits[0])
    || null;

  const remember = checks.find(e => rx.remember.test(text(e))) || null;
  const submit =
    buttons.find(e => rx.submit.test(text(e)))
    || buttons.filter(e => !disabled(e))[0]
    || null;

  const challenge =
    elements.find(e => rx.challenge.test(text(e)))
    || (submit && disabled(submit) ? submit : null);

  return {
    identifier, password, remember, submit,
    challenge: challenge || null,
    challengeReason: challenge
      ? (rx.challenge.test(text(challenge)) ? `control "${text(challenge).slice(0, 60)}"`
                                            : 'submit button is disabled')
      : null,
  };
}

export function describe(form) {
  const one = (label, e) => `  ${label.padEnd(11)} ${e ? `${e.ref}  ${type(e)}  "${(e.name || e.automationId || '').slice(0, 48)}"` : '(not found)'}`;
  return [
    one('identifier', form.identifier),
    one('password', form.password),
    one('remember', form.remember),
    one('submit', form.submit),
  ].join('\n');
}

const BROWSER_PROCS = ['msedge.exe', 'chrome.exe', 'brave.exe', 'vivaldi.exe', 'chromium.exe'];

// "No password field" is only evidence of being signed in if we are looking at
// a browser showing a page. Without this guard the taskbar matches, reports
// already-signed-in, and the caller believes a login happened that never did.
export function classify(form, win) {
  const isBrowser = BROWSER_PROCS.includes(String(win?.process || '').toLowerCase());
  if (!isBrowser) return 'not-a-browser';
  if (form.password) return 'password-form';
  if (form.identifier && form.submit) return 'identifier-first';   // two-step: email, then password
  if (!form.identifier && !form.submit) return 'signed-in';
  return 'unclear';
}

export async function findWindow(match) {
  const list = await windows();
  if (!list.length) return null;
  if (!match) return list[0];
  const m = String(match).toLowerCase();
  return list.find(w => `${w.title || ''} ${w.process || ''}`.toLowerCase().includes(m)) || null;
}

export async function loginFlow(opts) {
  const {
    windowMatch, email, password, remember = true, dryRun = false,
    challengeWaitMs = 180000, log = () => {},
  } = opts;

  if (agentWinMissing()) throw Object.assign(new Error(MISSING_HINT), { code: 'ENOUIA' });

  const win = await findWindow(windowMatch);
  if (!win) {
    // Name what WAS seen. UIA only enumerates windows that exist on the
    // desktop, so a browser with a live debugging port but no window — headless,
    // or on another virtual desktop — is invisible here even though CDP reaches
    // it. Listing the candidates turns a dead end into an obvious next step.
    const seen = (await windows())
      .filter(w => /edge|chrome|brave|vivaldi|chromium/i.test(String(w.process || '')))
      .map(w => `    ${w.ref}  ${(w.title || '').slice(0, 64)}`);
    throw Object.assign(new Error([
      `no browser window matches "${windowMatch ?? '(any)'}".`,
      seen.length ? '  browser windows on this desktop:' : '  no browser windows are visible to the OS at all.',
      ...seen,
      '  A browser with a debugging port but no visible window cannot be driven',
      '  through the accessibility layer. Launch one that has a window:',
      '    agent-hands launch <url> --browser edge',
    ].join('\n')), { code: 'EUSAGE' });
  }

  let elements = pageOnly(await snapshot(win.ref || win.id || win.title));
  if (!elements.length) {
    throw Object.assign(new Error(
      'the window exposes no accessibility tree.\n' +
      '  Chromium only builds one when launched with --force-renderer-accessibility.\n' +
      '  agent-hands launch passes it for you.'), { code: 'ENOTREE' });
  }

  // Chrome controls present but no page controls at all means Chromium is not
  // publishing the page accessibility tree. Measured on this machine: the
  // window exposes 97 controls, all of them toolbar and tab strip, with
  // --force-renderer-accessibility set. Saying "could not identify the form"
  // there sends the reader hunting through their HTML for a fault that is not
  // in it.
  const usableField = e => /edit|text|combobox/.test(String(e.type || '').toLowerCase())
    && ((e.name || '').trim() || (e.automationId || '').trim());
  if (!elements.some(usableField)) {
    throw Object.assign(new Error([
      'the browser exposes no page content to the accessibility layer.',
      '  Only toolbar and tab controls are visible, so no form can be read.',
      '  Chromium needs --force-renderer-accessibility at launch, and some',
      '  builds only publish the tree once an assistive client is active.',
      '    agent-hands launch <url> --browser edge     passes the flag',
      '  If it is already set, the page tree is being withheld: fall back to',
      '  CDP (agent-hands snapshot) and accept that the login runs attached.',
    ].join('\n')), { code: 'ENOTREE' });
  }

  let form = readForm(elements);
  const kind = classify(form, win);
  if (kind === 'not-a-browser') {
    throw Object.assign(new Error(
      `"${win.title || win.ref}" is not a browser window (process ${win.process || '?'}).
` +
      '  Pass --window to name the browser, e.g. --window "RdvPermis".'), { code: 'EUSAGE' });
  }
  if (kind === 'signed-in') return { state: 'already-signed-in', window: win.title || null };

  if (dryRun) {
    return { state: 'dry-run', window: win.title || null, found: describe(form),
             challenge: form.challengeReason };
  }
  if (!form.identifier || !form.submit || (kind === 'password-form' && !form.password)) {
    throw Object.assign(new Error(
      `could not identify the form.\n${describe(form)}\n` +
      `  Re-run with --dry-run to see the tree this matched against.`), { code: 'EFORM' });
  }

  await fill(form.identifier.ref, email);
  if (kind === 'identifier-first') {
    // Google, Microsoft and many SSO flows ask for the identifier, submit, then
    // show the password on a second page. Advance and re-read before typing it.
    await invoke(form.submit.ref);
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const f = readForm(pageOnly(await snapshot(win.ref || win.id || win.title)));
      if (f.password) { form = f; break; }
    }
    if (!form.password) {
      throw Object.assign(new Error('identifier accepted but no password field appeared'), { code: 'EFORM' });
    }
  }
  await fill(form.password.ref, password);
  if (remember && form.remember) await toggle(form.remember.ref);

  // A challenge is checked AFTER filling and BEFORE submitting, because that is
  // when a risk-adaptive widget decides to appear. It is never solved here: a
  // programmatic invoke produces no pointer trace, which scores worse than not
  // clicking at all, and the account is what pays.
  elements = pageOnly(await snapshot(win.ref || win.id || win.title));
  form = { ...readForm(elements) };
  if (form.challenge) {
    log(`challenge present (${form.challengeReason}) — solve it in the window; waiting.`);
    const deadline = Date.now() + challengeWaitMs;
    let cleared = false;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2500));
      const els = pageOnly(await snapshot(win.ref || win.id || win.title));
      const f = readForm(els);
      if (!f.challenge) { cleared = true; form = f; break; }
    }
    if (!cleared) {
      return { state: 'challenge-unresolved', window: win.title || null,
               challenge: form.challengeReason };
    }
    log('challenge cleared.');
  }

  if (!form.submit) throw Object.assign(new Error('submit button vanished after the challenge'), { code: 'EFORM' });
  await invoke(form.submit.ref);

  // The title changing is the signal that the form went away. Polling the tree
  // instead would race the navigation.
  const before = win.title || '';
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const w = await findWindow(windowMatch);
    if (w && (w.title || '') !== before) return { state: 'signed-in', window: w.title || null };
  }
  return { state: 'submitted', window: before, note: 'title did not change within 24s; verify manually' };
}
