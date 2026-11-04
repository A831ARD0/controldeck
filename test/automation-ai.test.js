// Automatizaciones, asistente de IA y música en reproducción.

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
import { validateAutomations } from '../shared/actions.js';
import { createAutomations } from '../agent/automations.js';
import { createAssistant } from '../agent/ai.js';
import { startAgent } from '../agent/index.js';
import { createMockDriver } from '../agent/drivers/mock.js';
import { DEFAULT_POLICY } from '../agent/store.js';

const proto = createProtocol(nacl);

// --- Automatizaciones -----------------------------------------------------------------------

function fakeStore(list, allow = {}) {
  let automations = validateAutomations(list);
  return {
    getAutomations: () => structuredClone(automations),
    getPolicy: () => ({ allow: { ...DEFAULT_POLICY.allow, ...allow } }),
    set(next) { automations = validateAutomations(next); },
  };
}

test('automatizaciones: validación segura', () => {
  assert.throws(() => validateAutomations([{ id: 'a', when: { type: 'app', app: 'x' }, action: { type: 'script', name: 'borrar' } }]), /seguridad/);
  assert.throws(() => validateAutomations([{ id: 'a', when: { type: 'time', at: '25:00', days: [1] }, action: { type: 'media', cmd: 'mute' } }]), /Hora/);
  assert.throws(() => validateAutomations([{ id: 'a', when: { type: 'time', at: '08:00', days: [] }, action: { type: 'media', cmd: 'mute' } }]), /día/);
  assert.throws(() => validateAutomations([{ id: 'a', when: { type: 'app', app: 'x' }, action: { type: 'touchpad' } }]), /tablet/);
  assert.throws(() => validateAutomations(Array.from({ length: 31 }, (_, i) => ({ id: `a${i}`, when: { type: 'app', app: 'x' }, action: { type: 'media', cmd: 'mute' } }))));
});

test('automatizaciones por app: una vez por cambio y con pausa entre repeticiones', async () => {
  const runs = [];
  const store = fakeStore([
    { id: 'z', name: 'Zoom', when: { type: 'app', app: 'zoom' }, action: { type: 'hotkey', keys: 'alt+a' } },
    { id: 'off', name: 'Apagada', enabled: false, when: { type: 'app', app: 'zoom' }, action: { type: 'media', cmd: 'mute' } },
  ]);
  let needs = null;
  const auto = createAutomations({ store, executor: { run: async (x) => { runs.push(x); return { ok: true }; } }, onNeedActivity: (v) => { needs = v; } });
  assert.equal(needs, true, 'pide que se vigile la app al frente');
  auto.onApp('zoom.us');
  auto.onApp('zoom.us');
  auto.onApp('Safari');
  auto.onApp('zoom.us'); // dentro de la pausa de 5 s
  await new Promise((r) => setImmediate(r));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].device.name, 'Automatización: Zoom');
  assert.deepEqual(runs[0].action, { type: 'hotkey', keys: 'alt+a' });
  assert.equal(runs[0].confirmed, false);
  auto.close();
});

test('automatizaciones por hora: el día y la hora correctos, una sola vez', async () => {
  const runs = [];
  let now = new Date(2026, 10, 2, 9, 0, 10); // lunes 2 de noviembre de 2026, 09:00
  const store = fakeStore([{ id: 't', name: 'Correo', when: { type: 'time', at: '09:00', days: [1, 2, 3, 4, 5] }, action: { type: 'open', target: 'https://mail.google.com' } }]);
  const auto = createAutomations({ store, executor: { run: async (x) => { runs.push(x); } }, now: () => now });
  auto.checkTime();
  auto.checkTime();
  assert.equal(runs.length, 1, 'no se repite en el mismo minuto');
  now = new Date(2026, 10, 7, 9, 0, 5); // sábado
  auto.checkTime();
  assert.equal(runs.length, 1);
  now = new Date(2026, 10, 3, 9, 0, 0); // martes
  auto.checkTime();
  assert.equal(runs.length, 2);
  auto.close();
});

