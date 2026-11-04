#!/usr/bin/env node
// Compila ControlDeck para distribuir.
//   macOS  → dist/ControlDeck.app (Node incluido, sin Terminal) y dist/ControlDeck-macOS.zip
//   Windows → dist/ControlDeck-Windows.zip (carpeta lista para usar; requiere Node.js instalado)
// En Windows, además, genera ControlDeck.exe si se ejecuta allí.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ALL_ASSETS } from '../agent/assets.js';
import { fetchNode } from './fetch-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(DIST, 'build');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const only = process.argv[2]; // 'mac' | 'win' | undefined (lo que aplique a esta computadora)

const step = (msg) => console.log(`\n▸ ${msg}`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString();

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// --- 1. Un solo archivo con todo el código del agente ------------------------------------

async function bundle() {
  step('Empaquetando el código');
  const out = path.join(WORK, 'controldeck.cjs');
  await build({
    entryPoints: [path.join(ROOT, 'bin', 'controldeck.js')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['bufferutil', 'utf-8-validate'],
    define: { 'import.meta.url': 'undefined' },
    banner: { js: '/* ControlDeck ' + pkg.version + ' */' },
    legalComments: 'inline',
    outfile: out, logLevel: 'warning',
  });
  return out;
}

// --- 2. Ejecutable único: Node + código + archivos de la app de tablet --------------------

// El Node que hace de base debe traer el "fusible" de ejecutables únicos (el de Homebrew no).
const hasSeaFuse = (bin) => fs.readFileSync(bin).includes('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');

async function buildExecutable(main, output) {
  step(`Creando el ejecutable (${path.basename(output)})`);
  const assets = Object.fromEntries(ALL_ASSETS.map((rel) => [rel, path.join(ROOT, rel)]));
  for (const file of Object.values(assets)) if (!fs.existsSync(file)) throw new Error(`Falta ${file}`);
  const config = path.join(WORK, 'sea-config.json');
  fs.writeFileSync(config, JSON.stringify({ main, output, disableExperimentalSEAWarning: true, useCodeCache: false, assets }, null, 2));
  const base = hasSeaFuse(process.execPath) ? process.execPath : await fetchNode();
  console.log(`  base: Node ${process.version} (${base === process.execPath ? 'el instalado' : 'oficial de nodejs.org, verificado'})`);
  sh(base, ['--build-sea', config], { cwd: ROOT });
  if (!fs.existsSync(output)) throw new Error('Node no generó el ejecutable');
}

// --- 3. App de macOS ------------------------------------------------------------------

function macIcon(resources) {
  // Ícono a partir de web/icon.svg con las herramientas de macOS (Quick Look, sips, iconutil).
  try {
    const tmp = path.join(WORK, 'icon');
    fs.mkdirSync(tmp, { recursive: true });
    sh('qlmanage', ['-t', '-s', '1024', '-o', tmp, path.join(ROOT, 'web', 'icon.svg')]);
    const png = path.join(tmp, 'icon.svg.png');
    const set = path.join(tmp, 'AppIcon.iconset');
    fs.mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
      sh('sips', ['-z', String(size), String(size), png, '--out', path.join(set, `icon_${size}x${size}.png`)]);
      sh('sips', ['-z', String(size * 2), String(size * 2), png, '--out', path.join(set, `icon_${size}x${size}@2x.png`)]);
    }
    sh('iconutil', ['-c', 'icns', set, '-o', path.join(resources, 'AppIcon.icns')]);
    return true;
  } catch (err) {
    console.warn(`  (sin ícono: ${err.message.split('\n')[0]})`);
    return false;
  }
}

function infoPlist(hasIcon) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.controldeck.agent</string>
  <key>CFBundleName</key><string>ControlDeck</string>
  <key>CFBundleDisplayName</key><string>ControlDeck</string>
  <key>CFBundleExecutable</key><string>ControlDeck</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
  <key>CFBundleVersion</key><string>${pkg.version}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>ControlDeck usa System Events para mandar los atajos y el texto que tocas en la tablet.</string>
  <key>NSLocalNetworkUsageDescription</key><string>ControlDeck recibe las conexiones de tus tablets en la red local.</string>${hasIcon ? '\n  <key>CFBundleIconFile</key><string>AppIcon</string>' : ''}
</dict>
</plist>
`;
}

// Firma: con un certificado de Apple (Developer ID o Apple Development) la firma es estable entre
// compilaciones y macOS conserva el permiso de Accesibilidad. Sin certificado se firma "ad hoc",
// que funciona igual pero obliga a dar el permiso de nuevo tras cada compilación.
// CONTROLDECK_SIGN_IDENTITY permite elegir otra identidad, o "-" para forzar la firma ad hoc.
function signingIdentity() {
  if (process.env.CONTROLDECK_SIGN_IDENTITY) return process.env.CONTROLDECK_SIGN_IDENTITY;
  try {
    const out = sh('security', ['find-identity', '-v', '-p', 'codesigning']);
    const names = [...out.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return names.find((n) => n.startsWith('Developer ID Application:')) ?? names.find((n) => n.startsWith('Apple Development:')) ?? '-';
  } catch { return '-'; }
}

function signApp(app) {
  const identity = signingIdentity();
  const sign = (id) => sh('codesign', ['--force', '--deep', '--sign', id, '--identifier', 'com.controldeck.agent', '--timestamp=none', app], { timeout: 120_000 });
  try {
    sign(identity);
    console.log(`  firmada con: ${identity === '-' ? 'firma local (ad hoc)' : identity}`);
  } catch (err) {
    if (identity === '-') throw err;
    console.warn(`  No se pudo firmar con "${identity}" (${String(err.stderr || err.message).trim().split('\n')[0]}); se usa firma local.`);
    sign('-');
  }
  sh('codesign', ['--verify', '--deep', '--strict', app]);
}

async function buildMac(main) {
  const app = path.join(DIST, 'ControlDeck.app');
  const macos = path.join(app, 'Contents', 'MacOS');
  const resources = path.join(app, 'Contents', 'Resources');
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  await buildExecutable(main, path.join(macos, 'ControlDeck'));
  step('Armando ControlDeck.app');
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), infoPlist(macIcon(resources)));
  signApp(app);
  step('Comprimiendo ControlDeck-macOS.zip');
  sh('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(DIST, 'ControlDeck-macOS.zip')]);
  return app;
}

// --- 4. Windows -----------------------------------------------------------------------

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (skip(src, entry)) continue;
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, skip);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

async function buildWindows(main) {
  step('Armando la carpeta para Windows');
  const dir = path.join(DIST, 'ControlDeck-Windows');
  for (const d of ['bin', 'agent', 'shared', 'web', 'admin-web']) copyDir(path.join(ROOT, d), path.join(dir, d));
  for (const f of ['package.json', 'package-lock.json', 'README.md', 'SECURITY.md']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  // Solo las dependencias de ejecución (sin herramientas de compilación).
  sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir });
  const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, 'Abrir ControlDeck.cmd'), crlf(`@echo off
where node >nul 2>nul || (echo Instala Node.js 22 o superior desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b 1)
node "%~dp0bin\\controldeck.js" %*
`));
  fs.writeFileSync(path.join(dir, 'Abrir al iniciar sesion.cmd'), crlf(`@echo off
node "%~dp0bin\\controldeck.js" --instalar
pause
`));
  fs.writeFileSync(path.join(dir, 'LEEME.txt'), crlf(`ControlDeck ${pkg.version} para Windows

1. Instala Node.js 22 o superior (https://nodejs.org).
2. Abre "Abrir ControlDeck.cmd". Acepta el aviso del Firewall de Windows (redes privadas).
3. En la tablet abre la dirección que aparece en la ventana y aprueba el código en el panel.
4. Para que se abra solo al iniciar sesión: "Abrir al iniciar sesion.cmd".
`));
  if (process.platform === 'win32') await buildExecutable(main, path.join(dir, 'ControlDeck.exe'));
  step('Comprimiendo ControlDeck-Windows.zip');
  if (process.platform === 'darwin') sh('ditto', ['-c', '-k', '--keepParent', dir, path.join(DIST, 'ControlDeck-Windows.zip')]);
  else sh('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${dir}' -DestinationPath '${path.join(DIST, 'ControlDeck-Windows.zip')}' -Force`]);
}

// --- Principal --------------------------------------------------------------------------

const main = await bundle();
if ((only ?? (process.platform === 'darwin' ? 'mac' : '')) === 'mac' || (!only && process.platform === 'darwin')) {
  if (process.platform !== 'darwin') throw new Error('La app de macOS solo se puede compilar en una Mac');
  await buildMac(main);
}
if (!only || only === 'win') await buildWindows(main);

step('Listo');
for (const f of fs.readdirSync(DIST)) {
  const p = path.join(DIST, f);
  if (f === 'build') continue;
  const size = fs.statSync(p).isFile() ? `${(fs.statSync(p).size / 1048576).toFixed(1)} MB` : 'carpeta';
  console.log(`  dist/${f}  (${size})`);
}
