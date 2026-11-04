#!/usr/bin/env node
// Instalador de ControlDeck para Windows: dist/ControlDeck-Setup-<versión>.exe
//
// Es un solo programa (Node incluido, no hace falta instalar nada más). Al abrirlo se instala
// solo: ver agent/win-install.js.
//
// Node solo arma ejecutables para el sistema en el que corre, así que el .exe se arma en una PC
// con Windows a la que esta Mac llega por SSH: su nombre va en CONTROLDECK_WIN_HOST (el de tu
// ~/.ssh/config o usuario@equipo). Ahí se usa el Node oficial de nodejs.org de la misma versión, verificado
// con su SHA-256. Esa PC solo necesita PowerShell; no se le instala nada.
//
// Uso:  CONTROLDECK_WIN_HOST=mi-pc npm run release:win

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ALL_ASSETS } from '../agent/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const host = process.env.CONTROLDECK_WIN_HOST;
if (!host) {
  console.error('Falta CONTROLDECK_WIN_HOST: el equipo con Windows al que esta computadora llega por SSH.\n  Ejemplo: CONTROLDECK_WIN_HOST=mi-pc npm run release:win');
  process.exit(1);
}
const nodeVersion = process.version;

const step = (msg) => console.log(`\n▸ ${msg}`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60_000, ...opts }).toString();

step('Empaquetando el código');
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), 'win'], { stdio: 'inherit' });
const kit = path.join(DIST, 'build', 'win-kit');
fs.rmSync(kit, { recursive: true, force: true });
fs.mkdirSync(kit, { recursive: true });
fs.copyFileSync(path.join(DIST, 'build', 'controldeck.cjs'), path.join(kit, 'controldeck.cjs'));
const assets = {};
for (const rel of ALL_ASSETS) {
  const to = path.join(kit, 'assets', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), to);
  assets[rel] = `assets/${rel}`;
}

step('Creando el ícono');
// Ícono .ico con imágenes PNG (Windows Vista y posteriores), a partir de web/icon.svg.
if (process.platform === 'darwin') {
  const tmp = path.join(DIST, 'build', 'win-icon');
  fs.mkdirSync(tmp, { recursive: true });
  sh('qlmanage', ['-t', '-s', '256', '-o', tmp, path.join(ROOT, 'web', 'icon.svg')]);
  const big = path.join(tmp, 'icon.svg.png');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => {
    const out = path.join(tmp, `${s}.png`);
    sh('sips', ['-z', String(s), String(s), big, '--out', out]);
    return fs.readFileSync(out);
  });
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, e); header.writeUInt8(sizes[i] % 256, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(kit, 'ControlDeck.ico'), Buffer.concat([header, ...pngs]));
  assets['ControlDeck.ico'] = 'ControlDeck.ico';
  fs.copyFileSync(path.join(kit, 'ControlDeck.ico'), path.join(DIST, 'ControlDeck.ico'));
}

fs.writeFileSync(path.join(kit, 'sea-config.json'), JSON.stringify({
  main: 'controldeck.cjs', output: 'ControlDeck.exe', disableExperimentalSEAWarning: true, useCodeCache: false, assets,
}, null, 2));

fs.writeFileSync(path.join(kit, 'build.ps1'), `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$v = '${nodeVersion}'
$cache = Join-Path $env:LOCALAPPDATA 'ControlDeck-build'
$node = Join-Path $cache "node-$v-win-x64\\node.exe"
if (-not (Test-Path $node)) {
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  $zip = Join-Path $cache "node-$v-win-x64.zip"
  Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile $zip -UseBasicParsing
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$v/SHASUMS256.txt" -UseBasicParsing).Content
  $line = ($sums -split "\`n") | Where-Object { $_ -match "  node-$v-win-x64.zip$" } | Select-Object -First 1
  $expected = ($line -split '\\s+')[0]
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $expected -ne $got) { Remove-Item $zip; throw "La descarga de Node no coincide con su suma SHA-256" }
  Expand-Archive $zip -DestinationPath $cache -Force
  Remove-Item $zip
}
Set-Location $PSScriptRoot
& $node --build-sea sea-config.json
if (-not (Test-Path ControlDeck.exe)) { throw 'Node no generó ControlDeck.exe' }
"ok"
`);

step(`Armando el .exe en ${host}`);
const zip = path.join(DIST, 'build', 'win-kit.zip');
fs.rmSync(zip, { force: true });
sh('ditto', ['-c', '-k', kit, zip]);
sh('scp', ['-q', zip, `${host}:cd-win-kit.zip`]);
const remote = `$ErrorActionPreference = 'Stop'; $d = Join-Path $HOME 'cd-win-kit'; if (Test-Path $d) { Remove-Item $d -Recurse -Force }; Expand-Archive (Join-Path $HOME 'cd-win-kit.zip') -DestinationPath $d -Force; & (Join-Path $d 'build.ps1')`;
const out = sh('ssh', [host, 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(remote, 'utf16le').toString('base64')]);
if (!/ok\s*$/.test(out.trim())) throw new Error(`No se pudo armar el .exe:\n${out}`);
const exe = path.join(DIST, `ControlDeck-Setup-${pkg.version}.exe`);
sh('scp', ['-q', `${host}:cd-win-kit/ControlDeck.exe`, exe]);

step('Listo');
console.log(`  ${path.relative(ROOT, exe)}  (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
console.log('  Sin firma de código: Windows mostrará "Windows protegió tu PC" → "Más información" → "Ejecutar de todas formas".');
