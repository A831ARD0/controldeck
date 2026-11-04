// Instalador de Windows: el mismo ControlDeck.exe se instala solo al abrirlo desde Descargas.
//   - Se copia a %LOCALAPPDATA%\Programs\ControlDeck (sin permisos de administrador).
//   - Crea "ControlDeck" en el menú Inicio (abre el panel) y lo registra en
//     Configuración → Aplicaciones, desde donde se puede desinstalar.
//   - Lo deja abriéndose solo al iniciar sesión, lo arranca y abre el panel con la configuración guiada.
// Los datos (tablets, botones, permisos) viven aparte, en %APPDATA%\ControlDeck, y se conservan.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ControlDeck';

export function installPaths(env = process.env) {
  const local = env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? '', 'AppData', 'Local');
  const roaming = env.APPDATA ?? path.join(env.USERPROFILE ?? '', 'AppData', 'Roaming');
  const dir = path.join(local, 'Programs', 'ControlDeck');
  return {
    dir,
    exe: path.join(dir, 'ControlDeck.exe'),
    icon: path.join(dir, 'ControlDeck.ico'),
    panelVbs: path.join(dir, 'Abrir panel.vbs'),
    shortcut: path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ControlDeck.lnk'),
  };
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
export const isInstalledCopy = (execPath, env = process.env) => same(execPath, installPaths(env).exe);

const quiet = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000 }).toString(); } catch { return ''; } };
const ps = (script) => quiet('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Cierra el agente que esté corriendo: el ya instalado y la versión anterior que corría con Node.
function stopRunning() {
  ps(`Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'ControlDeck.exe' -and $_.ProcessId -ne ${process.pid}) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*controldeck.js*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}

function panelLauncher(exe, home) {
  const q = (s) => `""${String(s).replace(/"/g, '')}""`;
  return `' Abre el panel de ControlDeck sin ventana de consola.\r\nCreateObject("WScript.Shell").Run "${q(exe)} --panel --home ${q(home)}", 0, False\r\n`;
}

export async function selfInstall({ execPath, home, version, icon, installAutostart, openUrl, log = console.log }) {
  const p = installPaths();
  log(`Instalando ControlDeck ${version}…`);
  stopRunning();
  fs.mkdirSync(p.dir, { recursive: true });
  // El archivo puede tardar en soltarse después de cerrar el agente anterior.
  for (let i = 0; ; i++) {
    try { fs.copyFileSync(execPath, p.exe); break; } catch (err) {
      if (i >= 20) throw new Error(`No pude copiar ControlDeck a ${p.dir}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (icon) { try { fs.writeFileSync(p.icon, icon); } catch {} }
  fs.writeFileSync(p.panelVbs, panelLauncher(p.exe, home));

  // Menú Inicio.
  fs.mkdirSync(path.dirname(p.shortcut), { recursive: true });
  ps(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psq(p.shortcut)}); $s.TargetPath = 'wscript.exe'; $s.Arguments = '"' + ${psq(p.panelVbs)} + '"'; $s.Description = 'Panel de ControlDeck'; $s.IconLocation = ${psq(fs.existsSync(p.icon) ? p.icon : p.exe)} + ',0'; $s.WorkingDirectory = ${psq(p.dir)}; $s.Save()`);

  // Configuración → Aplicaciones.
  const size = Math.round(fs.statSync(p.exe).size / 1024);
  const reg = (name, type, value) => quiet('reg.exe', ['add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', String(value), '/f']);
  reg('DisplayName', 'REG_SZ', 'ControlDeck');
  reg('DisplayVersion', 'REG_SZ', version);
  reg('Publisher', 'REG_SZ', 'ControlDeck');
  reg('InstallLocation', 'REG_SZ', p.dir);
  reg('DisplayIcon', 'REG_SZ', fs.existsSync(p.icon) ? p.icon : p.exe);
  reg('UninstallString', 'REG_SZ', `"${p.exe}" --desinstalar`);
  reg('NoModify', 'REG_DWORD', 1);
  reg('NoRepair', 'REG_DWORD', 1);
  reg('EstimatedSize', 'REG_DWORD', size);

  // Arranque al iniciar sesión; esto también lo arranca ahora, sin ventana.
  fs.rmSync(path.join(home, 'panel-url'), { force: true });
  await installAutostart({ script: null, node: p.exe, home });

  // Abrir el panel en cuanto el agente esté listo.
  const panelFile = path.join(home, 'panel-url');
  for (let i = 0; i < 40; i++) {
    let url = '';
    try { url = fs.readFileSync(panelFile, 'utf8').trim(); } catch {}
    if (/^http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+$/.test(url)) {
      openUrl(url);
      log('Listo. El panel de ControlDeck se abrió en tu navegador.');
      log('Para volver a él: menú Inicio → ControlDeck.');
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  log('ControlDeck quedó instalado. Ábrelo desde el menú Inicio → ControlDeck.');
  return false;
}

// Desinstala: quita el arranque, el menú Inicio, el registro y la carpeta del programa.
// Los datos en %APPDATA%\ControlDeck se conservan por si se vuelve a instalar.
export function selfUninstall({ log = console.log } = {}) {
  const p = installPaths();
  stopRunning();
  fs.rmSync(p.shortcut, { force: true });
  quiet('reg.exe', ['delete', UNINSTALL_KEY, '/f']);
  // El programa no se puede borrar a sí mismo mientras corre: lo borra cmd unos segundos después.
  // Se lanza por WMI para que no lo cierre Windows junto con este proceso (cuando lo abre el
  // Programador de tareas o una sesión remota, sus procesos hijos se cierran al terminar).
  if (fs.existsSync(p.dir)) {
    const cmd = `cmd.exe /d /c ping -n 9 127.0.0.1 >nul & rmdir /s /q "${p.dir}"`;
    const viaWmi = ps(`(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psq(cmd)} }).ReturnValue`).trim();
    if (viaWmi !== '0') spawn('cmd.exe', ['/d', '/c', cmd.replace(/^cmd\.exe \/d \/c /, '')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  log('ControlDeck se desinstaló. Tus tablets y botones siguen guardados por si lo vuelves a instalar.');
}
