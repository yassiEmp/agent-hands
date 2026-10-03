# Click "Allow" on the browser's "Allow remote debugging?" dialog. Spawned by approve.mjs.
#
# The dialog is an OWNED top-level window (class Chrome_WidgetWin_1, owner = the browser frame).
# UI Automation shows it only inside the browser window's tree, so a tree search reaches it after
# walking the page content. On a heavy profile that walk outlives any budget. EnumWindows lists
# the dialog directly, and its own subtree is a dozen nodes.
#
# Runs as one loop until the parent kills it, the parent dies, or the lifetime runs out.
# Writes one JSON line per event to stdout. Input comes from environment variables:
#   AGENT_HANDS_ALLOW       lower-case affirmative labels, one per line
#   AGENT_HANDS_PARENT_PID  exit when this process is gone
#   AGENT_HANDS_DLL         cache path for the compiled EnumWindows helper
#
# Cmdlets that autoload a module (Get-Date, Get-Process, Start-Sleep) are replaced by .NET calls.
# Every module load adds startup time, and the dialog is waiting.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$helper = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentHandsDialogs {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);

  // Visible owned Chromium windows: [hwnd, pid] pairs.
  public static List<long[]> Owned() {
    var found = new List<long[]>();
    EnumWindows((hwnd, _) => {
      if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4) == IntPtr.Zero) return true;
      var cls = new StringBuilder(64);
      GetClassName(hwnd, cls, cls.Capacity);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      found.Add(new long[] { hwnd.ToInt64(), pid });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

# Compiling C# starts csc.exe, which measured 14s on a loaded machine. Compile once to a DLL,
# then load it. A temp name plus a move keeps two approvers from reading a half-written file.
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
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$allow = @($env:AGENT_HANDS_ALLOW -split "`n" | Where-Object { $_ })
$parent = [int]$env:AGENT_HANDS_PARENT_PID
$browsers = @('msedge', 'chrome', 'brave', 'vivaldi', 'chromium')
$deadline = [DateTime]::UtcNow.AddMinutes(5)

$A = [Windows.Automation.AutomationElement]
$buttonCond = New-Object Windows.Automation.AndCondition(
  (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Button)),
  (New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty, 'MdTextButton')))

function Test-Allow([string]$name) {
  $n = $name.Trim().ToLowerInvariant().TrimEnd('.', [char]0x2026, '!')
  foreach ($w in $allow) {
    if ($n -eq $w -or $n.StartsWith("$w ") -or $n.EndsWith(" $w")) { return $true }
  }
  return $false
}

function Test-Alive([int]$id) {
  try { return -not [Diagnostics.Process]::GetProcessById($id).HasExited } catch { return $false }
}

function Emit($event) { [Console]::Out.WriteLine(($event | ConvertTo-Json -Compress)) }

while ([DateTime]::UtcNow -lt $deadline) {
  if ($parent -and -not (Test-Alive $parent)) { exit 0 }
  foreach ($w in [AgentHandsDialogs]::Owned()) {
    try {
      $proc = [Diagnostics.Process]::GetProcessById([int]$w[1]).ProcessName.ToLowerInvariant()
      if ($browsers -notcontains $proc) { continue }
      $buttons = $A::FromHandle([IntPtr]$w[0]).FindAll([Windows.Automation.TreeScope]::Descendants, $buttonCond)
      if ($buttons.Count -eq 0) { continue }
      $names = @($buttons | ForEach-Object { $_.Current.Name })
      $hits = @($buttons | Where-Object { Test-Allow $_.Current.Name })
      if ($hits.Count -eq 0) { Emit @{ ev = 'unmatched'; process = $proc; names = $names }; continue }
      foreach ($b in $hits) {
        # Report first. Invoke can block until the browser opens the socket, and the parent kills
        # this process the moment it does, so a line written after Invoke is often lost.
        Emit @{ ev = 'clicked'; process = $proc; name = $b.Current.Name }
        $b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
      }
    } catch {
      # The dialog closes between listing and clicking. The next pass sees the new state.
    }
  }
  [Threading.Thread]::Sleep(250)
}
