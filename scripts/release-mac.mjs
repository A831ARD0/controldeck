#!/usr/bin/env node
// Instalador de ControlDeck para Mac, listo para compartir:
//   1. Compila ControlDeck.app.
//   2. La firma con tu certificado "Developer ID Application" y el modo de ejecución reforzado
//      (hardened runtime) que pide Apple.
//   3. Arma dist/ControlDeck-<versión>.dmg (la app y un acceso a Aplicaciones para arrastrarla).
//   4. Lo manda a revisar a Apple (notarización) y le pega el visto bueno (staple), para que
//      macOS lo abra en cualquier Mac sin avisos.
//
// Antes, una sola vez:
//   - Crea el certificado: Xcode → Ajustes → Cuentas → tu equipo → Administrar certificados →
//     + → "Developer ID Application".
//   - Guarda la contraseña para la notarización (una contraseña de app de appleid.apple.com):
//       xcrun notarytool store-credentials controldeck --apple-id TU_CORREO --team-id TU_EQUIPO
//
// Uso:  npm run release:mac            (todo)
//       npm run release:mac -- --sin-notarizar   (solo firma y .dmg, para probar)
// CONTROLDECK_SIGN_IDENTITY elige otro certificado; CONTROLDECK_NOTARY_PROFILE otro perfil.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const skipNotary = process.argv.includes('--sin-notarizar');
const profile = process.env.CONTROLDECK_NOTARY_PROFILE || 'controldeck';

const step = (msg) => console.log(`\n▸ ${msg}`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60_000, ...opts }).toString();
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

if (process.platform !== 'darwin') fail('El instalador de Mac solo se puede crear en una Mac.');

function identity() {
  if (process.env.CONTROLDECK_SIGN_IDENTITY) return process.env.CONTROLDECK_SIGN_IDENTITY;
  const names = [...sh('security', ['find-identity', '-v', '-p', 'codesigning']).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const id = names.find((n) => n.startsWith('Developer ID Application:'));
  if (!id) {
    fail(`No encontré un certificado "Developer ID Application" en el llavero.
  Créalo en Xcode → Ajustes → Cuentas → tu equipo → Administrar certificados → + → Developer ID Application.
  (Solo el titular de la cuenta de Apple Developer puede crearlo.)`);
  }
  return id;
}

const id = identity();

if (!skipNotary) {
  try { sh('xcrun', ['notarytool', 'history', '--keychain-profile', profile]); } catch {
    fail(`Falta guardar la contraseña para enviar a revisión a Apple. Corre una vez:
  xcrun notarytool store-credentials ${profile} --apple-id TU_CORREO --team-id TU_EQUIPO
  (usa una contraseña de app creada en appleid.apple.com → Inicio de sesión y seguridad).`);
  }
}

step('Compilando ControlDeck.app');
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), 'mac'], { stdio: 'inherit', env: { ...process.env, CONTROLDECK_SIGN_IDENTITY: '-' } });
const app = path.join(DIST, 'ControlDeck.app');

step(`Firmando con ${id}`);
// Node necesita generar código en memoria (JIT) bajo el modo reforzado. Los eventos de Apple
// son los que usa para mandar teclas y leer ventanas mediante System Events.
const ent = path.join(DIST, 'build', 'entitlements.plist');
fs.writeFileSync(ent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.automation.apple-events</key><true/>
</dict>
</plist>
`);
sh('codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', ent, '--identifier', 'com.controldeck.agent', '--sign', id, app]);
sh('codesign', ['--verify', '--deep', '--strict', app]);

step('Armando el .dmg');
const dmg = path.join(DIST, `ControlDeck-${pkg.version}.dmg`);
const stage = path.join(DIST, 'build', 'dmg');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
sh('ditto', [app, path.join(stage, 'ControlDeck.app')]);
fs.symlinkSync('/Applications', path.join(stage, 'Aplicaciones'));
fs.rmSync(dmg, { force: true });
sh('hdiutil', ['create', '-volname', 'ControlDeck', '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-ov', dmg]);
sh('codesign', ['--force', '--timestamp', '--sign', id, dmg]);

if (skipNotary) {
  step('Listo (sin enviar a revisión a Apple)');
  console.log(`  ${path.relative(ROOT, dmg)}`);
  process.exit(0);
}

step('Enviando a revisión a Apple (tarda unos minutos)');
try {
  console.log(sh('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait']).trim().split('\n').slice(-4).join('\n'));
} catch (err) {
  const out = String(err.stdout ?? '') + String(err.stderr ?? '');
  const sub = /id: ([0-9a-f-]{36})/i.exec(out)?.[1];
  if (sub) { try { console.error(sh('xcrun', ['notarytool', 'log', sub, '--keychain-profile', profile])); } catch {} }
  fail(`Apple no aprobó el instalador:\n${out.trim()}`);
}
step('Pegando el visto bueno de Apple');
sh('xcrun', ['stapler', 'staple', dmg]);
sh('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-v', dmg]);

step('Listo');
console.log(`  ${path.relative(ROOT, dmg)}  (${(fs.statSync(dmg).size / 1048576).toFixed(1)} MB)`);
