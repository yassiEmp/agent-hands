// Whose browser is this? The OS default and the profiles inside each browser.
//
// Both are read from disk, so they cost no debugging port and no approval
// modal. Opening a probe link would leave a stray tab in the user's browser and
// still tell nothing unless that browser already exposes debugging.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Windows ProgId, macOS bundle id, or Linux .desktop name -> our browser name.
// Order matters: channel suffixes are tested before the stable channel.
const MATCHERS = [
  [/^MSEdgeBHTML|^com\.microsoft\.edgemac\.beta|^microsoft-edge-beta/i, 'edge-beta'],
  [/^MSEdgeDHTML|^com\.microsoft\.edgemac\.dev|^microsoft-edge-dev/i, 'edge-dev'],
  [/^MSEdgeSHTML|^com\.microsoft\.edgemac\.canary/i, 'edge-canary'],
  [/^MSEdgeHTM|^com\.microsoft\.edgemac$|^microsoft-edge/i, 'edge'],
  [/^ChromeBHTML|^com\.google\.chrome\.beta|^google-chrome-beta/i, 'chrome-beta'],
  [/^ChromeDHTML|^com\.google\.chrome\.dev|^google-chrome-unstable/i, 'chrome-dev'],
  [/^ChromeSSHTM|^com\.google\.chrome\.canary/i, 'chrome-canary'],
  [/^ChromeHTML|^com\.google\.chrome$|^google-chrome/i, 'chrome'],
  [/^BraveHTML|^com\.brave\.browser|^brave-browser/i, 'brave'],
  [/^Vivaldi|^com\.vivaldi\.vivaldi|^vivaldi/i, 'vivaldi'],
  [/^Chromium|^org\.chromium\.chromium|^chromium/i, 'chromium'],
  [/^Firefox|^org\.mozilla\.firefox|^firefox/i, 'firefox'],
  [/^Safari|^com\.apple\.safari/i, 'safari'],
];

// agent-hands drives Chromium only. A Firefox or Safari default is still worth
// reporting: it tells the agent that the user's main browser is out of reach.
export const UNDRIVABLE = new Set(['firefox', 'safari']);

export function browserFromHandler(id) {
  if (!id) return null;
  const hit = MATCHERS.find(([re]) => re.test(id));
  return hit ? hit[1] : null;
}

let cached;

// { name, handler } or null. name is null when the handler is unknown.
export function defaultBrowser() {
  if (cached !== undefined) return cached;
  let handler = null;
  try {
    handler = readHandler();
  } catch {
    handler = null;
  }
  cached = handler ? { name: browserFromHandler(handler), handler } : null;
  return cached;
}

function readHandler() {
  const run = (cmd, args) => execFileSync(cmd, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true,
  });

  if (process.platform === 'win32') {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice';
    const out = run('reg', ['query', key, '/v', 'ProgId']);
    return out.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1] ?? null;
  }

  if (process.platform === 'darwin') {
    const plist = path.join(os.homedir(), 'Library', 'Preferences', 'com.apple.LaunchServices',
      'com.apple.launchservices.secure.plist');
    const json = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', plist]));
    const entry = (json.LSHandlers || []).find(h => h.LSHandlerURLScheme === 'https');
    // No https entry means the user never changed it, and Safari is the default.
    return entry?.LSHandlerRoleAll ?? 'com.apple.safari';
  }

  return run('xdg-settings', ['get', 'default-web-browser']).trim() || null;
}

// Profiles from <user data dir>/Local State. The browser keeps this file
// current while it runs, so last_active_profiles tracks the open windows.
export function profiles(userDataDir) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8')).profile;
  } catch {
    return [];
  }
  if (!state?.info_cache) return [];
  const active = new Set(state.last_active_profiles || []);
  return Object.entries(state.info_cache)
    .map(([dir, info]) => ({
      dir,
      name: info.name || dir,
      account: info.user_name || null,
      lastUsed: dir === state.last_used,
      open: active.has(dir),
      activeTime: info.active_time || 0,
    }))
    .sort((a, b) => b.activeTime - a.activeTime);
}
