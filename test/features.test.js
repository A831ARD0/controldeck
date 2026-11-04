// Portapapeles entre computadoras, encender a distancia, páginas por app y arranque automático.

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
import { validateDeck, pageForApp, validateAction } from '../shared/actions.js';
import { startAgent } from '../agent/index.js';
import { createMockDriver } from '../agent/drivers/mock.js';
import { buildMagicPacket, broadcastAddresses, sendWol } from '../agent/wol.js';
import { buildMacPlist, buildWindowsLauncher, installAutostart, uninstallAutostart, stableNodePath } from '../agent/autostart.js';

const proto = createProtocol(nacl);

// --- Dos agentes simulados (una "Mac" y una "PC") ---------------------------------

const agents = [];
const wolCalls = [];
before(async () => {
  for (const os_ of ['mac', 'win']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
    const driver = createMockDriver({ os: os_ });
    const agent = await startAgent({ home, driver, port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false, pairingAttemptsPerIp: 50, sendWol: async (macs) => { wolCalls.push(macs); } });
    agents.push({ home, driver, agent });
  }
});
after(async () => {
  for (const a of agents) { await a.agent.close(); fs.rmSync(a.home, { recursive: true, force: true }); }
});

function admin(agent, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({ host: '127.0.0.1', port: agent.adminPort, method, path: p, headers: {
      Host: `127.0.0.1:${agent.adminPort}`, 'X-Admin-Token': agent.adminToken,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(JSON.parse(b || '{}'))); });
    req.on('error', reject);
    req.end(data);
  });
}

async function pairedClient(agent, device) {
  await admin(agent, 'GET', '/api/state'); // el panel está abierto
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const client = createAgentClient({
    proto, WebSocketImpl: WebSocket, url: `ws://127.0.0.1:${agent.lanPort}/ws`, device, deviceName: 'Tablet',
    onEvent: async (e) => {
      if (e.status === 'sas') {
        const st = await admin(agent, 'GET', '/api/state');
        await admin(agent, 'POST', `/api/pair/${st.pending.find((p) => p.sas === e.sas).id}/approve`, {});
      }
      if (e.status === 'ready') resolveReady(e.info);
      if (e.status === 'error') rejectReady(new Error(e.code));
    },
  });
  client.connect();
  return { client, info: await ready };
}

