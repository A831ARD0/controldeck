// Utilidades HTTP: archivos estáticos precargados (sin acceso al disco por ruta pedida) y
// cabeceras de seguridad.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

// mapping: { '/ruta/publicada': 'archivo' } y read(archivo) devuelve su contenido. Solo se sirve lo que está en la lista.
export function loadStatic(mapping, read = (file) => fs.readFileSync(file)) {
  const files = new Map();
  for (const [route, file] of Object.entries(mapping)) {
    const body = read(file);
    files.set(route, {
      body,
      type: TYPES[path.extname(file)] ?? 'application/octet-stream',
      etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`,
    });
  }
  return files;
}

// permissions: la app de tablet necesita el micrófono para los comandos de voz; el panel no.
export function securityHeaders(res, { csp, permissions = 'camera=(), microphone=(), geolocation=(), payment=()' }) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', permissions);
}

export function serveStatic(files, req, res) {
  const route = new URL(req.url, 'http://x').pathname;
  const f = files.get(route);
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return void res.end('No encontrado'); }
  res.setHeader('Content-Type', f.type);
  res.setHeader('ETag', f.etag);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304); return void res.end(); }
  res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : f.body);
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Orígenes que pueden abrir un WebSocket: páginas servidas desde la red local. Un sitio de
// internet no puede usar el navegador de la tablet para molestar al agente.
// `tailnets` son sufijos de MagicDNS de Tailscale (p. ej. "tail1234.ts.net") que también se aceptan.
export function isLocalOrigin(origin, tailnets = []) {
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname; } catch { return false; }
  if (host === 'localhost' || host.endsWith('.local') || host === '[::1]') return true;
  if (tailnets.some((t) => t && host.endsWith(`.${t}`))) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}
