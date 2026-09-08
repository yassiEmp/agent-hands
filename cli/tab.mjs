// Which tab a command drives, and remembering it.
//
// Without memory, every command re-picks "the visible tab", which is whatever
// the user is looking at right now. Two commands seconds apart then land on
// two different pages while the agent believes it is still on the first one.
// Measured 8 Sep 2026: `open` navigated the user's foreground YouTube tab,
// the user switched away, and the next `snapshot` read a GitHub tab instead.
//
// So the first pick is written down per browser, and later commands go back
// to that tab until it closes or --tab names another. An explicit --tab always
// wins and becomes the new memory.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const STATE_DIR = path.join(os.homedir(), '.agent-browser', 'humanize');
const file = key => path.join(STATE_DIR, `${key}.tab.json`);

export function remember(key, { targetId, title, url }) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(file(key), JSON.stringify({ targetId, title, url, at: Date.now() }));
  } catch { /* a tab that cannot be remembered is still driven */ }
}

export function recall(key) {
  try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { return null; }
}

export function forget(key) {
  try { fs.unlinkSync(file(key)); } catch { /* nothing to forget */ }
}

// One line per tab, marked so the agent can see which one commands go to.
export function renderTabs(tabs) {
  return tabs.map(t => {
    const mark = t.current ? '>' : ' ';
    return `${mark} ${(t.title || '(untitled)').slice(0, 48).padEnd(48)}  ${t.url.slice(0, 70)}`;
  }).join('\n');
}