test('si el panel apaga las automatizaciones, no corren', async () => {
  const runs = [];
  const store = fakeStore([{ id: 'z', when: { type: 'app', app: 'zoom' }, action: { type: 'media', cmd: 'mute' } }], { automations: false });
  const auto = createAutomations({ store, executor: { run: async (x) => runs.push(x) } });
  auto.onApp('zoom.us');
  assert.equal(runs.length, 0);
  auto.close();
});

// --- Asistente de IA ----------------------------------------------------------------------

function aiStore(url = 'http://ia.local:11434', model = 'gpt-oss:20b') {
  return { getAi: () => ({ url, model }) };
}
const reply = (content) => ({ ok: true, json: async () => ({ message: { content } }) });

test('IA: convierte la respuesta en una tecla validada', async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return reply('{"label":"Micrófono Teams","icon":"🎙️","action":{"type":"hotkey","keys":"mod+shift+m"}}'); };
  const ai = createAssistant({ store: aiStore(), fetchImpl });
  const b = await ai.suggest({ prompt: 'silenciar el micrófono en Teams', os: 'win' });
  assert.equal(b.label, 'Micrófono Teams');
  assert.deepEqual(b.action, { type: 'hotkey', keys: 'mod+shift+m' });
  assert.equal(b.target, 'focus');
  assert.equal(sent[0].url, 'http://ia.local:11434/api/chat');
  assert.equal(sent[0].body.model, 'gpt-oss:20b');
  assert.match(sent[0].body.messages[0].content, /Windows/);
});

test('IA: si la primera respuesta no es válida, pide corregirla una vez', async () => {
  const answers = ['{"label":"X","action":{"type":"hotkey","keys":"ctrl+nada"}}', '{"label":"Guardar","action":{"type":"hotkey","keys":"mod+s"}}'];
  let calls = 0;
  const ai = createAssistant({ store: aiStore(), fetchImpl: async (u, o) => { calls++; if (calls === 2) assert.match(JSON.parse(o.body).messages.at(-1).content, /no es válido/); return reply(answers.shift()); } });
  const b = await ai.suggest({ prompt: 'guardar' });
  assert.equal(calls, 2);
  assert.equal(b.label, 'Guardar');
});

test('IA: nunca acepta acciones peligrosas sin validar ni URLs locales raras', async () => {
  const ai = createAssistant({ store: aiStore(), fetchImpl: async () => reply('{"label":"Hack","action":{"type":"open","target":"file:///etc/passwd"}}') });
  await assert.rejects(ai.suggest({ prompt: 'algo' }));
});

test('IA: sin configurar, o con demasiadas peticiones, avisa', async () => {
  await assert.rejects(createAssistant({ store: aiStore('', '') }).suggest({ prompt: 'x' }), /no está configurado/);
  const ai = createAssistant({ store: aiStore(), fetchImpl: async () => reply('{"label":"A","action":{"type":"media","cmd":"mute"}}') });
  for (let i = 0; i < 8; i++) await ai.suggest({ prompt: 'x', deviceId: 'd1' });
  await assert.rejects(ai.suggest({ prompt: 'x', deviceId: 'd1' }), /Demasiadas/);
  await assert.rejects(ai.suggest({ prompt: '   ' , deviceId: 'd2' }), /Describe/);
});

// --- Con el agente real (controlador simulado) --------------------------------------------

let agent, driver, home;
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'controldeck-test-'));
  driver = createMockDriver({ os: 'mac' });
  const aiFetch = async () => reply('{"label":"Gmail","icon":"📧","action":{"type":"open","target":"https://mail.google.com"}}');
  agent = await startAgent({ home, driver, port: 0, adminPort: 0, bind: '127.0.0.1', discovery: false, tailscale: false, aiFetch });
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
  let info = null;
  const client = await new Promise((resolve, reject) => {
    const c = createAgentClient({ proto, WebSocketImpl: WebSocket, url: `ws://127.0.0.1:${agent.lanPort}/ws`, device: { pub: kp.publicKey, sec: kp.secretKey },
      onEvent: async (e) => {
        events.push(e);
        if (e.status === 'sas') { const st = await admin('GET', '/api/state'); await admin('POST', `/api/pair/${st.pending[0].id}/approve`, {}); }
        if (e.status === 'ready') { info = e.info; resolve(c); }
        if (e.status === 'error') reject(new Error(e.code));
      } });
    c.connect();
  });
  return { client, events, info: () => info };
}

