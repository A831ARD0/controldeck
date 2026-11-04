# Ayudante de ControlDeck para Windows. Lo arranca el agente una sola vez y recibe peticiones JSON,
# una por línea, por la entrada estándar. Responde una línea JSON por petición.
# No ejecuta texto como comando: cada operación es una llamada fija a la API de Windows.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CDInput {
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
  }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO l);
  [DllImport("user32.dll")] public static extern bool LockWorkStation();

  const uint EXTENDED = 1, KEYUP = 2, UNICODE = 4;

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
  }

  static void Send(List<INPUT> list) {
    var arr = list.ToArray();
    uint sent = SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    if (sent != arr.Length) throw new Exception("Windows bloqueó las teclas. Si la ventana activa corre como administrador, ejecuta el agente como administrador.");
  }

  public static void Combo(ushort[] mods, ushort key, bool extended) {
    var list = new List<INPUT>();
    foreach (var m in mods) list.Add(Key(m, 0, 0));
    uint ext = extended ? EXTENDED : 0;
    list.Add(Key(key, 0, ext));
    list.Add(Key(key, 0, ext | KEYUP));
    for (int i = mods.Length - 1; i >= 0; i--) list.Add(Key(mods[i], 0, KEYUP));
    Send(list);
  }

  public static void Text(string s) {
    var list = new List<INPUT>();
    foreach (char c in s) {
      if (c == '\r') continue;
      if (c == '\n') { list.Add(Key(0x0D, 0, 0)); list.Add(Key(0x0D, 0, KEYUP)); continue; }
      list.Add(Key(0, c, UNICODE));
      list.Add(Key(0, c, UNICODE | KEYUP));
    }
    if (list.Count > 0) Send(list);
  }

  public static string Foreground() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }

  // Mouse: movimiento relativo, botones y rueda (MOUSEEVENTF_*).
  public static void Mouse(uint flags, int dx, int dy, int data) {
    var i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.dwFlags = flags; i.u.mi.mouseData = unchecked((uint)data);
    var list = new List<INPUT>(); list.Add(i); Send(list);
  }

  // Volumen exacto sin depender de COM: baja todo y sube de 2 en 2 (cada tecla son 2 %).
  public static void SetVolume(int percent) {
    var list = new List<INPUT>();
    for (int k = 0; k < 50; k++) { list.Add(Key(0xAE, 0, EXTENDED)); list.Add(Key(0xAE, 0, EXTENDED | KEYUP)); }
    for (int k = 0; k < percent / 2; k++) { list.Add(Key(0xAF, 0, EXTENDED)); list.Add(Key(0xAF, 0, EXTENDED | KEYUP)); }
    Send(list);
  }

  public static long IdleMs() {
    var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref l)) return 0;
    return (long)unchecked((uint)Environment.TickCount - l.dwTime);
  }
}
public class CDWinItem { public string id; public string app; public string title; public bool active; public bool minimized; public string proc; public object tabs; }

