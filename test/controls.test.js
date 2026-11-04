// Teclas de varios estados, datos en vivo, volumen exacto, touchpad y voz.

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
import { validateAction, isDangerous, actionTypes } from '../shared/actions.js';
import { startAgent } from '../agent/index.js';
import { createMockDriver } from '../agent/drivers/mock.js';
import { parseBattery } from '../agent/drivers/mac.js';
import { pointerRequest } from '../agent/drivers/windows.js';
import { cpuPercent } from '../agent/activity.js';
import { matchVoice } from '../web/voice.js';

const proto = createProtocol(nacl);

test('teclas de varios estados: validación y peligro según sus pasos', () => {
  const c = validateAction({ type: 'cycle', steps: [{ label: 'Iniciar', action: { type: 'hotkey', keys: 'f5' } }, { action: { type: 'power', cmd: 'lock' } }] });
  assert.equal(c.steps.length, 2);
  assert.deepEqual(actionTypes(c), ['hotkey', 'power']);
  assert.equal(isDangerous(c), true);
  assert.throws(() => validateAction({ type: 'cycle', steps: [{ action: { type: 'hotkey', keys: 'f5' } }] }), /al menos 2/);
  assert.throws(() => validateAction({ type: 'cycle', steps: Array(9).fill({ action: { type: 'media', cmd: 'mute' } }) }), /Máximo/);
  assert.throws(() => validateAction({ type: 'cycle', steps: [{ action: { type: 'touchpad' } }, { action: { type: 'media', cmd: 'mute' } }] }));
});

test('volumen exacto: solo de 0 a 100', () => {
  assert.deepEqual(validateAction({ type: 'media', cmd: 'setvolume', value: 30 }), { type: 'media', cmd: 'setvolume', value: 30 });
  for (const value of [-1, 101, 2.5, 'x']) assert.throws(() => validateAction({ type: 'media', cmd: 'setvolume', value }));
  assert.throws(() => validateAction({ type: 'stat', metric: 'disco' }));
});

test('batería de macOS', () => {
  assert.deepEqual(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t87%; discharging; 4:10 remaining"), { percent: 87, charging: false });
  assert.deepEqual(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged; 0:00"), { percent: 100, charging: true });
  assert.equal(parseBattery("Now drawing from 'AC Power'"), null, 'una Mac de escritorio no tiene batería');
});

test('procesador: porcentaje entre dos lecturas', () => {
  const t = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  assert.equal(cpuPercent([t(100, 900)], [t(150, 950)]), 50);
  assert.equal(cpuPercent([t(0, 0)], [t(0, 0)]), null);
});

test('touchpad en Windows: eventos de mouse acotados', () => {
  assert.deepEqual(pointerRequest({ op: 'move', dx: 5.4, dy: -99999 }), { op: 'mouse', flags: 0x1, dx: 5, dy: -2000, data: 0 });
  assert.deepEqual(pointerRequest({ op: 'click', button: 'right' }), { op: 'mouse', flags: 0x18, dx: 0, dy: 0, data: 0 });
  assert.equal(pointerRequest({ op: 'scroll', dy: 10 }).data, -120);
  assert.throws(() => pointerRequest({ op: 'borrar' }));
});

test('voz: encuentra teclas y páginas por su nombre', () => {
  const deck = { pages: [
    { id: 'g', name: 'General', buttons: [{ id: 'c', label: 'Copiar' }, { id: 'gc', label: 'Guardar como' }, { id: 'g2', label: 'Guardar' }] },
    { id: 'm', name: 'Multimedia', buttons: [{ id: 's', label: 'Silencio' }] },
  ] };
  assert.equal(matchVoice(deck, 'Copiar').button.id, 'c');
  assert.equal(matchVoice(deck, 'guardar como').button.id, 'gc');
  assert.equal(matchVoice(deck, 'guardar').button.id, 'g2');
  assert.equal(matchVoice(deck, 'página multimedia').page.id, 'm');
  assert.equal(matchVoice(deck, 'abre la página Multimedia').page.id, 'm');
  assert.equal(matchVoice(deck, 'algo que no existe'), null);
});

// --- Con el agente real (controlador simulado) ------------------------------------------

let agent, driver, home;
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  driver = createMockDriver({ os: 'mac' });
  agent = await startAgent({ home, driver, port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false });
});
after(async () => { await agent.close(); fs.rmSync(home, { recursive: true, force: true }); });

