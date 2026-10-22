// Bring the human to the browser when the agent needs them. Windows only.
//
// Target.activateTarget switches tabs inside the browser, but a browser behind
// the editor stays behind it. summon.ps1 adds the OS part: a toast, a taskbar
// flash, and a raise of the window once the user stops typing elsewhere.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'summon.ps1');
const CACHE = path.join(os.homedir(), '.agent-browser', 'humanize');

// A keystroke 3 s ago means the user is mid-sentence somewhere else.
export const QUIET_MS = 3000;
const WAIT_MS = 6000;
// The first run compiles the helper, which measured 14 s for approve.ps1.
const BUDGET_MS = 25000;

async function browserPid(cdp) {
  const r = await cdp.send('SystemInfo.getProcessInfo', {}, null).catch(() => null);
  return r?.processInfo?.find(p => p.type === 'browser')?.id ?? null;
}

// Resolves { found, raised, flashed, toast, idleMs } or { skipped: reason }.
export async function summon(cdp, { message, title = '' } = {}) {
  if (process.platform !== 'win32') return { skipped: 'not Windows' };
  if (process.env.AGENT_HANDS_NO_SUMMON) return { skipped: 'AGENT_HANDS_NO_SUMMON is set' };
  const pid = await browserPid(cdp);
  if (!pid) return { skipped: 'the browser did not report its process id' };

  const source = fs.readFileSync(SCRIPT, 'utf8');
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  try { fs.mkdirSync(CACHE, { recursive: true }); } catch { /* compiles in memory */ }

  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64')], {
      env: {
        ...process.env,
        AGENT_HANDS_PID: String(pid),
        AGENT_HANDS_TITLE: title,
        AGENT_HANDS_MESSAGE: message,
        AGENT_HANDS_QUIET_MS: String(QUIET_MS),
        AGENT_HANDS_WAIT_MS: String(WAIT_MS),
        AGENT_HANDS_DLL: path.join(CACHE, `summon-${hash}.dll`),
      },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); resolve({ skipped: 'summon timed out' }); }, BUDGET_MS);
    child.stdout.on('data', d => { out += d; });
    child.on('close', () => {
      clearTimeout(timer);
      child.stdout.destroy();
      try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve({ skipped: 'summon gave no result' }); }
    });
    child.on('error', () => { clearTimeout(timer); resolve({ skipped: 'powershell did not start' }); });
  });
}
