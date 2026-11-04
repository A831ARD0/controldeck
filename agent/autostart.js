// Arranque automático al iniciar sesión, sin permisos de administrador.
// macOS: un LaunchAgent del usuario (se reinicia solo si se cierra).
// Windows: un script oculto en la carpeta de Inicio del usuario (sin ventana de consola).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';

export const LABEL = 'com.controldeck.agent';

// Homebrew instala Node en una carpeta con la versión (Cellar/node/25.9.0) que cambia al
// actualizar. Se usa el enlace estable cuando apunta al mismo programa.
export function stableNodePath(execPath = process.execPath, { exists = fs.existsSync, realpath = fs.realpathSync } = {}) {
  if (!/\/Cellar\/node(@\d+)?\//.test(execPath)) return execPath;
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { if (exists(candidate) && realpath(candidate) === realpath(execPath)) return candidate; } catch {}
  }
  return execPath;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildMacPlist({ node, script, home, logFile }) {
  const args = [node, ...(script ? [script] : []), '--no-open', '--home', home].map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

// VBScript que arranca el agente sin ventana. Las comillas se duplican según las reglas de VBScript.
export function buildWindowsLauncher({ node, script, home }) {
  const q = (s) => `""${String(s).replace(/"/g, '')}""`;
  const cmd = [q(node), ...(script ? [q(script)] : []), '--no-open', '--home', q(home)].join(' ');
  return `' ControlDeck: arranca el agente al iniciar sesión, sin ventana.\r\nCreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n`;
}

export function autostartPaths(platform = process.platform, env = process.env, homedir = os.homedir()) {
  if (platform === 'darwin') return { file: path.join(homedir, 'Library', 'LaunchAgents', `${LABEL}.plist`) };
  if (platform === 'win32') {
    const appData = env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
    return { file: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ControlDeck.vbs') };
  }
  throw new Error('El arranque automático solo está disponible en macOS y Windows');
}

const run = (execFile, cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || err?.message || '') })));

export async function installAutostart({ script, home, node = stableNodePath(), platform = process.platform, execFile = nodeExecFile, uid = process.getuid?.(), paths = autostartPaths(platform) }) {
  fs.mkdirSync(path.dirname(paths.file), { recursive: true });
  if (platform === 'darwin') {
    fs.writeFileSync(paths.file, buildMacPlist({ node, script, home, logFile: path.join(home, 'agente.log') }), { mode: 0o644 });
    await run(execFile, 'launchctl', ['bootout', `gui/${uid}`, paths.file]);
    const r = await run(execFile, 'launchctl', ['bootstrap', `gui/${uid}`, paths.file]);
    if (!r.ok) throw new Error(`launchctl no pudo cargar el agente: ${r.out.trim()}`);
  } else {
    fs.writeFileSync(paths.file, buildWindowsLauncher({ node, script, home }));
    await run(execFile, 'wscript.exe', [paths.file]);
  }
  return paths.file;
}

export async function uninstallAutostart({ platform = process.platform, execFile = nodeExecFile, uid = process.getuid?.(), paths = autostartPaths(platform) }) {
  if (platform === 'darwin') await run(execFile, 'launchctl', ['bootout', `gui/${uid}`, paths.file]);
  const existed = fs.existsSync(paths.file);
  fs.rmSync(paths.file, { force: true });
  return existed;
}
