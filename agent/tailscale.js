// Integración con Tailscale: usar ControlDeck fuera de casa y con HTTPS real.
// `tailscale serve` publica el agente solo dentro de tu tailnet (nunca en internet: no se usa
// Funnel), con el certificado válido de *.ts.net. Así la app de tablet carga por HTTPS.

import fs from 'node:fs';
import { execFile as nodeExecFile } from 'node:child_process';

export const SERVE_PORT = 4443;

const CLI_CANDIDATES = {
  darwin: ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'],
  win32: ['C:\\Program Files\\Tailscale\\tailscale.exe'],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale'],
};

export function createTailscale({ platform = process.platform, execFile = nodeExecFile, exists = fs.existsSync, fetchImpl = globalThis.fetch, lanPort } = {}) {
  const cli = (CLI_CANDIDATES[platform] ?? []).find((p) => exists(p)) ?? null;
  const run = (args, timeout = 6000) => new Promise((resolve) => {
    if (!cli) return resolve({ ok: false, out: '', err: 'Tailscale no está instalado' });
    execFile(cli, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
  });

  let cache = null;

  async function status() {
    if (cache && Date.now() - cache.at < 10_000) return cache.value;
    let value = { installed: Boolean(cli), running: false };
    if (cli) {
      const r = await run(['status', '--json']);
      try {
        const j = JSON.parse(r.out);
        const dnsName = String(j.Self?.DNSName ?? '').replace(/\.$/, '');
        value = {
          installed: true,
          running: j.BackendState === 'Running',
          dnsName,
          ips: (j.Self?.TailscaleIPs ?? []).filter((ip) => ip.includes('.')),
          suffix: String(j.MagicDNSSuffix ?? ''),
          https: (j.CertDomains ?? []).includes(dnsName),
          peers: Object.values(j.Peer ?? {}).filter((p) => p.Online).map((p) => ({
            name: String(p.HostName ?? ''), dnsName: String(p.DNSName ?? '').replace(/\.$/, ''), os: String(p.OS ?? ''),
            ip: (p.TailscaleIPs ?? []).find((ip) => ip.includes('.')) ?? null,
          })),
        };
        value.serving = value.running ? await isServing(value.dnsName) : false;
        value.url = value.serving ? `https://${value.dnsName}:${SERVE_PORT}/` : null;
      } catch {
        value = { installed: true, running: false };
      }
    }
    cache = { at: Date.now(), value };
    return value;
  }

  // ¿Ya está publicado el agente en el puerto de ControlDeck?
  async function isServing(dnsName) {
    const r = await run(['serve', 'status', '--json']);
    try {
      const j = JSON.parse(r.out || '{}');
      const handlers = j.Web?.[`${dnsName}:${SERVE_PORT}`]?.Handlers ?? {};
      return Object.values(handlers).some((h) => new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${lanPort}/?$`).test(h.Proxy ?? ''));
    } catch {
      return false;
    }
  }

  return {
    status,
    get cli() { return cli; },

    // Publica el agente en https://<esta-computadora>.<tailnet>.ts.net:4443, solo dentro de la tailnet.
    async enable() {
      const s = await status();
      if (!s.running) throw new Error('Tailscale no está conectado en esta computadora');
      if (!s.https) throw new Error('Activa los certificados HTTPS de tu tailnet en la consola de Tailscale (DNS → HTTPS Certificates)');
      const r = await run(['serve', '--bg', `--https=${SERVE_PORT}`, `http://127.0.0.1:${lanPort}`], 30_000);
      cache = null;
      if (!r.ok) throw new Error(`Tailscale no pudo publicar ControlDeck: ${r.err.trim().slice(0, 200)}`);
      return status();
    },

    async disable() {
      const r = await run(['serve', `--https=${SERVE_PORT}`, 'off']);
      cache = null;
      if (!r.ok && !/not found|no serve config/i.test(r.err)) throw new Error(`No se pudo quitar: ${r.err.trim().slice(0, 200)}`);
      return status();
    },

    // Otras computadoras de la tailnet con ControlDeck publicado. Se revisa su manifiesto.
    async findAgents() {
      const s = await status();
      if (!s.running || !fetchImpl) return [];
      const candidates = s.peers.filter((p) => /mac|windows/i.test(p.os) && p.dnsName).slice(0, 24);
      const found = await Promise.all(candidates.map(async (p) => {
        try {
          const res = await fetchImpl(`https://${p.dnsName}:${SERVE_PORT}/manifest.webmanifest`, { signal: AbortSignal.timeout(2500) });
          const m = await res.json();
          return m?.name === 'ControlDeck' ? { id: null, name: p.name, os: /windows/i.test(p.os) ? 'win' : 'mac', url: `wss://${p.dnsName}:${SERVE_PORT}/ws`, via: 'tailscale' } : null;
        } catch { return null; }
      }));
      return found.filter(Boolean);
    },
  };
}

// Con `tailscale serve`, las conexiones llegan desde 127.0.0.1 con la IP real en
// X-Forwarded-For. Solo se cree esa cabecera cuando la conexión viene de esta misma computadora.
export function clientIp(req) {
  const remote = req.socket.remoteAddress ?? '?';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return loopback && /^[0-9a-f.:]{3,45}$/i.test(fwd) ? fwd : remote;
}
