#!/usr/bin/env node
// Arranca el agente de ControlDeck en esta computadora.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { installAutostart, uninstallAutostart, autostartPaths } from '../agent/autostart.js';
import { isCompiled, readAsset } from '../agent/assets.js';
import { selfInstall, selfUninstall, isInstalledCopy } from '../agent/win-install.js';
import { VERSION } from '../agent/version.js';
import { createDiagnostics } from '../agent/diagnostics.js';
import { startAgent } from '../agent/index.js';
import { createDriver } from '../agent/drivers/index.js';
import { defaultHome } from '../agent/store.js';

async function main() {
  const HELP = `ControlDeck: controla esta computadora desde una tablet.

  Uso: controldeck [opciones]

    --port <n>         Puerto para las tablets en la red local (4455)
    --admin-port <n>   Puerto del panel de administración, solo en esta computadora (4456)
    --bind <ip>        Dirección donde escuchar las tablets (0.0.0.0 = toda la red local)
    --home <carpeta>   Carpeta de datos (llaves, dispositivos, botones)
    --dry-run          Simula las acciones sin tocar la computadora
    --no-discovery     No anunciarse a otras computadoras en la red
    --no-open          No abrir el panel de administración en el navegador
    --instalar         Abrir el agente solo cada vez que inicies sesión
    --desinstalar      Dejar de abrirlo al iniciar sesión
    --panel            Abrir el panel del agente que ya está corriendo
    --diagnostico      Revisar permisos, firewall y red
    -h, --help         Muestra esta ayuda
  `;

  // Tanto en Node como en la app compilada, process.argv[0] y [1] son el programa y la ruta con
  // que se abrió; macOS además agrega -psn_… al abrir la app desde Finder.
  function userArgs() {
    return process.argv.slice(2).filter((a) => !a.startsWith('-psn_'));
  }

  let args;
  try {
    args = parseArgs({
      args: userArgs(),
      options: {
        port: { type: 'string', default: '4455' },
        'admin-port': { type: 'string', default: '4456' },
        bind: { type: 'string', default: '0.0.0.0' },
        home: { type: 'string', default: defaultHome() },
        'dry-run': { type: 'boolean', default: false },
        'no-discovery': { type: 'boolean', default: false },
        'no-open': { type: 'boolean', default: false },
        instalar: { type: 'boolean', default: false },
        desinstalar: { type: 'boolean', default: false },
        panel: { type: 'boolean', default: false },
        diagnostico: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values;
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    process.exit(2);
  }
  if (args.help) { console.log(HELP); process.exit(0); }

  const openUrl = (url) => {
    if (process.platform === 'darwin') execFile('open', [url], () => {});
    else if (process.platform === 'win32') execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], () => {});
  };
  // Para abrir algo y salir enseguida: se espera a que el navegador reciba el enlace, porque al
  // terminar el programa el sistema puede cortar lo que quedó pendiente.
  const openUrlSync = (url) => {
    try {
      if (process.platform === 'darwin') execFileSync('open', [url], { timeout: 8000 });
      else if (process.platform === 'win32') execFileSync('rundll32.exe', ['url.dll,FileProtocolHandler', url], { timeout: 8000, windowsHide: true });
    } catch {}
  };
  const panelFile = path.join(args.home, 'panel-url');

  // En la app compilada el propio ejecutable es el agente; desde el código se usa node + este archivo.
  const script = isCompiled ? null : fileURLToPath(import.meta.url);
  const autostartOptions = isCompiled ? { script: null, node: process.execPath } : { script };
  const selfCommand = isCompiled ? `"${process.execPath}"` : `node "${script}"`;

  if (args.diagnostico) {
    const checks = await createDiagnostics({ lanPort: Number(args.port) }).run();
    for (const c of checks) console.log(`${c.ok ? '✓' : '!'} ${c.title}\n    ${c.detail}`);
    process.exit(checks.every((c) => c.ok) ? 0 : 1);
  }

  // Windows: el .exe descargado se instala solo (programa, menú Inicio, arranque al iniciar sesión).
  if (isCompiled && process.platform === 'win32' && !isInstalledCopy(process.execPath)
    && !args.desinstalar && !args.panel && !args.diagnostico && !args.instalar) {
    let icon = null;
    try { icon = readAsset('ControlDeck.ico'); } catch {}
    try {
      await selfInstall({ execPath: process.execPath, home: args.home, version: VERSION, icon, openUrl: openUrlSync,
        installAutostart: (o) => installAutostart(o) });
    } catch (err) { console.error(`No se pudo instalar: ${err.message}`); }
    await new Promise((r) => setTimeout(r, 5000));
    process.exit(0);
  }

  if (args.instalar) {
    try {
      fs.mkdirSync(args.home, { recursive: true, mode: 0o700 });
      const file = await installAutostart({ ...autostartOptions, home: args.home });
      console.log(`Listo: ControlDeck se abrirá solo al iniciar sesión (${file}).
  Para ver el panel en cualquier momento: ${selfCommand} --panel`);
      if (process.platform === 'darwin') console.log(`En macOS, da permiso de Accesibilidad a "${isCompiled ? 'ControlDeck' : 'node'}" en Configuración del Sistema → Privacidad y seguridad → Accesibilidad.`);
      process.exit(0);
    } catch (err) { console.error(err.message); process.exit(1); }
  }
  if (args.desinstalar) {
    try {
      const existed = await uninstallAutostart({});
      if (isCompiled && process.platform === 'win32') {
        selfUninstall();
        await new Promise((r) => setTimeout(r, 3000));
        process.exit(0);
      }
      console.log(existed ? 'ControlDeck ya no se abrirá al iniciar sesión.' : 'No estaba configurado para abrirse al iniciar sesión.');
      process.exit(0);
    } catch (err) { console.error(err.message); process.exit(1); }
  }
  if (args.panel) {
    let url = '';
    try { url = fs.readFileSync(panelFile, 'utf8').trim(); } catch {}
    if (!/^http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+$/.test(url)) { console.error('El agente no está abierto en esta computadora.'); process.exit(1); }
    openUrlSync(url);
    console.log('Abriendo el panel de administración…');
    process.exit(0);
  }

  // macOS no vuelve a abrir una app que ya está corriendo: solo la "activa", y el agente (que no
  // tiene ventanas) no se entera. Por eso, al abrir la app desde Finder o Spotlight, el agente
  // sigue en un proceso aparte y la app se cierra; así, abrirla otra vez muestra el panel.
  if (isCompiled && process.platform === 'darwin' && !process.env.CD_DETACHED
    && String(process.env.XPC_SERVICE_NAME ?? '').startsWith('application.')) {
    // Si el agente ya está abierto, solo se muestra su panel (esperando a que `open` termine:
    // macOS cierra lo que dejó pendiente la app al salir).
    let url = '';
    try { url = fs.readFileSync(panelFile, 'utf8').trim(); } catch {}
    const alive = /^http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+$/.test(url) && await fetch(new URL(url).origin, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    if (alive) {
      openUrlSync(url);
      process.exit(0);
    }
    fs.mkdirSync(args.home, { recursive: true, mode: 0o700 });
    const log = fs.openSync(path.join(args.home, 'agente.log'), 'a');
    spawn(process.execPath, userArgs(), { detached: true, stdio: ['ignore', log, log], env: { ...process.env, CD_DETACHED: '1' } }).unref();
    process.exit(0);
  }

  const toPort = (v, name) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) { console.error(`Puerto inválido en --${name}`); process.exit(2); }
    return n;
  };

  if (!process.stdout.isTTY) {
    try {
      fs.mkdirSync(args.home, { recursive: true, mode: 0o700 });
      const log = fs.createWriteStream(path.join(args.home, 'agente.log'), { flags: 'a', mode: 0o600 });
      const write = (...a) => log.write(`[${new Date().toISOString()}] ${a.map(String).join(' ')}\n`);
      console.log = write;
      console.error = write;
    } catch {}
  }

  const driver = args['dry-run'] ? Object.assign(createDriver('mock'), { os: process.platform === 'win32' ? 'win' : 'mac' }) : createDriver();
  if (args['dry-run']) {
    let n = 0;
    const demo = [['Slack', 'Ana López', '¿Revisamos el reporte a las 4?'], ['Correo', 'Factura de noviembre', 'Tu factura ya está disponible'], ['Calendario', 'Junta en 10 minutos', 'Sala 2']];
    setInterval(() => { const [app, title, body] = demo[n % demo.length]; driver.pushNotification({ key: `demo${n++}`, app, title, body }); }, 20_000).unref();
  }

  let agent;
  try {
    agent = await startAgent({
      home: args.home,
      driver,
      port: toPort(args.port, 'port'),
      adminPort: toPort(args['admin-port'], 'admin-port'),
      bind: args.bind,
      discovery: !args['no-discovery'],
      onQuit: () => shutdown(0),
      autostart: process.platform === 'darwin' || process.platform === 'win32' ? {
        status: () => fs.existsSync(autostartPaths().file),
        set: async (on) => { if (on) await installAutostart({ ...autostartOptions, home: args.home }); else await uninstallAutostart({}); },
      } : undefined,
    });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      // Si ya hay un agente abierto (por ejemplo, al abrir la app dos veces), se muestra su panel.
      let url = '';
      try { url = fs.readFileSync(panelFile, 'utf8').trim(); } catch {}
      if (/^http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+$/.test(url)) { if (!args['no-open']) openUrlSync(url); process.exit(0); }
      console.error(`El puerto ${err.port} ya está en uso. Usa --port y --admin-port para cambiarlo.`);
    } else console.error(err);
    process.exit(1);
  }

  console.log(`
  ControlDeck listo en "${agent.identity.name}"${args['dry-run'] ? '  (modo simulación: no se ejecuta nada)' : ''}
    Huella de esta computadora: ${agent.identity.fingerprint}

    En la tablet abre:      ${agent.tabletUrls.join('  o  ') || '(no hay red local)'}
    Panel de administración: ${agent.adminUrl}
    Datos guardados en:      ${args.home}
  `);

  // El enlace del panel queda en un archivo privado para que `--panel` pueda abrirlo después.
  try { fs.writeFileSync(panelFile, agent.adminUrl, { mode: 0o600 }); } catch {}

  if (!args['no-open']) openUrl(agent.adminUrl);

  let closing = false;
  async function shutdown(code) {
    if (closing) process.exit(1);
    closing = true;
    console.log('\nCerrando ControlDeck…');
    try { fs.rmSync(panelFile, { force: true }); } catch {}
    await agent.close();
    process.exit(code);
  }
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
}

main().catch((err) => { console.error(err); process.exit(1); });
