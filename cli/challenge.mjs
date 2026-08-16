// Detect an anti-bot challenge and hand the tab back to the human.
//
// This tool deliberately does not try to defeat these vendors. Their stacks
// combine IP reputation, TLS fingerprinting below the browser, behavioural
// scoring and cross-site identity correlation; the layers reachable from inside
// a browser you did not compile are the fewest, and a win does not stay won,
// because the same fingerprint is recognised on the next request. Forging the
// signals is also self-defeating: noise is itself a lie, and a coherent identity
// is what these systems actually grade.
//
// The winning move is available for free here and nowhere else: the user is
// sitting in front of this browser, logged in as themselves. So when a challenge
// appears, stop, say exactly what was seen, and let them click it. Twenty
// seconds of human beats an arms race.
//
// PRESENT is not CHALLENGED. Half the web sets a __cf_bm cookie while serving
// normal pages. Pausing on that would make the mode useless, so the interstitial
// markers are kept separate from the vendor markers and only the former stop us.

// `challenge` entries must match the blocking interstitial, not the vendor's
// ordinary presence on a working page.
const VENDORS = [
  {
    name: 'Cloudflare',
    cookies: [/^__cf_bm$/, /^cf_clearance$/],
    scripts: [/challenges\.cloudflare\.com/],
    globals: ['turnstile'],
    challenge: {
      selectors: ['#challenge-running', '#challenge-form', '#cf-challenge-running',
                  '.cf-browser-verification', '#turnstile-wrapper'],
      titles: [/^just a moment/i, /^attention required/i, /vérification/i],
    },
  },
  {
    name: 'DataDome',
    cookies: [/^datadome$/],
    scripts: [/js\.datadome\.co/, /captcha-delivery\.com/],
    globals: ['DataDome'],
    challenge: {
      selectors: ['iframe[src*="captcha-delivery.com"]', '#datadome-captcha'],
      titles: [],
    },
  },
  {
    name: 'HUMAN (PerimeterX)',
    cookies: [/^_px/, /^pxcts$/],
    scripts: [/px-cloud\.net/, /px-cdn\.net/, /perimeterx/i],
    globals: ['_pxAppId', 'PX'],
    challenge: { selectors: ['#px-captcha', '.px-block'], titles: [/access to this page has been denied/i] },
  },
  {
    name: 'Akamai Bot Manager',
    cookies: [/^_abck$/, /^bm_sz$/],
    scripts: [],
    globals: ['bmak'],
    challenge: { selectors: ['#sec-cpt-if', '.sec-cpt-challenge'], titles: [/access denied/i] },
  },
  {
    name: 'Imperva (Incapsula)',
    cookies: [/^visid_incap/, /^incap_ses/],
    scripts: [/_Incapsula_Resource/],
    globals: [],
    challenge: { selectors: ['iframe[src*="_Incapsula_Resource"]'], titles: [/request unsuccessful/i] },
  },
  {
    name: 'AWS WAF',
    cookies: [/^aws-waf-token$/],
    scripts: [/waf\.amazonaws\.com/, /awswaf\.com/],
    globals: ['AwsWafIntegration'],
    challenge: { selectors: ['#captcha-container'], titles: [] },
  },
  {
    name: 'Kasada',
    cookies: [/^KP_UIDz/],
    scripts: [/kasada/i, /\/149e9513-01fa/],
    globals: ['KPSDK'],
    challenge: { selectors: [], titles: [/access denied/i] },
  },
  {
    name: 'reCAPTCHA',
    cookies: [],
    scripts: [/google\.com\/recaptcha/, /gstatic\.com\/recaptcha/],
    globals: ['grecaptcha'],
    challenge: { selectors: ['iframe[src*="recaptcha/api2/bframe"]'], titles: [] },
  },
  {
    name: 'hCaptcha',
    cookies: [],
    scripts: [/hcaptcha\.com/],
    globals: ['hcaptcha'],
    challenge: { selectors: ['iframe[src*="hcaptcha.com/captcha"]'], titles: [] },
  },
  {
    name: 'Queue-it',
    cookies: [/^Queue-it$/],
    scripts: [/queue-it\.net/],
    globals: [],
    challenge: { selectors: [], titles: [/you are now in line/i, /waiting room/i] },
  },
];