test('pasar lo copiado de la Mac a la PC y pegarlo', async () => {
  const kp = proto.boxKeyPair();
  const device = { pub: kp.publicKey, sec: kp.secretKey };
  const [mac, pc] = agents;
  const a = await pairedClient(mac.agent, device);
  const b = await pairedClient(pc.agent, device);

  // Así lo coordina la tablet: leer en el origen, escribir (y pegar) en el destino.
  const got = await a.client.request({ k: 'clipboard.get' });
  assert.deepEqual(got.ok, true);
  assert.equal(got.text, 'texto del portapapeles');
  const set = await b.client.request({ k: 'clipboard.set', text: `${got.text} ✓`, paste: true });
  assert.equal(set.ok, true);
  assert.deepEqual(pc.driver.calls.slice(-2), [
    { name: 'writeClipboard', arg: 'texto del portapapeles ✓' },
    { name: 'hotkey', arg: { mods: ['ctrl'], key: 'v' } },
  ]);

  // La política de la computadora manda: si se desactiva, no entrega lo copiado.
  await admin(mac.agent, 'POST', '/api/policy', { policy: { allow: { clipboard: false } } });
  const denied = await a.client.request({ k: 'clipboard.get' });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /no permite/);
  await admin(mac.agent, 'POST', '/api/policy', { policy: { allow: { clipboard: true } } });

  const tooBig = await b.client.request({ k: 'clipboard.set', text: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(tooBig.ok, false);

  // Las acciones que coordina la tablet no se aceptan como acción normal de un agente.
  const direct = await a.client.request({ k: 'action.run', action: { type: 'clipboard' } });
  assert.match(direct.error, /coordina la tablet/);

  // Encender: el agente manda el paquete solo a direcciones MAC válidas.
  const w = await a.client.request({ k: 'wake', macs: ['aa:bb:cc:dd:ee:ff', 'no-es-mac'] });
  assert.equal(w.ok, true);
  assert.deepEqual(wolCalls.at(-1), ['aa:bb:cc:dd:ee:ff']);
  const bad = await a.client.request({ k: 'wake', macs: ['ff:ff:ff:ff:ff:ff'] });
  assert.equal(bad.ok, false);

  // Al conectar, la computadora comparte sus MAC solo con tablets ya autenticadas.
  assert.ok(Array.isArray(a.info.macs));

  a.client.close(); b.client.close();
});

test('paquete mágico: 6 bytes FF y 16 repeticiones de la MAC', () => {
  const p = buildMagicPacket('01:23:45:67:89:ab');
  assert.equal(p.length, 102);
  assert.ok(p.subarray(0, 6).every((x) => x === 0xff));
  assert.deepEqual([...p.subarray(96)], [0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
  assert.throws(() => buildMagicPacket('01:23:45'));
});

test('difusión: calcula la dirección de cada red local', () => {
  const addrs = broadcastAddresses({ en0: [{ family: 'IPv4', internal: false, address: '192.168.1.37', netmask: '255.255.255.0' }], lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }] });
  assert.deepEqual(addrs, ['255.255.255.255', '192.168.1.255']);
});

test('encender: envía por UDP a cada dirección y puerto', async () => {
  const sent = [];
  const fake = { once() {}, off() {}, bind(_p, cb) { cb(); }, setBroadcast(v) { assert.equal(v, true); }, send(buf, port, addr, cb) { sent.push({ len: buf.length, port, addr }); cb(); }, close() {} };
  const n = await sendWol(['aa:bb:cc:dd:ee:ff'], { createSocket: () => fake, addresses: ['255.255.255.255', '10.0.0.255'] });
  assert.equal(n, 1);
  assert.equal(sent.length, 4);
  await assert.rejects(sendWol(['nada'], { createSocket: () => fake }));
});

test('páginas que se abren solas con una app', () => {
  const deck = validateDeck({ pages: [
    { id: 'g', name: 'General', buttons: [] },
    { id: 'x', name: 'Hojas', apps: ['Excel', 'Numbers'], buttons: [] },
    { id: 'z', name: 'Reuniones', apps: ['zoom.us', 'Teams'], buttons: [] },
  ] });
  assert.equal(pageForApp(deck, 'Microsoft Excel')?.id, 'x');
  assert.equal(pageForApp(deck, 'EXCEL')?.id, 'x');
  assert.equal(pageForApp(deck, 'Microsoft Teams (work or school)')?.id, 'z');
  assert.equal(pageForApp(deck, 'Safari'), null);
  assert.equal(pageForApp(deck, ''), null);
  assert.throws(() => validateDeck({ pages: [{ id: 'a', name: 'A', apps: Array(11).fill('x'), buttons: [] }] }));
  assert.equal(validateDeck({ pages: [{ id: 'a', name: 'A', apps: [], buttons: [] }] }).pages[0].apps, undefined);
});

test('acciones de portapapeles y encendido validadas', () => {
  assert.deepEqual(validateAction({ type: 'clipboard', from: 'focus', to: 'others', paste: true }), { type: 'clipboard', from: 'focus', to: 'others', paste: true });
  assert.throws(() => validateAction({ type: 'clipboard', from: 'abc', to: 'abc' }), /misma/);
  assert.throws(() => validateAction({ type: 'clipboard', to: '../x' }));
  assert.throws(() => validateAction({ type: 'wake' }));
  assert.throws(() => validateAction({ type: 'multi', steps: [{ type: 'wake', agent: 'a1' }] }));
});

// --- Arranque automático ----------------------------------------------------------------

test('LaunchAgent de macOS: argumentos separados y XML escapado', () => {
  const plist = buildMacPlist({ node: '/opt/homebrew/bin/node', script: '/Users/a/<raro> & "x"/bin/controldeck.js', home: '/Users/a/Library/Application Support/ControlDeck', logFile: '/tmp/agente.log' });
  assert.match(plist, /<string>\/Users\/a\/&lt;raro&gt; &amp; &quot;x&quot;\/bin\/controldeck.js<\/string>/);
  assert.match(plist, /<string>--no-open<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
});

test('lanzador de Windows: sin ventana y con rutas entre comillas', () => {
  const vbs = buildWindowsLauncher({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\Users\\Ana Pérez\\controlador\\bin\\controldeck.js', home: 'C:\\Users\\Ana Pérez\\AppData\\Roaming\\ControlDeck' });
  assert.match(vbs, /Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\Users\\Ana Pérez\\controlador\\bin\\controldeck\.js"" --no-open --home ""C:\\Users\\Ana Pérez\\AppData\\Roaming\\ControlDeck""", 0, False/);
});

test('instalar y desinstalar el arranque automático (sin tocar el sistema real)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  const calls = [];
  const execFile = (cmd, args, opts, cb) => { calls.push([cmd, ...args]); cb(null, '', ''); };
  const paths = { file: path.join(dir, 'LaunchAgents', 'com.controldeck.agent.plist') };
  await installAutostart({ script: '/x/bin/controldeck.js', home: dir, node: '/usr/local/bin/node', platform: 'darwin', execFile, uid: 501, paths });
  assert.ok(fs.existsSync(paths.file));
  assert.deepEqual(calls.at(-1), ['launchctl', 'bootstrap', 'gui/501', paths.file]);
  assert.equal(await uninstallAutostart({ platform: 'darwin', execFile, uid: 501, paths }), true);
  assert.ok(!fs.existsSync(paths.file));
  assert.deepEqual(calls.at(-1), ['launchctl', 'bootout', 'gui/501', paths.file]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ruta estable de Node cuando viene de Homebrew', () => {
  const real = (p) => (p === '/opt/homebrew/bin/node' ? '/opt/homebrew/Cellar/node/25.9.0/bin/node' : p);
  assert.equal(stableNodePath('/opt/homebrew/Cellar/node/25.9.0/bin/node', { exists: () => true, realpath: real }), '/opt/homebrew/bin/node');
  assert.equal(stableNodePath('/usr/bin/node'), '/usr/bin/node');
});
