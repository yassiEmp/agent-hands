// Refuse to sit attached to a login page while the browser is advertising
// automation.
//
// Signing in is the moment a site grades hardest, and navigator.webdriver is
// the cheapest thing it can read. So this checks the ACTUAL signal rather than
// assuming: a browser launched by `agent-hands launch` carries
// --disable-blink-features=AutomationControlled and reports webdriver false, and
// there is nothing to protect it from. A browser attached over the
// chrome://inspect route reports true, and there is.
//
// Measured, Chrome 151: launched with the flag, driven attached through this
// CLI, bot-detector.rebrowser.net reports "No webdriver presented".

const LOGIN_URL = new RegExp([
  '(^|[/.])(login|log-in|signin|sign-in|sign_in|logon|auth|authorize|oauth|sso)([/?#]|$)',
  '(^|/)(connexion|se-connecter|identification|anmelden|iniciar-sesion|acceso|entrar|accedi)([/?#]|$)',
  'accounts\.google\.', 'login\.microsoftonline\.', 'signin\.aws\.', '/session/new',
].join('|'), 'i');

export function urlLooksLikeLogin(url) {
  return LOGIN_URL.test(String(url || ''));
}

// One round trip, and it answers both halves: is this a sign-in surface, and is
// this browser telling the page it is automated.
const PROBE = `JSON.stringify({
  wd: navigator.webdriver === true,
  pw: !!document.querySelector('input[type=password]'),
  url: location.href
})`;

export async function inspect(cdp) {
  try {
    const raw = await cdp.evaluate(PROBE);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;                     // mid-navigation; never block on a probe
  }
}

export function verdict(state) {
  if (!state) return { block: false };
  const isLogin = state.pw || urlLooksLikeLogin(state.url);
  return { block: Boolean(isLogin && state.wd), isLogin, webdriver: state.wd, url: state.url };
}

export function explain(v) {
  return [
    'this is a sign-in page and the browser is advertising automation',
    `  navigator.webdriver = true   ${v.url}`,
    '',
    '  Sign-in is where a site grades hardest, and that flag is the cheapest',
    '  thing it can read. Disconnected without touching the page.',
    '',
    '  Fix it at the source — relaunch on a clean profile, then retry:',
    '    agent-hands launch <url> --profile <name>',
    '    agent-hands snapshot --cdp <port printed by launch>',
    '',
    '  Cannot relaunch, because the session you need lives in that browser?',
    '  Sign in through the OS accessibility layer, with nothing attached:',
    '    agent-hands login --window "<part of the window title>"',
    '',
    '  Or stay attached anyway:',
    '    --force',
    '',
    '  Clearing this flag removes ONE signal. It is not a cloak: Turnstile,',
    '  DataDome and friends score dozens of others and may still challenge you.',
    '  Use --pause-on-challenge so a human can clear that when it happens.',
  ].join('\n');
}
