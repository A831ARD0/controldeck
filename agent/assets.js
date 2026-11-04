// Archivos que el agente sirve o usa. En desarrollo se leen del disco; en la app compilada
// (ejecutable único de Node) vienen dentro del propio ejecutable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sea = process.getBuiltinModule?.('node:sea');
export const isCompiled = Boolean(sea?.isSea?.());

export const LAN_ROUTES = {
  '/': 'web/index.html',
  '/app.js': 'web/app.js',
  '/app.css': 'web/app.css',
  '/editor.js': 'web/editor.js',
  '/ui.js': 'web/ui.js',
  '/icons.js': 'web/icons.js',
  '/keyview.js': 'web/keyview.js',
  '/presets.js': 'web/presets.js',
  '/touchpad.js': 'web/touchpad.js',
  '/windows.js': 'web/windows.js',
  '/awake.js': 'web/awake.js',
  '/notifs.js': 'web/notifs.js',
  '/sw.js': 'web/sw.js',
  '/voice.js': 'web/voice.js',
  '/connections.js': 'web/connections.js',
  '/manifest.webmanifest': 'web/manifest.webmanifest',
  '/icon.svg': 'web/icon.svg',
  '/shared/protocol.js': 'shared/protocol.js',
  '/shared/actions.js': 'shared/actions.js',
  '/shared/client.js': 'shared/client.js',
  '/shared/project.js': 'shared/project.js',
  '/vendor/nacl.js': 'node_modules/tweetnacl/nacl-fast.min.js',
};

export const ADMIN_ROUTES = {
  '/': 'admin-web/admin.html',
  '/admin.js': 'admin-web/admin.js',
  '/admin.css': 'admin-web/admin.css',
  '/project.js': 'shared/project.js',
};

export const EXTRA_ASSETS = ['agent/drivers/windows-helper.ps1'];

export const ALL_ASSETS = [...new Set([...Object.values(LAN_ROUTES), ...Object.values(ADMIN_ROUTES), ...EXTRA_ASSETS])];

function rootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function readAsset(rel) {
  if (isCompiled) return Buffer.from(sea.getAsset(rel));
  return fs.readFileSync(path.join(rootDir(), rel));
}

// Ruta real de un archivo que otro programa necesita abrir (por ejemplo, PowerShell). En la app
// compilada se copia a una carpeta privada del usuario, con un nombre que depende del contenido.
export function assetFile(rel) {
  if (!isCompiled) return path.join(rootDir(), rel);
  const body = readAsset(rel);
  const dir = path.join(os.tmpdir(), `controldeck-${process.getuid?.() ?? 'u'}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}-${path.basename(rel)}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, body, { mode: 0o600 });
  return file;
}