function admin(method, p, body) {
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

async function connectPaired() {
  await admin('GET', '/api/state');
  const kp = proto.boxKeyPair();
  const events = [];
  const client = await new Promise((resolve, reject) => {
    const c = createAgentClient({ proto, WebSocketImpl: WebSocket, url: `ws://127.0.0.1:${agent.lanPort}/ws`, device: { pub: kp.publicKey, sec: kp.secretKey },
      onEvent: async (e) => {
        events.push(e);
        if (e.status === 'sas') { const st = await admin('GET', '/api/state'); await admin('POST', `/api/pair/${st.pending[0].id}/approve`, {}); }
        if (e.status === 'ready') resolve(c);
        if (e.status === 'error') reject(new Error(e.code));
      } });
    c.connect();
  });
  return { client, events };
}

test('volumen exacto, touchpad y datos en vivo llegan a la computadora', async () => {
  const { client, events } = await connectPaired();

  const r = await client.request({ k: 'action.run', action: { type: 'media', cmd: 'setvolume', value: 40 } });
  assert.equal(r.ok, true);
  assert.deepEqual(driver.calls.at(-1), { name: 'media', arg: { cmd: 'setvolume', value: 40 } });

  // Las acciones de la tablet no se ejecutan como acción normal.
  for (const action of [{ type: 'touchpad' }, { type: 'stat', metric: 'cpu' }, { type: 'volume' }]) {
    const x = await client.request({ k: 'action.run', action });
    assert.match(x.error, /coordina la tablet/);
  }

  // Touchpad: sin respuesta, con valores acotados; las órdenes desconocidas se ignoran.
  client.send({ k: 'pointer', op: 'move', dx: 12, dy: -5000 });
  client.send({ k: 'pointer', op: 'click', button: 'right' });
  client.send({ k: 'pointer', op: 'formatear' });
  await client.request({ k: 'ping' });
  const moves = driver.calls.filter((c) => c.name === 'pointer').map((c) => c.arg);
  assert.deepEqual(moves, [{ op: 'move', dx: 12, dy: -2000, button: 'left' }, { op: 'click', dx: 0, dy: 0, button: 'right' }]);

  // Si se apaga el permiso de mouse en el panel, el touchpad deja de mover.
  await admin('POST', '/api/policy', { policy: { allow: { mouse: false } } });
  client.send({ k: 'pointer', op: 'move', dx: 1, dy: 1 });
  await client.request({ k: 'ping' });
  assert.equal(driver.calls.filter((c) => c.name === 'pointer').length, 2);
  await admin('POST', '/api/policy', { policy: { allow: { mouse: true } } });

  // Datos en vivo: procesador, memoria, volumen y batería en el estado.
  const deadline = Date.now() + 4000;
  let state;
  while (Date.now() < deadline && !(state = events.find((e) => e.type === 'message' && e.payload.k === 'state')?.payload)) await new Promise((r) => setTimeout(r, 100));
  assert.ok(state, 'llegó el estado');
  assert.equal(state.volume, 50);
  assert.deepEqual(state.battery, { percent: 80, charging: true });
  assert.ok(state.ram >= 0 && state.ram <= 100);
  client.close();
});

test('memoria en macOS como el Monitor de Actividad', async () => {
  const { parseVmStat } = await import('../agent/drivers/mac.js');
  const out = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\nPages active: 1000.\nPages inactive: 5000.\nPages wired down: 500.\nPages occupied by compressor: 500.\n';
  assert.equal(parseVmStat(out, 2000 * 16384 * 2), 50);
  assert.equal(parseVmStat('sin datos', 100), null);
});

test('la app de tablet puede usar el micrófono; el panel no', async () => {
  const get = (port, host) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/', headers: host ? { Host: host } : {} }, (r) => { r.resume(); resolve(r.headers['permissions-policy']); }));
  assert.match(await get(agent.lanPort), /microphone=\(self\)/);
  assert.match(await get(agent.adminPort, `127.0.0.1:${agent.adminPort}`), /microphone=\(\)/);
});
