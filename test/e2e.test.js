// Prueba de punta a punta: agente real (con controlador simulado) + cliente real de la tablet.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import nacl from 'tweetnacl';
import WebSocket from 'ws';
import { createProtocol } from '../shared/protocol.js';
import { createAgentClient } from '../shared/client.js';
import { startAgent } from '../agent/index.js';
import { createMockDriver } from '../agent/drivers/mock.js';

const proto = createProtocol(nacl);
let agent, driver, home;

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  driver = createMockDriver({ os: 'mac' });
  agent = await startAgent({ home, driver, port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false, pairingAttemptsPerIp: 50 });
});
after(async () => { await agent.close(); fs.rmSync(home, { recursive: true, force: true }); });

const wsUrl = () => `ws://127.0.0.1:${agent.lanPort}/ws`;

function admin(method, p, body, { token = agent.adminToken, host = `127.0.0.1:${agent.adminPort}`, origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({ host: '127.0.0.1', port: agent.adminPort, method, path: p, headers: {
      Host: host, ...(token ? { 'X-Admin-Token': token } : {}), ...(origin ? { Origin: origin } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf ? (() => { try { return JSON.parse(buf); } catch { return buf; } })() : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function connect({ device, pinned = null, name = 'Tablet de prueba' }) {
  const events = [];
  let waiters = [];
  const client = createAgentClient({
    proto, WebSocketImpl: WebSocket, url: wsUrl(), device, pinnedAgentPub: pinned, deviceName: name,
    onEvent: (e) => { events.push(e); waiters = waiters.filter((w) => !w(e)); },
  });
  const waitFor = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const found = events.find(pred);
    if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error(`timeout; eventos: ${JSON.stringify(events.map((e) => e.status ?? e.type))}`)), ms);
    waiters.push((e) => { if (pred(e)) { clearTimeout(t); resolve(e); return true; } return false; });
  });
  client.connect();
  return { client, events, waitFor };
}

const newDevice = () => { const kp = proto.boxKeyPair(); return { pub: kp.publicKey, sec: kp.secretKey }; };

async function pairNew(name = 'Tablet de prueba') {
  await admin('GET', '/api/state'); // el panel está abierto
  const device = newDevice();
  const c = connect({ device, name });
  const sasEvt = await c.waitFor((e) => e.status === 'sas');
  const st = await admin('GET', '/api/state');
  const req = st.body.pending.find((p) => p.sas === sasEvt.sas);
  assert.ok(req, 'la solicitud aparece en el panel con el mismo código');
  assert.equal((await admin('POST', `/api/pair/${req.id}/approve`, {})).status, 200);
  const paired = await c.waitFor((e) => e.type === 'paired');
  await c.waitFor((e) => e.status === 'ready');
  return { device, c, agentPub: proto.fromB64(paired.agentPub, 32) };
}

test('emparejar con aprobación, ejecutar acciones y respetar la política', async () => {
  const { device, c, agentPub } = await pairNew();
  assert.ok(proto.equal(agentPub, agent.store.identity.publicKey));

  const deck = await c.client.request({ k: 'deck.get' });
  assert.ok(deck.ok && deck.deck.pages.length === 3);

  const r = await c.client.request({ k: 'action.run', action: { type: 'hotkey', keys: 'mod+shift+s' } });
  assert.deepEqual(r.ok, true);
  assert.deepEqual(driver.calls.at(-1), { name: 'hotkey', arg: { mods: ['cmd', 'shift'], key: 's' } });

  const t = await c.client.request({ k: 'action.run', action: { type: 'text', text: 'Pegado: {portapapeles}' } });
  assert.ok(t.ok);
  assert.equal(driver.calls.at(-1).arg, 'Pegado: texto del portapapeles');

  // Energía necesita confirmación; los scripts están desactivados por defecto.
  const p1 = await c.client.request({ k: 'action.run', action: { type: 'power', cmd: 'lock' } });
  assert.equal(p1.ok, false);
  assert.equal(p1.needsConfirm, true);
  const p2 = await c.client.request({ k: 'action.run', action: { type: 'power', cmd: 'lock' }, confirmed: true });
  assert.equal(p2.ok, true);
  const s = await c.client.request({ k: 'action.run', action: { type: 'script', name: 'x' }, confirmed: true });
  assert.match(s.error, /no permite/);

  const bad = await c.client.request({ k: 'action.run', action: { type: 'open', target: 'file:///etc/passwd' } });
  assert.equal(bad.ok, false);

  c.client.close();

  // Reconexión con la llave fijada: no pide aprobación otra vez.
  const again = connect({ device, pinned: agentPub });
  await again.waitFor((e) => e.status === 'ready');
  assert.ok(!again.events.some((e) => e.status === 'sas'));
  again.client.close();
});

test('scripts: solo de la carpeta, solo si se permiten', async () => {
  const { c } = await pairNew('Tablet scripts');
  await admin('POST', '/api/policy', { policy: { allow: { script: true } } });
  fs.writeFileSync(path.join(agent.store.scriptsDir, 'hola.sh'), 'echo hola\n');
  fs.symlinkSync('/etc/hosts', path.join(agent.store.scriptsDir, 'fuga.sh'));
  const ok = await c.client.request({ k: 'action.run', action: { type: 'script', name: 'hola' }, confirmed: true });
  assert.equal(ok.ok, true);
  assert.equal(driver.calls.at(-1).name, 'runScript');
  assert.ok(driver.calls.at(-1).arg.endsWith(`${path.sep}hola.sh`));
  const leak = await c.client.request({ k: 'action.run', action: { type: 'script', name: 'fuga' }, confirmed: true });
  assert.match(leak.error, /fuera de la carpeta/);
  await admin('POST', '/api/policy', { policy: { allow: { script: false } } });
  c.client.close();
});

test('guardar el deck lo valida y avisa a las demás tablets', async () => {
  const a = await pairNew('Tablet A');
  const b = await pairNew('Tablet B');
  const deck = (await a.c.client.request({ k: 'deck.get' })).deck;
  deck.pages[0].name = 'Trabajo';
  const r = await a.c.client.request({ k: 'deck.save', deck });
  assert.ok(r.ok);
  const pushed = await b.c.waitFor((e) => e.type === 'message' && e.payload.k === 'deck');
  assert.equal(pushed.payload.deck.pages[0].name, 'Trabajo');
  deck.pages[0].buttons[0].color = 'javascript:alert(1)';
  const bad = await a.c.client.request({ k: 'deck.save', deck });
  assert.equal(bad.ok, false);
  a.c.client.close(); b.c.client.close();
});

test('rechazar el emparejamiento cierra la conexión sin guardar el dispositivo', async () => {
  const before = (await admin('GET', '/api/state')).body.devices.length;
  const c = connect({ device: newDevice(), name: 'Intruso' });
  await c.waitFor((e) => e.status === 'sas');
  const req = (await admin('GET', '/api/state')).body.pending.find((p) => p.deviceName === 'Intruso');
  await admin('POST', `/api/pair/${req.id}/reject`, {});
  const err = await c.waitFor((e) => e.status === 'error');
  assert.equal(err.code, 'pair-rejected');
  assert.equal((await admin('GET', '/api/state')).body.devices.length, before);
});

test('una tablet desconocida que intenta autenticarse sin emparejar es rechazada', async () => {
  const c = connect({ device: newDevice(), pinned: agent.store.identity.publicKey });
  const err = await c.waitFor((e) => e.status === 'error');
  assert.equal(err.code, 'not-paired');
});

test('si la computadora presenta otra identidad, la tablet no se conecta', async () => {
  const c = connect({ device: newDevice(), pinned: proto.boxKeyPair().publicKey });
  const err = await c.waitFor((e) => e.status === 'error');
  assert.equal(err.code, 'identity-changed');
});

test('quitar el acceso desconecta a la tablet y ya no puede volver', async () => {
  const { device, c, agentPub } = await pairNew('Tablet revocada');
  const st = (await admin('GET', '/api/state')).body;
  const d = st.devices.find((x) => x.name === 'Tablet revocada');
  await admin('POST', `/api/device/${d.id}/revoke`, {});
  await c.waitFor((e) => e.status === 'closed');
  const again = connect({ device, pinned: agentPub });
  const err = await again.waitFor((e) => e.status === 'error');
  assert.equal(err.code, 'not-paired');
});

test('mensajes alterados o repetidos cierran la conexión', async () => {
  const { device, agentPub } = await pairNew('Tablet atacada');
  // Cliente manual para poder repetir un mensaje cifrado.
  const ws = new WebSocket(wsUrl());
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  await new Promise((r) => ws.once('message', r));
  const hello = msgs[0];
  const eph = proto.boxKeyPair(); const nC = proto.randomBytes(32);
  const keys = proto.deriveSessionKeys({ staticShared: proto.sharedKey(agentPub, device.sec), ephShared: proto.sharedKey(proto.fromB64(hello.ePub), eph.secretKey), nS: proto.fromB64(hello.nS), nC });
  const ch = proto.createChannel({ sendKey: keys.c2s, recvKey: keys.s2c });
  ws.send(JSON.stringify({ t: 'auth', devicePub: proto.toB64(device.pub), ePub: proto.toB64(eph.publicKey), nC: proto.toB64(nC), proof: ch.wrap({ k: 'auth', nS: hello.nS }) }));
  await new Promise((r) => setTimeout(r, 100));
  const frame = ch.wrap({ k: 'ping', reqId: 1 });
  ws.send(JSON.stringify(frame));
  ws.send(JSON.stringify(frame)); // repetido
  assert.equal(await closed, 4001);
});

test('límite de intentos de emparejamiento por IP', async () => {
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  const a2 = await startAgent({ home: home2, driver: createMockDriver(), port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false, pairingAttemptsPerIp: 2 });
  try {
    const codes = [];
    await new Promise((resolve) => http.get({ host: '127.0.0.1', port: a2.adminPort, path: '/api/state', headers: { Host: `127.0.0.1:${a2.adminPort}`, 'X-Admin-Token': a2.adminToken } }, (r) => { r.resume(); r.on('end', resolve); }));
    for (let i = 0; i < 3; i++) {
      const done = new Promise((resolve) => {
        const client = createAgentClient({ proto, WebSocketImpl: WebSocket, url: `ws://127.0.0.1:${a2.lanPort}/ws`, device: newDevice(),
          onEvent: (e) => { if (e.status === 'sas') { resolve('sas'); client.close(); } if (e.status === 'error') resolve(e.code); } });
        client.connect();
      });
      codes.push(await done);
    }
    assert.deepEqual(codes, ['sas', 'sas', 'rate-limited']);
  } finally {
    await a2.close();
    fs.rmSync(home2, { recursive: true, force: true });
  }
});

test('un sitio de internet no puede abrir el WebSocket', async () => {
  const ws = new WebSocket(wsUrl(), { headers: { Origin: 'https://evil.example.com' } });
  const res = await new Promise((resolve) => { ws.on('unexpected-response', (_, r) => resolve(r.statusCode)); ws.on('open', () => resolve('open')); ws.on('error', () => {}); });
  assert.equal(res, 403);
});

test('panel: token, Host y Origin obligatorios', async () => {
  assert.equal((await admin('GET', '/api/state', null, { token: null })).status, 401);
  assert.equal((await admin('GET', '/api/state', null, { token: 'x' })).status, 401);
  assert.equal((await admin('GET', '/api/state', null, { host: 'evil.com' })).status, 403, 'DNS rebinding');
  assert.equal((await admin('GET', '/api/state', null, { origin: 'https://evil.com' })).status, 403);
  assert.equal((await admin('GET', '/api/state')).status, 200);
  const page = await admin('GET', '/', null, { token: null });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
});

test('servidor de la tablet: solo archivos de la lista y solo GET', async () => {
  const get = (p, method = 'GET') => new Promise((resolve) => {
    http.request({ host: '127.0.0.1', port: agent.lanPort, path: p, method }, (res) => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(await get('/'), 200);
  assert.equal(await get('/vendor/nacl.js'), 200);
  assert.equal(await get('/shared/client.js'), 200);
  assert.equal(await get('/../package.json'), 404);
  assert.equal(await get('/%2e%2e/agent/store.js'), 404);
  assert.equal(await get('/agent/store.js'), 404);
  assert.equal(await get('/', 'POST'), 405);
});

test('los archivos de datos quedan con permisos 0600', { skip: process.platform === 'win32' }, () => {
  for (const f of ['identity.json', 'devices.json']) {
    const mode = fs.statSync(path.join(home, f)).mode & 0o777;
    assert.equal(mode, 0o600, f);
  }
  assert.equal(fs.statSync(home).mode & 0o777, 0o700);
});

test('sin el panel abierto no se acepta emparejar', async () => {
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  const a2 = await startAgent({ home: home2, driver: createMockDriver(), port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false });
  try {
    const code = await new Promise((resolve) => {
      const c = createAgentClient({ proto, WebSocketImpl: WebSocket, url: `ws://127.0.0.1:${a2.lanPort}/ws`, device: newDevice(), onEvent: (e) => { if (e.status === 'error') resolve(e.code); if (e.status === 'sas') resolve('sas'); } });
      c.connect();
    });
    assert.equal(code, 'pair-closed');
  } finally {
    await a2.close();
    fs.rmSync(home2, { recursive: true, force: true });
  }
});

test('antes de autenticar no se aceptan mensajes grandes', async () => {
  const ws = new WebSocket(wsUrl());
  await new Promise((r) => ws.once('message', r));
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  ws.send(JSON.stringify({ t: 'pair-commit', cD: 'x'.repeat(20_000) }));
  assert.equal(await closed, 1009);
});

test('la tablet no se da por conectada hasta que la computadora prueba su identidad', async () => {
  const { device, agentPub } = await pairNew('Tablet espera');
  const c = connect({ device, pinned: agentPub });
  await c.waitFor((e) => e.status === 'authenticating');
  assert.equal(c.client.ready, false);
  await assert.rejects(c.client.request({ k: 'ping' }), /No conectado/);
  await c.waitFor((e) => e.status === 'ready');
  assert.equal(c.client.ready, true);
  c.client.close();
});

test('las conexiones sanas no se cortan por el latido', async () => {
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  const a2 = await startAgent({ home: home2, driver: createMockDriver(), port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false, heartbeatMs: 100 });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${a2.lanPort}/ws`);
    let closedAt = null;
    ws.on('close', () => { closedAt = Date.now(); });
    await new Promise((r) => ws.once('message', r));
    await new Promise((r) => setTimeout(r, 450)); // más de 4 latidos
    assert.equal(closedAt, null, 'la conexión sigue abierta');
    ws.close();
  } finally {
    await a2.close();
    fs.rmSync(home2, { recursive: true, force: true });
  }
});
