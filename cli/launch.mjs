// Start a browser the right way, then tell you how to reach it.
//
// The flags are not arbitrary. Each one fixes a specific, measured problem:
//
//   --disable-blink-features=AutomationControlled
//     Removes navigator.webdriver at the source. Measured on Chrome 151: with
//     it, bot-detector.rebrowser.net reports "No webdriver presented"; without
//     it, red. Emulation.setAutomationOverride does NOT clear a flag that came
//     from the debugging-port route, so this is the only clean fix.
//
//   --force-renderer-accessibility
//     Chromium builds no page accessibility tree without it, so the OS lane
//     sees window chrome and nothing else. Required for `agent-hands login`.
//
//   --user-data-dir  (a dedicated profile)
//     Keeps one task's cookies away from the user's personal browser.
//
//   the URL as an argument, not a later navigation
//     Identical to double-clicking a shortcut. No typing into the address bar
//     and no Page.navigate, both of which happen after a client is attached.
//
// An open debugging port is invisible to the page. Only an ATTACHED client
// leaves a trace, so opening the port early costs nothing.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { readPortFile } from './cdp.mjs';

const EXES = {
  win32: {
    edge: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
           'C:/Program Files/Microsoft/Edge/Application/msedge.exe'],
    chrome: ['C:/Program Files/Google/Chrome/Application/chrome.exe',
             'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
    brave: ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'],
    chromium: ['C:/Program Files/Chromium/Application/chrome.exe'],
  },
  darwin: {
    edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    brave: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    chromium: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
  },
  linux: {
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    brave: ['/usr/bin/brave-browser'],
    chromium: ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
  },
};

export function findExe(name) {
  const table = EXES[process.platform] || EXES.linux;
  for (const p of table[name] || []) if (fs.existsSync(p)) return p;
  return null;
}

export function browserChoices() { return Object.keys(EXES[process.platform] || EXES.linux); }

export function profilePath(nameOrDir) {
  if (!nameOrDir) return path.join(os.homedir(), '.agent-hands-profiles', 'default');
  if (nameOrDir.includes('/') || nameOrDir.includes(path.sep)) return nameOrDir;
  return path.join(os.homedir(), '.agent-hands-profiles', nameOrDir);
}

export async function launch({ url, browser = 'edge', profile, port = 0, waitMs = 30000, log = () => {} }) {
  const exe = findExe(browser);
  if (!exe) {
    throw Object.assign(new Error(
      `${browser} not found on this machine.\n  known: ${browserChoices().join(', ')}\n` +
      `  pass --exe <path> for anything else`), { code: 'EUSAGE' });
  }
  const dir = profilePath(profile);
  fs.mkdirSync(dir, { recursive: true });

  // Port 0 lets the OS pick a free one; the real port lands in DevToolsActivePort.
  const stale = path.join(dir, 'DevToolsActivePort');
  try { fs.unlinkSync(stale); } catch { /* first run */ }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--force-renderer-accessibility',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (url) args.push(url);

  // Anything holding this profile from BEFORE we spawned is a real orphan.
  // Anything after is a child of this very attempt, and naming those sends the
  // caller round a loop that never converges.
  const startedAt = Date.now();
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  log(`launching ${browser} on ${dir}`);

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    const found = readPortFile(dir);
    if (found?.port) return { browser, exe, profile: dir, port: found.port, url: url || null, pid: child.pid };
  }
  // Naming the directory it looked in is not a fix. The usual cause is an
  // orphan process still holding this profile: a browser that crashed or was
  // force-killed leaves children behind, the new window is handed to them, and
  // no debugging port is ever opened. Say that, and name the pids.
  const holders = profileHolders(dir, startedAt);
  const lines = [
    `${browser} did not write DevToolsActivePort within ${Math.round(waitMs / 1000)}s.`,
    `  looked in: ${dir}`,
  ];
  if (holders.length) {
    lines.push(
      `  ${holders.length} process(es) still hold this profile with no debugging port:`,
      `    pid ${holders.join(', ')}`,
      '  A crashed or force-killed browser leaves these behind, and the new window',
      '  is handed to them so no port opens. Close them:',
      `    powershell -NoProfile -Command \"Stop-Process -Id ${holders.join(',')} -Force\"`,
      '  If a retry then fails the same way, the profile itself is damaged - each',
      '  attempt leaves a new orphan. Use another profile:',
      '    agent-hands launch <url> --profile <name>');
  } else {
    lines.push('  Nothing was holding this profile beforehand, so the browser started',
      '  and never opened the port. That is usually a damaged profile: a force-kill',
      '  can leave one in a state where every later launch is handed off and dies.',
      '  A different profile is the fast way past it:',
      '    agent-hands launch <url> --profile <name>',
      '  To reuse this one, close every process on it and move it aside:',
      `    powershell -NoProfile -Command \"Move-Item '${dir}' '${dir}.broken'\"`);
  }
  throw Object.assign(new Error(lines.join(String.fromCharCode(10))), { code: 'EFAIL' });
}

// Which processes still hold this user-data-dir? Only called on the failure
// path, so the ~800ms WMI cost does not matter. The path goes through the
// environment, not the script text, so a profile name with a space or a quote
// cannot break the query. Windows only; elsewhere the caller falls back to the
// generic message.
// Matched as the whole flag plus the whole path, then a delimiter. A bare
// substring test would match a sibling profile whose name merely starts the
// same way, and the message this feeds tells the caller to Stop-Process.
const HOLDERS_PS = "$d = \"--user-data-dir=\" + $env:AH_PROFILE_DIR.ToLower(); $sp = $d + [string][char]32; $cut = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$env:AH_SINCE_MS).LocalDateTime; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CreationDate -lt $cut } | ForEach-Object { $c = $_.CommandLine.ToLower().Replace([string][char]34, ''); if ($c.Contains($sp) -or $c.EndsWith($d)) { $_.ProcessId } }";

function profileHolders(dir, since) {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', HOLDERS_PS], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, AH_PROFILE_DIR: dir, AH_SINCE_MS: String(since) },
    });
    return out.split(new RegExp("\\r?\\n"))
      .map(l => l.trim()).filter(l => /^[0-9]+$/.test(l));
  } catch { return []; }
}
