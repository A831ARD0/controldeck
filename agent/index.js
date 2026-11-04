// Arma el agente: servidor de red local para las tablets y servidor de administración que solo
// escucha en esta computadora (127.0.0.1).

import { VERSION } from './version.js';
import http from 'node:http';
import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';

import { createProtocol } from '../shared/protocol.js';
import { openStore } from './store.js';
import { createExecutor } from './executor.js';
import { createAutomations } from './automations.js';
import { createAssistant } from './ai.js';
import { createPairingManager } from './pairing.js';
import { createActivityMonitor, createHub } from './activity.js';
import { createNotifier } from './notifications.js';
import { createWindowsWatcher } from './windows-watch.js';
import { createDiscovery } from './discovery.js';
import { handleConnection } from './session.js';
import { lanAddresses } from './net.js';
import { createDiagnostics } from './diagnostics.js';
import { LAN_ROUTES, ADMIN_ROUTES, readAsset } from './assets.js';
import { createTailscale, clientIp } from './tailscale.js';
import { loadStatic, serveStatic, securityHeaders, sendJson, readJsonBody, timingSafeEqualStr, isLocalOrigin } from './http-util.js';


const LAN_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const MAX_CONNECTIONS = 32;
const MAX_PER_IP = 8;

export { lanAddresses };

const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); });
});

