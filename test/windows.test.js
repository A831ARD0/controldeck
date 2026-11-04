// Lista de ventanas y acomodar ventanas (mitades, centro, maximizar, minimizar).

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
import { validateAction, windowFrame, isWindowId, isTabId, actionHint, WINDOW_OPS } from '../shared/actions.js';
import { startAgent } from '../agent/index.js';
import { createMockDriver } from '../agent/drivers/mock.js';
import { _scripts, mergeTabs } from '../agent/drivers/mac.js';

const proto = createProtocol(nacl);

test('acciones de ventana: validación, partes de la pantalla e ids', () => {
  assert.deepEqual(validateAction({ type: 'window', op: 'left' }), { type: 'window', op: 'left' });
  assert.deepEqual(validateAction({ type: 'windows', extra: 1 }), { type: 'windows' });
  assert.throws(() => validateAction({ type: 'window', op: 'cerrar' }));
  for (const op of WINDOW_OPS) {
    const f = windowFrame(op);
    if (op === 'minimize') { assert.equal(f, null); continue; }
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= 1 && f.y + f.h <= 1, op);
  }
  assert.deepEqual(windowFrame('right'), { x: 0.5, y: 0, w: 0.5, h: 1 });
  for (const ok of ['front', '12345', '826:3']) assert.equal(isWindowId(ok), true, ok);
  for (const bad of ['', 'abc', '1;rm', '1:2:3', '-5', 12]) assert.equal(isWindowId(bad), false, String(bad));
  assert.match(actionHint({ type: 'window', op: 'maximize' }), /maximizar/);
});