// One evaluate. Collects raw page facts only — the matching happens in Node so
// the rules stay readable and testable outside a browser.
const PROBE = `(() => JSON.stringify({
  title: document.title || '',
  url: location.href,
  cookies: document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean),
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.src).slice(0, 120),
  globals: Object.getOwnPropertyNames(window).slice(0, 800),
  selectors: (() => {
    const want = ${JSON.stringify([...new Set(VENDORS.flatMap(v => v.challenge.selectors))])};
    return want.filter(s => { try { return !!document.querySelector(s); } catch { return false; } });
  })(),
  bodyChars: (document.body?.innerText || '').trim().length,
  forms: document.querySelectorAll('form').length,
}))()`;

export async function probe(cdp) {
  const raw = await cdp.evaluate(PROBE);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export function classify(facts) {
  const present = [];
  const blocking = [];

  for (const v of VENDORS) {
    const why = [];
    for (const c of v.cookies) if (facts.cookies.some(n => c.test(n))) why.push(`cookie ${c.source}`);
    for (const s of v.scripts) if (facts.scripts.some(u => s.test(u))) why.push(`script ${s.source}`);
    for (const g of v.globals) if (facts.globals.includes(g)) why.push(`window.${g}`);
    if (why.length) present.push({ vendor: v.name, signals: why });

    const hits = [];
    for (const sel of v.challenge.selectors) if (facts.selectors.includes(sel)) hits.push(sel);
    for (const t of v.challenge.titles) if (t.test(facts.title)) hits.push(`title ~ ${t.source}`);
    if (hits.length) blocking.push({ vendor: v.name, markers: hits });
  }

  // An interstitial is small and has nothing to read. Only ever a hint: it
  // corroborates a vendor already seen, and never flags a page on its own.
  const thin = facts.bodyChars < 600 && present.length > 0 && !blocking.length;

  return {
    challenged: blocking.length > 0,
    suspect: thin,
    blocking,
    present,
    title: facts.title,
    url: facts.url,
    bodyChars: facts.bodyChars,
  };
}

export async function check(cdp) {
  return classify(await probe(cdp));
}

export function render(v) {
  if (v.challenged) {
    const names = v.blocking.map(b => b.vendor).join(', ');
    return [
      `⚠ challenge detected — ${names}`,
      `  page:    ${v.title || '(untitled)'}`,
      `  url:     ${v.url}`,
      ...v.blocking.map(b => `  markers: ${b.vendor} -> ${b.markers.join(', ')}`),
      '',
      '  Solve it yourself in the browser window. This tool will not attempt to',
      '  bypass it: these vendors score behaviour and correlate identities across',
      '  sites, so a forged pass is temporary and costs the account it was used on.',
      '  You are already signed in as yourself — clicking it is both faster and true.',
    ].join('\n');
  }
  if (v.suspect) {
    return `· no challenge markers, but the page is thin (${v.bodyChars} chars) and `
      + `${v.present.map(p => p.vendor).join(', ')} is active. Worth a look.`;
  }
  if (v.present.length) {
    return `✓ no challenge. Protection present but not blocking: `
      + v.present.map(p => `${p.vendor} (${p.signals.join(', ')})`).join('; ');
  }
  return '✓ no challenge, no anti-bot vendor detected.';
}

// Wait for the human to clear it. Polls the page rather than asking the user to
// confirm, so the agent resumes on its own the moment the tab is usable again.
export async function waitUntilCleared(cdp, { timeoutMs = 180000, pollMs = 2500, log } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    let v;
    try { v = await check(cdp); } catch { continue; }   // mid-navigation
    if (!v.challenged) {
      log?.(`✓ challenge cleared after ${Math.round((timeoutMs - (deadline - Date.now())) / 1000)}s`);
      return v;
    }
  }
  return null;
}
