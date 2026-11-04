#!/usr/bin/env node
// Descarga el Node.js oficial (nodejs.org) de la misma versión que se usa para compilar y lo
// verifica contra SHASUMS256.txt. Homebrew compila Node sin el "fusible" que necesitan los
// ejecutables únicos, así que la app de macOS se arma sobre este binario oficial.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = path.join(ROOT, '.build-cache');

export function officialNodePath(version = process.version, platform = process.platform, arch = process.arch) {
  const name = `node-${version}-${platform}-${arch}`;
  return path.join(CACHE, name, platform === 'win32' ? 'node.exe' : path.join('bin', 'node'));
}

export async function fetchNode(version = process.version, platform = process.platform, arch = process.arch) {
  const target = officialNodePath(version, platform, arch);
  if (fs.existsSync(target)) return target;
  if (platform === 'win32') throw new Error('En Windows usa el node.exe oficial de nodejs.org');
  const file = `node-${version}-${platform}-${arch}.tar.xz`;
  const base = `https://nodejs.org/dist/${version}/`;
  fs.mkdirSync(CACHE, { recursive: true });

  const sums = await (await fetch(base + 'SHASUMS256.txt')).text();
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) throw new Error(`No encontré la suma de ${file} en SHASUMS256.txt`);

  console.log(`Descargando ${base}${file}…`);
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`Descarga fallida: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash('sha256').update(body).digest('hex');
  if (actual !== expected) throw new Error(`La suma SHA-256 no coincide (esperada ${expected}, obtenida ${actual})`);
  console.log(`Suma SHA-256 verificada: ${actual}`);

  const archive = path.join(CACHE, file);
  fs.writeFileSync(archive, body);
  execFileSync('tar', ['-xJf', archive, '-C', CACHE]);
  fs.rmSync(archive);
  if (!fs.existsSync(target)) throw new Error('El archivo descargado no tiene el binario esperado');
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchNode().then((p) => console.log(`Listo: ${p}`)).catch((err) => { console.error(err.message); process.exit(1); });
}