test('la versión del agente coincide con package.json', async () => {
  const { VERSION } = await import('../agent/version.js');
  assert.equal(VERSION, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
});

test('los scripts de Mac reciben la ventana como argumento, no dentro del código', () => {
  assert.doesNotMatch(_scripts.WINDOW_JXA, /\$\{/);
  assert.match(_scripts.WINDOW_JXA, /argv\[1\]/);
});

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


test('la tablet lista las ventanas, las trae al frente y las acomoda', async () => {
  const { client } = await connectPaired();
  driver.windows.push({ id: '303:0', app: 'Terminal\u0007', title: 'x'.repeat(500), active: false, minimized: false }, { id: 'malo; rm', app: 'X', title: 'Y' });

  const list = await client.request({ k: 'windows.list' });
  assert.equal(list.ok, true);
  assert.equal(list.windows.length, 3, 'descarta ids inválidos');
  assert.equal(list.windows[0].title, 'Correo — Bandeja de entrada');
  assert.equal(list.windows[2].app, 'Terminal', 'quita caracteres de control');
  assert.equal(list.windows[2].title.length, 160);

  assert.equal((await client.request({ k: 'window.do', id: '202:0', op: 'focus', title: 'Ideas' })).ok, true);
  assert.deepEqual(driver.calls.at(-1), { name: 'window', arg: { id: '202:0', op: 'focus', frame: null, title: 'Ideas' } });
  assert.equal((await client.request({ k: 'window.do', id: '101:0', op: 'left' })).ok, true);
  assert.deepEqual(driver.calls.at(-1).arg.frame, { x: 0, y: 0, w: 0.5, h: 1 });

  // Datos inválidos no llegan al controlador.
  const before = driver.calls.length;
  assert.match((await client.request({ k: 'window.do', id: '1; borrar', op: 'left' })).error, /Ventana inválida/);
  assert.match((await client.request({ k: 'window.do', id: '101:0', op: 'cerrar' })).error, /inválida/);
  assert.equal(driver.calls.length, before);

  // Una tecla "a la derecha" actúa sobre la ventana activa.
  assert.equal((await client.request({ k: 'action.run', action: { type: 'window', op: 'right' } })).ok, true);
  assert.deepEqual(driver.calls.at(-1).arg, { id: 'front', op: 'right', frame: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  assert.match((await client.request({ k: 'action.run', action: { type: 'windows' } })).error, /coordina la tablet/);

  // Si el panel apaga el permiso, ni la lista ni las acciones funcionan.
  await admin('POST', '/api/policy', { policy: { allow: { window: false } } });
  assert.match((await client.request({ k: 'windows.list' })).error, /no permite/);
  assert.match((await client.request({ k: 'window.do', id: 'front', op: 'left' })).error, /no permite/);
  assert.match((await client.request({ k: 'action.run', action: { type: 'window', op: 'left' } })).error, /no permite/);
  await admin('POST', '/api/policy', { policy: { allow: { window: true } } });
  client.close();
});

test('pestañas del navegador: ids, unión con ventanas y solo para mostrar', async () => {
  for (const ok of ['t:826:258:4', 't:67040:0:19']) assert.equal(isTabId(ok), true, ok);
  for (const bad of ['t:1:2', 't:a:1:2', '826:258:4', 't:1:2:3;x']) assert.equal(isTabId(bad), false, bad);

  const merged = mergeTabs(
    [{ id: '826:0', app: 'Safari', title: 'Buscar con Google' }, { id: '826:1', app: 'Safari', title: 'Otra' }, { id: '9:0', app: 'Notas', title: 'Buscar con Google' }],
    [{ pid: 826, wid: 258, title: 'Buscar con Google', tabs: [{ i: 0, title: 'Uno', host: 'a.com', active: false }, { i: 1, title: 'Buscar con Google', host: 'google.com', active: true }] }]);
  assert.deepEqual(merged[0].tabs.map((t) => t.id), ['t:826:258:0', 't:826:258:1']);
  assert.equal(merged[1].tabs, undefined);
  assert.equal(merged[2].tabs, undefined, 'solo ventanas del mismo proceso');

  const { client } = await connectPaired();
  driver.windows[0].tabs.push({ id: 'malo', title: 'x' }, { id: 't:101:7:2', title: 'y'.repeat(400), host: 'z.com\u0007' });
  const list = await client.request({ k: 'windows.list' });
  const tabs = list.windows[0].tabs;
  assert.equal(tabs.length, 3, 'descarta ids inválidos');
  assert.equal(tabs[2].title.length, 160);
  assert.equal(tabs[2].host, 'z.com ');
  assert.equal((await client.request({ k: 'window.do', id: 't:101:7:1', op: 'focus' })).ok, true);
  assert.equal(driver.calls.at(-1).arg.id, 't:101:7:1');
  assert.match((await client.request({ k: 'window.do', id: 't:101:7:1', op: 'left' })).error, /inválida/);
  client.close();
});

test('notificaciones: llegan a la tablet, sin repetir, y se apagan desde el panel', async () => {
  const { client, events } = await connectPaired();
  const first = await client.request({ k: 'notifs.get' });
  assert.equal(first.ok, true);
  assert.equal(first.supported, true);
  driver.pushNotification({ key: 'n1', app: 'Slack', title: 'Ana', body: 'Hola\u0000 qué tal' });
  driver.pushNotification({ key: 'n1', app: 'Slack', title: 'Ana', body: 'repetida' });
  const tick = () => new Promise((r) => setTimeout(r, 60));
  await tick(); await agent.notifier.poll(); await tick();
  const got = events.filter((e) => e.type === 'message' && e.payload.k === 'notifs').flatMap((e) => e.payload.items);
  assert.equal(got.length, 1);
  assert.equal(got[0].body, 'Hola qué tal');
  assert.equal((await client.request({ k: 'notifs.get' })).items[0].title, 'Ana');

  // En Mac el aviso no trae la app: se toma de la única app cuyo contador subió.
  driver.badgeList = [{ app: 'Slack', count: '4' }];
  driver.pushNotification({ key: 'n2', title: 'Pedro', body: 'Listo' });
  await agent.notifier.poll(); await tick();
  assert.equal((await client.request({ k: 'notifs.get' })).items[0].app, 'Slack');

  await admin('POST', '/api/policy', { policy: { allow: { notifications: false } } });
  const off = await client.request({ k: 'notifs.get' });
  assert.equal(off.off, true);
  assert.equal(off.items.length, 0);
  await admin('POST', '/api/policy', { policy: { allow: { notifications: true } } });
  client.close();
});

test('notificaciones de Windows: nombre de la app y textos del aviso', async () => {
  const { appFromAumid, parseToast } = await import('../agent/notifications.js');
  const { parseBadge } = await import('../agent/drivers/mac.js');
  assert.equal(appFromAumid('CartasecPte.Ltd.CanaryMailApp_1h5es61sgwc0a!App'), 'Canary Mail');
  assert.equal(appFromAumid('Microsoft.Office.OUTLOOK.EXE.15'), 'Outlook');
  assert.equal(appFromAumid('5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'), 'WhatsApp');
  assert.deepEqual(parseToast("<toast><visual><binding><text>Hola &apos;yo&apos; &amp; tú</text><text>Uno\n</text><text>Dos</text></binding></visual></toast>"), { title: "Hola 'yo' & tú", body: 'Uno · Dos' });
  assert.deepEqual(parseBadge('"StatusLabel"={ "label"="43" }\n"LSDisplayName"="Slack"'), { app: 'Slack', count: '43' });
  assert.equal(parseBadge('"StatusLabel"={ "label"="" } "LSDisplayName"="Zoom"'), null);
});

test('ventanas en vivo: la computadora manda la lista y los cambios mientras la tablet la ve', async () => {
  const { client, events } = await connectPaired();
  const pushes = () => events.filter((e) => e.type === 'message' && e.payload.k === 'windows');
  const wait = async (n) => { for (let i = 0; i < 50 && pushes().length < n; i++) await new Promise((r) => setTimeout(r, 40)); };
  client.send({ k: 'windows.watch', on: true });
  await wait(1);
  assert.equal(pushes()[0].payload.windows[0].app, 'Safari');
  driver.windows.push({ id: '404:0', app: 'Mapas', title: 'Nueva', active: false, minimized: false });
  await client.request({ k: 'window.do', id: '404:0', op: 'focus' });
  await wait(2);
  assert.ok(pushes().at(-1).payload.windows.some((w) => w.app === 'Mapas'), 'manda el cambio');
  const count = pushes().length;
  client.send({ k: 'windows.watch', on: false });
  driver.windows.push({ id: '505:0', app: 'Fotos', title: 'x', active: false, minimized: false });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(pushes().length, count, 'deja de mandar');
  client.close();
});

test('avisos de Mac: la app sale de la descripción del aviso', async () => {
  const { appFromBanner } = await import('../agent/drivers/mac.js');
  assert.equal(appFromBanner('Slack, Ana López, ¿Revisamos?', 'Ana López'), 'Slack');
  assert.equal(appFromBanner('Editor de Scripts, Titulo X, Sub X, Cuerpo X', 'Titulo X'), 'Editor de Scripts');
  assert.equal(appFromBanner('', 'x'), '');
});

test('apps web instaladas: se reconocen por el sitio y no se confunden con el navegador', () => {
  const merged = mergeTabs(
    [{ id: '834:0', app: 'Microsoft Edge', bid: 'com.microsoft.edgemac', title: 'Nueva pestaña: Microsoft Edge' },
      { id: '1213:0', app: 'WhatsApp Web', bid: 'com.microsoft.edgemac.app.abc', title: '' }],
    [{ pid: 834, bid: 'com.microsoft.edgemac', wid: '1', title: 'Nueva pestaña', tabs: [{ i: 0, title: 'Nueva pestaña', host: 'newtab', active: true }] },
      { pid: 834, bid: 'com.microsoft.edgemac', wid: '2', title: '', tabs: [{ i: 0, title: '', host: 'web.whatsapp.com', active: true }] }]);
  assert.equal(merged[0].tabs.length, 1);
  assert.equal(merged[0].site, undefined);
  assert.equal(merged[1].site, 'web.whatsapp.com');
  assert.equal(merged[1].tabs, undefined);
});

test('findOpenSite: encuentra la pestaña o app web de la misma página', async () => {
  const { findOpenSite } = await import('../shared/actions.js');
  const ws = [
    { id: '10:0', app: 'Safari', title: 'Zoom', tabs: [
      { id: 't:10:1:0', title: 'Zoom', host: 'zoom.us', path: '/' },
      { id: 't:10:1:1', title: 'Ofertas', host: 'www.promodescuentos.com', path: '/nuevas' },
      { id: 't:10:1:2', title: 'org/otro', host: 'github.com', path: '/org/otro' },
      { id: 't:10:1:3', title: 'Docs', host: 'docs.google.com', path: '/document/d/1' },
    ] },
    { id: '20:0', app: 'WhatsApp Web', title: 'WhatsApp', site: 'web.whatsapp.com' },
    { id: '30:0', app: 'Brave', title: 'Recibidos - Gmail', tabs: [
      { id: 't:30:0:2', title: 'Recibidos (3) - yo@gmail.com - Gmail' },
      { id: 't:30:0:3', title: 'Google' },
    ] },
  ];
  assert.equal(findOpenSite(ws, 'https://promodescuentos.com/')?.id, 't:10:1:1');
  assert.equal(findOpenSite(ws, 'https://www.promodescuentos.com/nuevas?x=1')?.id, 't:10:1:1');
  assert.equal(findOpenSite(ws, 'https://promodescuentos.com/otra'), null, 'otra página del mismo sitio abre una pestaña nueva');
  assert.equal(findOpenSite(ws, 'https://github.com/org')?.id, 't:10:1:2', 'una página dentro de la pedida sirve');
  assert.equal(findOpenSite(ws, 'https://github.com/org/repo'), null);
  assert.equal(findOpenSite(ws, 'https://google.com/'), null, 'google.com no es docs.google.com');
  assert.deepEqual(findOpenSite(ws, 'https://web.whatsapp.com/'), { id: '20:0', title: 'WhatsApp' });
  assert.equal(findOpenSite(ws, 'https://mail.google.com/')?.id, 't:30:0:2', 'en Windows, por nombre del sitio');
  assert.equal(findOpenSite(ws, 'https://www.google.com/maps'), null, 'nunca por un nombre genérico');
  assert.equal(findOpenSite(ws, 'mailto:a@b.com'), null);
});
