const { execFile } = require('child_process');

const POWERSHELL = 'powershell.exe';
const TIMEOUT_MS = 2500;

function execPowerShell(script) {
  return new Promise(resolve => {
    try {
      execFile(
        POWERSHELL,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          resolve(stdout.trim());
        }
      );
    } catch {
      resolve(null);
    }
  });
}

function winApiScript() {
  return `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class RockyWinApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
`;
}

async function listWindows(excludedPid) {
  if (process.platform !== 'win32') return [];

  const script = `
${winApiScript()}
$excludedPid = ${Number(excludedPid) || 0}
$items = New-Object System.Collections.Generic.List[object]
[RockyWinApi]::EnumWindows({
  param([IntPtr] $hWnd, [IntPtr] $lParam)

  if (-not [RockyWinApi]::IsWindowVisible($hWnd)) { return $true }

  $pid = 0
  [RockyWinApi]::GetWindowThreadProcessId($hWnd, [ref] $pid) | Out-Null
  if ($pid -eq $excludedPid) { return $true }

  $titleLength = [RockyWinApi]::GetWindowTextLength($hWnd)
  if ($titleLength -le 0) { return $true }

  $rect = New-Object RockyWinApi+RECT
  if (-not [RockyWinApi]::GetWindowRect($hWnd, [ref] $rect)) { return $true }

  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 160 -or $height -lt 100) { return $true }
  if ($rect.Left -lt -20000 -or $rect.Top -lt -20000) { return $true }

  $title = New-Object System.Text.StringBuilder ($titleLength + 1)
  [RockyWinApi]::GetWindowText($hWnd, $title, $title.Capacity) | Out-Null

  $items.Add([pscustomobject]@{
    hwnd = $hWnd.ToInt64()
    title = $title.ToString()
    x = $rect.Left
    y = $rect.Top
    width = $width
    height = $height
  }) | Out-Null

  return $true
}, [IntPtr]::Zero) | Out-Null

$items | ConvertTo-Json -Compress
`;

  const output = await execPowerShell(script);
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function getWindowBounds(hwnd) {
  if (process.platform !== 'win32' || !hwnd) return null;

  const script = `
${winApiScript()}
$hWnd = [IntPtr]::new([Int64]"${String(hwnd)}")
if (-not [RockyWinApi]::IsWindowVisible($hWnd)) { return }

$rect = New-Object RockyWinApi+RECT
if (-not [RockyWinApi]::GetWindowRect($hWnd, [ref] $rect)) { return }

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 160 -or $height -lt 100) { return }
if ($rect.Left -lt -20000 -or $rect.Top -lt -20000) { return }

[pscustomobject]@{
  hwnd = $hWnd.ToInt64()
  x = $rect.Left
  y = $rect.Top
  width = $width
  height = $height
} | ConvertTo-Json -Compress
`;

  const output = await execPowerShell(script);
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

module.exports = { getWindowBounds, listWindows };