test('de punta a punta: IA, automatizaciones y música', async (t) => {
  const open = [];
  t.after(() => { for (const c of open) c.close(); });
  // Sin configurar, la tablet ve que no hay IA y pedirla falla con un mensaje claro.
  let { client, info } = await connectPaired();
  open.push(client);
  assert.equal(info().ai, false);
  const no = await client.request({ k: 'ai.suggest', prompt: 'abrir gmail' });
  assert.match(no.error, /no está configurado/);
  client.close();

  // El panel la configura; solo admite http(s).
  assert.ok((await admin('POST', '/api/ai', { url: 'file:///etc', model: 'x' })).error);
  assert.equal((await admin('POST', '/api/ai', { url: 'http://ia.local:11434/', model: 'gpt-oss:20b' })).ok, true);
  assert.deepEqual((await admin('GET', '/api/state')).ai, { url: 'http://ia.local:11434', model: 'gpt-oss:20b' });

  ({ client, info } = await connectPaired());
  open.push(client);
  assert.equal(info().ai, true);
  const r = await client.request({ k: 'ai.suggest', prompt: 'abrir gmail' });
  assert.equal(r.ok, true);
  assert.equal(r.button.label, 'Gmail');

  // Automatizaciones: se guardan validadas en esta computadora.
  const bad = await client.request({ k: 'automations.save', automations: [{ id: 'x', when: { type: 'app', app: 'a' }, action: { type: 'power', cmd: 'shutdown' } }] });
  assert.equal(bad.ok, false);
  const ok = await client.request({ k: 'automations.save', automations: [{ id: 'sim', name: 'Prueba', when: { type: 'app', app: 'simulado' }, action: { type: 'media', cmd: 'mute' } }] });
  assert.equal(ok.ok, true);
  assert.equal((await client.request({ k: 'automations.get' })).automations[0].name, 'Prueba');

  // Cuando "Simulado" vuelve a pasar al frente, la automatización corre sola.
  driver.setFrontmost('Otra app');
  await new Promise((res) => setTimeout(res, 1800));
  driver.setFrontmost('Simulado');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !driver.calls.some((c) => c.name === 'media' && c.arg === 'mute')) await new Promise((res) => setTimeout(res, 100));
  assert.ok(driver.calls.some((c) => c.name === 'media' && c.arg === 'mute'), 'la automatización corrió');
  const log = (await admin('GET', '/api/state')).log;
  assert.ok(log.some((e) => e.device === 'Automatización: Prueba' && e.ok));

  // Música: solo se consulta si la tablet la pide.
  const { client: c2, events } = await connectPaired();
  open.push(c2);
  c2.send({ k: 'state.want', music: true });
  const until = Date.now() + 8000;
  let withMusic;
  while (Date.now() < until && !(withMusic = events.find((e) => e.type === 'message' && e.payload.k === 'state' && e.payload.music))) await new Promise((res) => setTimeout(res, 150));
  assert.equal(withMusic?.payload.music, 'Artista — Canción');
  c2.close();
  client.close();
});

test('el monitor de actividad cerrado no vuelve a arrancar', async () => {
  const { createActivityMonitor } = await import('../agent/activity.js');
  let polls = 0;
  const m = createActivityMonitor({ driver: { frontmostApp: async () => { polls++; return 'x'; }, idleMs: async () => 0 }, hub: { broadcast() {} }, intervalMs: 20 });
  m.needForAutomations(true);
  m.close();
  m.update(false); // como cuando se desconecta la última tablet después de cerrar
  const before = polls;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(polls, before);
});
