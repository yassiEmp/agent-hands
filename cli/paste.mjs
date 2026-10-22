// Long text goes in the way a person puts it in: all at once.
//
// Typing is ~150 ms a character, so 2000 characters held the agent for five
// minutes and outlived its shell timeout. A person with that much text pastes.
//
// Two routes, measured 22 Oct 2026 on Edge with an event-logging textarea:
//   insert     Input.insertText. One trusted beforeinput/input pair with
//              inputType "insertText", as dictation or an IME commit sends.
//              The clipboard is never touched.
//   clipboard  a real Ctrl+V. CDP key events with Ctrl run Chromium's paste
//              command, which reads the SYSTEM clipboard: the page got a
//              trusted paste event and "insertFromPaste". Rich editors handle
//              that best. It borrows the user's clipboard for a moment.

import { execFileSync, spawn } from 'node:child_process';
import { sleep, lognormal } from './motion.mjs';

// A person types a sentence and pastes a document. 300 characters is about a
// minute of typing at speed 1.
export const PASTE_OVER = Number(process.env.AGENT_HANDS_PASTE_OVER) || 300;

export async function insertText(cdp, text, speed) {
  const t0 = Date.now();
  await sleep(lognormal(260, 0.4, 700) / speed);       // reach for the shortcut
  await cdp.send('Input.insertText', { text });
  return { chars: [...text].length, ms: Date.now() - t0, method: 'paste' };
}

const CTRL = { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 };
const V = { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86 };

export async function clipboardPaste(cdp, text, speed) {
  const t0 = Date.now();
  const clip = await borrowClipboard(text);
  try {
    await sleep(lognormal(260, 0.4, 700) / speed);
    await cdp.send('Input.dispatchKeyEvent', { ...CTRL, type: 'rawKeyDown', modifiers: 2 });
    await sleep(lognormal(80, 0.3, 200) / speed);
    await cdp.send('Input.dispatchKeyEvent', { ...V, type: 'rawKeyDown', modifiers: 2 });
    await sleep(lognormal(70, 0.35, 200) / speed);
    await cdp.send('Input.dispatchKeyEvent', { ...V, type: 'keyUp', modifiers: 2 });
    await cdp.send('Input.dispatchKeyEvent', { ...CTRL, type: 'keyUp', modifiers: 0 });
    await cdp.evaluate('0');                             // the paste has run once this answers
  } finally {
    await clip.giveBack();
  }
  return { chars: [...text].length, ms: Date.now() - t0, method: 'clipboard' };
}

// One helper process holds the user's clipboard text while the agent's text is
// on it, then puts theirs back. One start instead of four: four PowerShell
// starts made a paste take 8.5 s. The user may copy something of their own
// meanwhile, so theirs comes back only while the agent's text is still there.
// Text only: an image on the clipboard is not saved.
const HELPER = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$C = [Windows.Forms.Clipboard]',
  '$mine = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))',
  '$had = $C::ContainsText()',
  '$theirs = if ($had) { $C::GetText() } else { "" }',
  '$C::SetText($mine)',
  '[Console]::Out.WriteLine("ready"); [Console]::Out.Flush()',
  '$null = [Console]::In.ReadLine()',
  'if ($C::ContainsText() -and $C::GetText() -eq $mine) { if ($had) { $C::SetText($theirs) } else { $C::Clear() } }',
  '[Console]::Out.WriteLine("done")',
].join('\n');

function borrowClipboard(text) {
  if (process.platform === 'darwin') return borrowMac(text);
  if (process.platform !== 'win32') {
    throw Object.assign(new Error('a rich-editor paste needs Windows or macOS here. Use --keys.'), { code: 'EUSAGE' });
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
    Buffer.from(HELPER, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const lines = [];
  let wake = null;
  child.stdout.on('data', d => { lines.push(...String(d).split(/\r?\n/).filter(Boolean)); wake?.(); });
  const next = want => new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('the clipboard helper did not answer.')), 15000);
    const check = () => { if (lines.includes(want)) { clearTimeout(timer); wake = null; ok(); } };
    wake = check; check();
    child.once('exit', () => { clearTimeout(timer); lines.includes(want) ? ok() : bad(new Error('the clipboard helper exited early.')); });
  });
  child.stdin.write(Buffer.from(text, 'utf8').toString('base64') + '\n');
  return next('ready').then(() => ({
    giveBack: async () => {
      child.stdin.end('\n');
      await next('done').catch(() => {});
      child.stdout.destroy();
    },
  }));
}

function borrowMac(text) {
  const theirs = (() => { try { return execFileSync('pbpaste', { encoding: 'utf8', timeout: 5000 }); } catch { return null; } })();
  execFileSync('pbcopy', { input: text, timeout: 5000 });
  return Promise.resolve({
    giveBack: async () => {
      const now = execFileSync('pbpaste', { encoding: 'utf8', timeout: 5000 });
      if (theirs !== null && now === text) execFileSync('pbcopy', { input: theirs, timeout: 5000 });
    },
  });
}