// Ventanas: lista de ventanas principales visibles, mostrar una y acomodarla en la pantalla.
public static class CDWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT value, int size);

  static string Text(IntPtr h) { var sb = new System.Text.StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  static string Class(IntPtr h) { var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }

  // Una ventana "de verdad": visible, principal, sin dueño, no de herramientas y no oculta por DWM.
  static bool IsMain(IntPtr h) {
    if (!IsWindow(h) || !IsWindowVisible(h)) return false;
    if (GetAncestor(h, 2) != h || GetWindow(h, 4) != IntPtr.Zero) return false;
    int ex = GetWindowLong(h, -20);
    if ((ex & 0x80) != 0 || (ex & 0x08000000) != 0) return false;
    int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    string c = Class(h);
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;
    return Text(h).Length > 0;
  }

  public static List<CDWinItem> List() {
    var list = new List<CDWinItem>();
    IntPtr fg = GetForegroundWindow();
    var names = new Dictionary<uint, string>();
    var procs = new Dictionary<uint, string>();
    EnumWindows((h, l) => {
      if (list.Count >= 80 || !IsMain(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string app, proc;
      if (!names.TryGetValue(pid, out app)) {
        try { var p = System.Diagnostics.Process.GetProcessById((int)pid); app = p.MainModule != null && p.MainModule.FileVersionInfo.FileDescription != null && p.MainModule.FileVersionInfo.FileDescription.Length > 0 ? p.MainModule.FileVersionInfo.FileDescription : p.ProcessName; }
        catch { try { app = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { app = ""; } }
        names[pid] = app;
      }
      if (!procs.TryGetValue(pid, out proc)) {
        try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { proc = ""; }
        procs[pid] = proc;
      }
      var w = new CDWinItem(); w.id = h.ToInt64().ToString(); w.app = app; w.proc = proc; w.title = Text(h); w.minimized = IsIconic(h); w.active = h == fg;
      list.Add(w);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static IntPtr Resolve(string id) {
    IntPtr h = id == "front" ? GetForegroundWindow() : new IntPtr(long.Parse(id));
    if (h == IntPtr.Zero || !IsMain(h)) throw new Exception("Esa ventana ya no existe");
    return h;
  }

  public static void FocusId(string id) { Focus(Resolve(id)); }

  static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    // Windows solo deja cambiar la ventana al frente después de una tecla; Alt no hace nada visible.
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }

  public static void Do(string id, string op, double fx, double fy, double fw, double fh) {
    IntPtr h = Resolve(id);
    if (op == "minimize") { ShowWindow(h, 6); return; }
    Focus(h);
    if (op == "focus") return;
    if (op == "maximize") { ShowWindow(h, 3); return; }
    if (IsZoomed(h)) ShowWindow(h, 9);
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
    var a = mi.rcWork;
    int aw = a.Right - a.Left, ah = a.Bottom - a.Top;
    int x = a.Left + (int)Math.Round(fx * aw), y = a.Top + (int)Math.Round(fy * ah);
    int w = (int)Math.Round(fw * aw), hh = (int)Math.Round(fh * ah);
    // Las ventanas de Windows 10/11 tienen un borde invisible; se compensa para que queden pegadas.
    RECT wr, fr;
    if (GetWindowRect(h, out wr) && DwmGetWindowAttribute(h, 9, out fr, Marshal.SizeOf(typeof(RECT))) == 0) {
      x -= fr.Left - wr.Left; y -= fr.Top - wr.Top;
      w += (fr.Left - wr.Left) + (wr.Right - fr.Right); hh += (fr.Top - wr.Top) + (wr.Bottom - fr.Bottom);
    }
    SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0004 | 0x0040);
  }
}
"@

# Pestañas de los navegadores con UI Automation. Solo se recorre la parte de arriba de la ventana
# (la barra de pestañas) y nunca el contenido de las páginas, que puede ser enorme.
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Windows.Automation;

public class CDTabItem { public string id; public string title; public bool active; }

public static class CDTabs {
  public static readonly string[] Browsers = { "chrome", "msedge", "brave", "firefox", "vivaldi", "opera" };

  static void Walk(AutomationElement e, int depth, List<AutomationElement> found) {
    if (depth > 12 || found.Count >= 60) return;
    var walker = TreeWalker.ControlViewWalker;
    AutomationElement c;
    try { c = walker.GetFirstChild(e); } catch { return; }
    while (c != null && found.Count < 60) {
      ControlType t = null;
      try { t = c.Current.ControlType; } catch { }
      if (t == ControlType.TabItem) found.Add(c);
      else if (t != ControlType.Document) Walk(c, depth + 1, found);
      try { c = walker.GetNextSibling(c); } catch { c = null; }
    }
  }

  static List<AutomationElement> Items(IntPtr h) {
    var found = new List<AutomationElement>();
    Walk(AutomationElement.FromHandle(h), 0, found);
    return found;
  }

  public static CDTabItem[] List(string hwnd) {
    var h = new IntPtr(long.Parse(hwnd));
    var list = new List<CDTabItem>();
    var items = Items(h);
    for (int i = 0; i < items.Count; i++) {
      var t = new CDTabItem();
      t.id = "t:" + hwnd + ":0:" + i;
      try { t.title = items[i].Current.Name; } catch { t.title = ""; }
      object p;
      if (items[i].TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { try { t.active = ((SelectionItemPattern)p).Current.IsSelected; } catch { } }
      list.Add(t);
    }
    return list.ToArray();
  }

  public static void Select(string hwnd, int index) {
    var items = Items(new IntPtr(long.Parse(hwnd)));
    if (index >= items.Count) throw new Exception("Esa pestaña ya se cerró");
    object p;
    if (items[index].TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) ((SelectionItemPattern)p).Select();
    else if (items[index].TryGetCurrentPattern(InvokePattern.Pattern, out p)) ((InvokePattern)p).Invoke();
    else throw new Exception("No se pudo cambiar a esa pestaña");
  }
}
"@

Add-Type -AssemblyName System.Windows.Forms
[void][CDWin]::SetProcessDPIAware()

function Get-CDWindows {
  $list = @([CDWin]::List())
  foreach ($w in $list) {
    if ([CDTabs]::Browsers -contains $w.proc) { try { $w.tabs = [CDTabs]::List($w.id) } catch { } }
  }
  return $list
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $res = [ordered]@{ id = $null; ok = $false }
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    switch ($req.op) {
      'combo'      { [CDInput]::Combo([uint16[]]@($req.mods), [uint16]$req.key, [bool]$req.extended) }
      'text'       { [CDInput]::Text([string]$req.text) }
      'open'       { Start-Process -FilePath ([string]$req.target) }
      'foreground' { $res.result = [CDInput]::Foreground() }
      'idle'       { $res.result = [CDInput]::IdleMs() }
      'mouse'      { [CDInput]::Mouse([uint32]$req.flags, [int]$req.dx, [int]$req.dy, [int]$req.data) }
      'setvolume'  { [CDInput]::SetVolume([int]$req.value) }
      'battery'    { $p = [System.Windows.Forms.SystemInformation]::PowerStatus; if ($p.BatteryChargeStatus -band 128) { $res.result = $null } else { $res.result = @{ percent = [int]([math]::Round($p.BatteryLifePercent * 100)); charging = ($p.PowerLineStatus -eq 'Online') } } }
      'lock'       { [void][CDInput]::LockWorkStation() }
      'sleep'      { [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) }
      'clipboard'  { $res.result = [System.Windows.Forms.Clipboard]::GetText() }
      'setclipboard' { if ([string]::IsNullOrEmpty([string]$req.text)) { [System.Windows.Forms.Clipboard]::Clear() } else { [System.Windows.Forms.Clipboard]::SetText([string]$req.text) } }
      'windows'    { $res.result = @(Get-CDWindows) }
      'tab'        { $p = ([string]$req.target).Split(':'); [CDWin]::FocusId($p[1]); [CDTabs]::Select($p[1], [int]$p[3]) }
      'window'     { $f = @($req.frame); if ($f.Count -ne 4) { $f = @(0, 0, 1, 1) }; [CDWin]::Do([string]$req.target, [string]$req.what, [double]$f[0], [double]$f[1], [double]$f[2], [double]$f[3]) }
      default      { throw "Operación desconocida" }
    }
    $res.ok = $true
  } catch {
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}