export async function startAgent({
  home, driver, port = 4455, adminPort = 4456, bind = '0.0.0.0', discovery: discoveryEnabled = true, discoveryPort,
  pairingAttemptsPerIp = 6, sendWol, onQuit, autostart, tailscale: tailscaleOption, aiFetch, heartbeatMs = 20_000,
} = {}) {
  const proto = createProtocol(nacl);
  const store = openStore({ home, proto });
  const osName = driver.os;
  const hub = createHub({ onSizeChange: (n) => { activity.update(n > 0); notifier.update(n > 0); } });
  const activity = createActivityMonitor({ driver, hub, onApp: (app) => automations.onApp(app) });
  const notifier = createNotifier({ driver, hub, store });
  const windowsWatch = createWindowsWatcher({ executor: { windowsSnapshot: () => executor.windowsSnapshot() } });
  const executor = createExecutor({ driver, store, ...(sendWol ? { sendWol } : {}) });
  const automations = createAutomations({ store, executor, onNeedActivity: (v) => activity.needForAutomations(v) });
  const assistant = createAssistant({ store, ...(aiFetch ? { fetchImpl: aiFetch } : {}) });
  const pairing = createPairingManager({ attemptsPerIp: pairingAttemptsPerIp });
  let lanPort = port;
  const discovery = createDiscovery({
    enabled: discoveryEnabled,
    port: discoveryPort,
    self: () => ({ id: store.identity.id, name: store.identity.name, os: osName, port: lanPort, pub: proto.toB64(store.identity.publicKey) }),
  });
  let adminSeenAt = 0;
  const PAIRING_WINDOW_MS = 90_000;
  const ctx = { proto, store, executor, pairing, hub, activity, discovery, automations, assistant, notifier, windowsWatch, os: osName, pairingOpen: () => Date.now() - adminSeenAt < PAIRING_WINDOW_MS };

  // --- Servidor de red local (tablets) -------------------------------------
  const lanFiles = loadStatic(LAN_ROUTES, readAsset);

  const lanServer = http.createServer((req, res) => {
    securityHeaders(res, { csp: LAN_CSP, permissions: 'camera=(), microphone=(self), geolocation=(), payment=()' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return void res.end(); }
    serveStatic(lanFiles, req, res);
  });
  lanServer.headersTimeout = 10_000;
  lanServer.requestTimeout = 15_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024, perMessageDeflate: false });
  const perIp = new Map();
  lanServer.on('upgrade', (req, socket, head) => {
    const ip = clientIp(req);
    const reject = (code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); };
    if (new URL(req.url, 'http://x').pathname !== '/ws') return reject(404, 'Not Found');
    if (!isLocalOrigin(req.headers.origin, tailnet ? [tailnet] : [])) return reject(403, 'Forbidden');
    if (wss.clients.size >= MAX_CONNECTIONS || (perIp.get(ip) ?? 0) >= MAX_PER_IP) return reject(503, 'Busy');
    wss.handleUpgrade(req, socket, head, (ws) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      // Latido: cada respuesta al ping marca la conexión como viva.
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => { const n = (perIp.get(ip) ?? 1) - 1; if (n <= 0) perIp.delete(ip); else perIp.set(ip, n); });
      ws.on('error', () => {});
      handleConnection(ws, ip, ctx);
    });
  });

  // Detecta conexiones muertas (tablet que se durmió sin cerrar).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);

  lanPort = await listen(lanServer, port, bind);

  // Tailscale: se detecta al arrancar y cada minuto (el nombre de la tailnet se usa para aceptar
  // conexiones de la app de tablet servida por HTTPS desde *.ts.net).
  const tailscale = tailscaleOption === false ? null : (tailscaleOption ?? createTailscale({ lanPort }));
  let tailnet = null;
  const refreshTailnet = () => tailscale?.status().then((s) => { tailnet = s.running ? s.suffix : null; }).catch(() => {});
  refreshTailnet();
  const tailnetTimer = setInterval(refreshTailnet, 60_000);
  tailnetTimer.unref?.();
  ctx.listAgents = async () => {
    const all = [...discovery.list(), ...(tailscale ? await tailscale.findAgents().catch(() => []) : [])];
    const seen = new Set();
    return all.filter((a) => a.url && !seen.has(a.url) && seen.add(a.url));
  };

  // --- Servidor de administración (solo esta computadora) ------------------
  const adminToken = crypto.randomBytes(24).toString('base64url');
  const adminFiles = loadStatic(ADMIN_ROUTES, readAsset);
  let actualAdminPort = adminPort;
  const allowedHosts = () => new Set([`127.0.0.1:${actualAdminPort}`, `localhost:${actualAdminPort}`]);

  const diagnostics = createDiagnostics({ lanPort });
  let diagCache = null;
  async function diagnosticsCached() {
    if (!diagCache || Date.now() - diagCache.at > 5000) diagCache = { at: Date.now(), checks: await diagnostics.run() };
    return diagCache.checks;
  }

  async function tailscaleState() {
    if (!tailscale) return null;
    const t = await tailscale.status().catch(() => ({ installed: false }));
    if (!t.installed) return { installed: false };
    return { installed: true, running: t.running, dnsName: t.dnsName, https: t.https, serving: t.serving, url: t.url, qr: t.url ? await qrFor(t.url) : null };
  }

  const qrCache = new Map();
  async function qrFor(url) {
    if (!qrCache.has(url)) {
      if (qrCache.size > 8) qrCache.clear();
      qrCache.set(url, `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(url, { type: 'svg', margin: 1 })).toString('base64')}`);
    }
    return qrCache.get(url);
  }

  async function adminState() {
    const urls = lanAddresses().map((ip) => `http://${ip}:${lanPort}/`);
    const qr = urls[0] ? await qrFor(urls[0]) : null;
    return {
      agent: { id: store.identity.id, name: store.identity.name, os: osName, fingerprint: proto.fingerprint(store.identity.publicKey), version: VERSION },
      urls, qr,
      pending: pairing.list(),
      devices: store.listDevices().map((d) => ({ ...d, connections: hub.perDevice()[d.id] ?? 0 })),
      connected: Object.keys(hub.perDevice()).length,
      connections: hub.size,
      policy: store.getPolicy(),
      log: executor.getLog().slice(0, 50),
      scriptsDir: store.scriptsDir,
      autostart: autostart ? autostart.status() : null,
      ai: store.getAi(),
      automations: store.getAutomations().length,
      canQuit: Boolean(onQuit),
      // Una computadora que ya tenía tablets antes de existir la configuración guiada no la ve.
      setupDone: store.setupDone || store.listDevices().length > 0,
      peers: discovery.list(),
      tailscale: await tailscaleState(),
    };
  }

  const adminServer = http.createServer(async (req, res) => {
    securityHeaders(res, { csp: ADMIN_CSP });
    // Protección contra DNS rebinding: solo se acepta el nombre exacto de esta computadora.
    if (!allowedHosts().has(req.headers.host ?? '')) { res.writeHead(403); return void res.end(); }
    const origin = req.headers.origin;
    if (origin && !allowedHosts().has(origin.replace(/^http:\/\//, ''))) { res.writeHead(403); return void res.end(); }
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return void res.end(); }
      return serveStatic(adminFiles, req, res);
    }
    // La API exige el token en una cabecera propia: un sitio web no puede enviarla sin permiso CORS.
    if (!timingSafeEqualStr(req.headers['x-admin-token'] ?? '', adminToken)) return sendJson(res, 401, { error: 'Token inválido' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') { adminSeenAt = Date.now(); return sendJson(res, 200, await adminState()); }
      if (req.method === 'GET' && url.pathname === '/api/diagnostics') return sendJson(res, 200, { checks: await diagnosticsCached() });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'Se espera JSON' });
      const body = await readJsonBody(req);
      let m;
      if ((m = /^\/api\/pair\/([0-9a-f]{12})\/(approve|reject)$/.exec(url.pathname))) {
        return sendJson(res, pairing.decide(m[1], m[2] === 'approve') ? 200 : 404, { ok: true });
      }
      if ((m = /^\/api\/device\/([0-9a-f]{12})\/revoke$/.exec(url.pathname))) {
        const ok = store.revokeDevice(m[1]);
        hub.kickDevice(m[1]);
        return sendJson(res, ok ? 200 : 404, { ok });
      }
      if (url.pathname === '/api/policy') return sendJson(res, 200, { ok: true, policy: store.savePolicy(body.policy) });
      if (url.pathname === '/api/setup') { store.setSetupDone(body.done === true); return sendJson(res, 200, { ok: true }); }
      if (url.pathname === '/api/rename') { store.rename(body.name); return sendJson(res, 200, { ok: true }); }
      if (url.pathname === '/api/tailscale' && tailscale) { if (body.on === true) await tailscale.enable(); else await tailscale.disable(); return sendJson(res, 200, { ok: true, tailscale: await tailscaleState() }); }
      if (url.pathname === '/api/ai') { const saved = store.saveAi(body); return sendJson(res, 200, { ok: true, ai: saved }); }
      if (url.pathname === '/api/ai/models') return sendJson(res, 200, { ok: true, models: await assistant.models(String(body.url ?? '')) });
      if (url.pathname === '/api/fix') return sendJson(res, 200, { ok: await diagnostics.fix(String(body.id ?? '')) });
      if (url.pathname === '/api/autostart' && autostart) { await autostart.set(body.on === true); return sendJson(res, 200, { ok: true, on: autostart.status() }); }
      if (url.pathname === '/api/quit' && onQuit) { sendJson(res, 200, { ok: true }); setTimeout(onQuit, 100); return undefined; }
      return sendJson(res, 404, { error: 'No encontrado' });
    } catch (err) {
      return sendJson(res, err.status ?? 400, { error: String(err.message ?? err).slice(0, 300) });
    }
  });
  adminServer.headersTimeout = 10_000;
  adminServer.requestTimeout = 15_000;
  actualAdminPort = await listen(adminServer, adminPort, '127.0.0.1');

  return {
    lanPort,
    adminPort: actualAdminPort,
    adminToken,
    adminUrl: `http://127.0.0.1:${actualAdminPort}/#t=${adminToken}`,
    tabletUrls: lanAddresses().map((ip) => `http://${ip}:${lanPort}/`),
    identity: { id: store.identity.id, name: store.identity.name, fingerprint: proto.fingerprint(store.identity.publicKey) },
    diagnostics,
    store,
    notifier,
    async close() {
      clearInterval(heartbeat);
      clearInterval(tailnetTimer);
      automations.close();
      activity.close();
      notifier.close();
      windowsWatch.close();
      pairing.close();
      discovery.close();
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([new Promise((r) => lanServer.close(r)), new Promise((r) => adminServer.close(r))]);
      driver.close();
    },
  };
}
