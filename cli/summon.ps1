# Call the human to the browser window: toast, taskbar flash, and a raise when it is safe.
# Spawned by summon.mjs. Writes one JSON line to stdout and exits.
#
# A raise while the user types elsewhere sends their next keystrokes into the sign-in form, so the
# window is raised only after a quiet gap in keyboard and mouse input. The flash and the toast are
# always safe: they take no focus.
#
# Input comes from environment variables:
#   AGENT_HANDS_PID      browser process id. Its top-level windows are the candidates.
#   AGENT_HANDS_TITLE    a tab title to prefer when the browser has several windows (optional)
#   AGENT_HANDS_MESSAGE  toast text
#   AGENT_HANDS_QUIET_MS input gap required before a raise
#   AGENT_HANDS_WAIT_MS  how long to wait for that gap
#   AGENT_HANDS_DLL      cache path for the compiled helper

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$helper = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentHandsSummon {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);

  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

  [StructLayout(LayoutKind.Sequential)]
  struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
  [DllImport("user32.dll")] static extern bool FlashWindowEx(ref FLASHWINFO info);

  // Unowned visible browser frames of one process, in z-order (topmost first).
  public static List<object[]> Frames(uint pid) {
    var found = new List<object[]>();
    EnumWindows((hwnd, _) => {
      if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4) != IntPtr.Zero) return true;
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner != pid) return true;
      var cls = new StringBuilder(64);
      GetClassName(hwnd, cls, cls.Capacity);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      var title = new StringBuilder(512);
      GetWindowText(hwnd, title, title.Capacity);
      if (title.Length == 0) return true;
      found.Add(new object[] { hwnd.ToInt64(), title.ToString() });
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // Wait for quietMs without a physical keystroke, up to waitMs. Returns the quiet time reached.
  // GetLastInputInfo also counts injected input, and a keep-awake tool on the owner's machine
  // injects some every 700 ms, so that clock never runs. The hook sees the LLKHF_INJECTED flag.
  public static long WaitQuiet(int quietMs, int waitMs) {
    var start = Environment.TickCount;
    var lastKey = start;
    HookProc proc = (code, wParam, lParam) => {
      if (code >= 0 && (Marshal.ReadInt32(lParam, 8) & 0x10) == 0) lastKey = Environment.TickCount;
      return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    };
    var hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);    // WH_KEYBOARD_LL
    if (hook == IntPtr.Zero) return -1;
    try {
      MSG msg;
      while (Environment.TickCount - start < waitMs) {
        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) { }
        if (Environment.TickCount - lastKey >= quietMs) break;
        System.Threading.Thread.Sleep(15);
      }
    } finally {
      UnhookWindowsHookEx(hook);
      GC.KeepAlive(proc);
    }
    return Environment.TickCount - lastKey;
  }

  // Flash the taskbar button until the window comes to the foreground.
  public static void Flash(long h) {
    var info = new FLASHWINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    info.hwnd = new IntPtr(h);
    info.dwFlags = 3 | 12;    // FLASHW_ALL | FLASHW_TIMERNOFG
    FlashWindowEx(ref info);
  }

  // Windows refuses SetForegroundWindow to a background process. Sharing the input queue of the
  // current foreground thread for the call is the documented way around that rule.
  public static bool Raise(long h) {
    var hwnd = new IntPtr(h);
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);    // SW_RESTORE
    uint ignored;
    var fg = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
    var me = GetCurrentThreadId();
    var joined = fg != me && AttachThreadInput(me, fg, true);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (joined) AttachThreadInput(me, fg, false);
    return GetForegroundWindow() == hwnd;
  }
}
'@

$dll = $env:AGENT_HANDS_DLL
try {
  if (-not $dll) { throw 'no cache path' }
  if (-not [IO.File]::Exists($dll)) {
    $tmp = [IO.Path]::ChangeExtension($dll, "$PID.dll")
    Add-Type -TypeDefinition $helper -OutputAssembly $tmp -OutputType Library
    try { [IO.File]::Move($tmp, $dll) } catch { [IO.File]::Delete($tmp) }
  }
  [void][Reflection.Assembly]::LoadFrom($dll)
} catch {
  Add-Type -TypeDefinition $helper
}

$S = [AgentHandsSummon]
$out = @{ found = $false; raised = $false; flashed = $false; toast = $false; idleMs = 0 }

$frames = $S::Frames([uint32]$env:AGENT_HANDS_PID)
$want = $env:AGENT_HANDS_TITLE
$frame = $null
if ($want) { $frame = $frames | Where-Object { $_[1].Contains($want) } | Select-Object -First 1 }
if (-not $frame) { $frame = $frames | Select-Object -First 1 }

if ($frame) {
  $out.found = $true
  $out.title = $frame[1]
  $S::Flash($frame[0])
  $out.flashed = $true
}

try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $text = $xml.GetElementsByTagName('text')
  $null = $text.Item(0).AppendChild($xml.CreateTextNode('agent-hands needs you'))
  $null = $text.Item(1).AppendChild($xml.CreateTextNode($env:AGENT_HANDS_MESSAGE))
  # Toasts need a registered app id. PowerShell's own is present on every Windows install.
  $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show(
    [Windows.UI.Notifications.ToastNotification]::new($xml))
  $out.toast = $true
} catch {
  $out.toastError = "$_"
}

if ($frame) {
  $quiet = [int]$env:AGENT_HANDS_QUIET_MS
  $out.idleMs = $S::WaitQuiet($quiet, [int]$env:AGENT_HANDS_WAIT_MS)
  if ($out.idleMs -ge $quiet) { $out.raised = $S::Raise($frame[0]) }
}

[Console]::Out.WriteLine((ConvertTo-Json $out -Compress))
