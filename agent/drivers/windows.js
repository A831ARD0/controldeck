// Controlador para Windows. Mantiene vivo un solo proceso de PowerShell (windows-helper.ps1) que
// llama a SendInput y a otras APIs de Windows. Arrancar PowerShell por cada tecla tardaría
// cientos de milisegundos; así cada acción tarda pocos.

import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { assetFile } from '../assets.js';
import { appFromAumid, parseToast } from '../notifications.js';


export const VK = {
  ctrl: 0x11, shift: 0x10, alt: 0x12, win: 0x5b,
  enter: 0x0d, tab: 0x09, space: 0x20, escape: 0x1b, backspace: 0x08, delete: 0x2e, insert: 0x2d,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  printscreen: 0x2c, minus: 0xbd, equal: 0xbb, comma: 0xbc, period: 0xbe, slash: 0xbf,
  semicolon: 0xba, quote: 0xde, bracketleft: 0xdb, bracketright: 0xdd, backslash: 0xdc, grave: 0xc0,
  volup: 0xaf, voldown: 0xae, mute: 0xad, next: 0xb0, prev: 0xb1, playpause: 0xb3,
};
const EXTENDED = new Set(['delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'left', 'up', 'right', 'down', 'printscreen']);

export function keyToVk(key) {
  if (/^[a-z]$/.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  const f = /^f(\d{1,2})$/.exec(key);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) return 0x6f + Number(f[1]);
  if (VK[key] !== undefined) return VK[key];
  throw new Error(`Tecla no soportada en Windows: ${key}`);
}

export function buildCombo({ mods, key }) {
  return {
    op: 'combo',
    mods: mods.map((m) => { if (VK[m] === undefined) throw new Error(`Modificador no soportado: ${m}`); return VK[m]; }),
    key: keyToVk(key),
    extended: EXTENDED.has(key),
  };
}

const MOUSE = { move: 0x0001, leftDown: 0x0002, leftUp: 0x0004, rightDown: 0x0008, rightUp: 0x0010, wheel: 0x0800, hwheel: 0x01000 };

export function pointerRequest(ev) {
  const r = (v) => Math.max(-2000, Math.min(2000, Math.round(Number(v) || 0)));
  switch (ev.op) {
    case 'move': return { op: 'mouse', flags: MOUSE.move, dx: r(ev.dx), dy: r(ev.dy), data: 0 };
    case 'down': return { op: 'mouse', flags: MOUSE.leftDown, dx: 0, dy: 0, data: 0 };
    case 'up': return { op: 'mouse', flags: MOUSE.leftUp, dx: 0, dy: 0, data: 0 };
    case 'click': return ev.button === 'right'
      ? { op: 'mouse', flags: MOUSE.rightDown | MOUSE.rightUp, dx: 0, dy: 0, data: 0 }
      : { op: 'mouse', flags: MOUSE.leftDown | MOUSE.leftUp, dx: 0, dy: 0, data: 0 };
    case 'scroll': return { op: 'mouse', flags: MOUSE.wheel, dx: 0, dy: 0, data: -r(ev.dy) * 12 };
    default: throw new Error('Movimiento inválido');
  }
}

export function createWindowsDriver({ spawn = nodeSpawn, execFile = nodeExecFile } = {}) {
  let proc = null;
  let nextId = 1;
  const waiting = new Map();

  function start() {
    proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', assetFile('agent/drivers/windows-helper.ps1')], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let res;
      try { res = JSON.parse(line.replace(/^﻿/, '')); } catch { return; }
      const w = waiting.get(res.id);
      if (!w) return;
      waiting.delete(res.id);
      clearTimeout(w.timer);
      if (res.ok) w.resolve(res.result ?? null); else w.reject(new Error(String(res.error ?? 'Error en Windows').slice(0, 300)));
    });
    proc.stderr.on('data', () => {});
    proc.on('exit', () => {
      for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('El ayudante de Windows se cerró')); }
      waiting.clear();
      proc = null;
    });
  }

  function call(req) {
    if (!proc) start();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Windows no respondió a tiempo')); }, 15_000);
      waiting.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ ...req, id }) + '\n');
    });
  }

  const run = (cmd, args, timeout = 15_000) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve(String(stdout))));
  });

  let wpn;
  async function openWpn() {
    if (wpn !== undefined) return wpn;
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const file = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
      wpn = new DatabaseSync(file, { readOnly: true });
    } catch { wpn = null; }
    return wpn;
  }

  return {
    os: 'win',
    warmup() { if (!proc) start(); },
    hotkey: (combo) => call(buildCombo(combo)),
    text: (str) => call({ op: 'text', text: str }),
    open: ({ value }) => call({ op: 'open', target: value }),
    media: (cmd, value) => (cmd === 'setvolume' ? call({ op: 'setvolume', value }) : call({ op: 'combo', mods: [], key: VK[cmd], extended: true })),
    volume: async () => null,
    battery: async () => (await call({ op: 'battery' })) ?? null,
    // Los movimientos no esperan respuesta: el ayudante procesa en orden y los errores se ignoran.
    pointer(ev) { call(pointerRequest(ev)).catch(() => {}); },
    async power(cmd) {
      if (cmd === 'lock') return call({ op: 'lock' });
      if (cmd === 'sleep') return call({ op: 'sleep' });
      return run('shutdown.exe', [cmd === 'restart' ? '/r' : '/s', '/t', '0']);
    },
    async runScript(file) {
      if (/\.ps1$/i.test(file)) return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], 60_000);
      if (/\.(bat|cmd)$/i.test(file)) return run('cmd.exe', ['/d', '/c', file], 60_000);
      throw new Error('Tipo de script no soportado en Windows (.ps1, .bat, .cmd)');
    },
    frontmostApp: async () => String((await call({ op: 'foreground' })) ?? '').slice(0, 80),
    listWindows: async () => { const r = await call({ op: 'windows' }); return Array.isArray(r) ? r : r ? [r] : []; },
    windowDo: ({ id, op, frame }) => id.startsWith('t:') ? call({ op: 'tab', target: id }) : call({ op: 'window', target: id, what: op, frame: frame ? [frame.x, frame.y, frame.w, frame.h] : null }),
    idleMs: async () => Number(await call({ op: 'idle' })) || 0,
    // Historial de notificaciones de Windows (una base SQLite del usuario, solo lectura).
    // El primer llamado solo marca dónde va; después regresa las nuevas.
    async notifications(cursor) {
      const db = await openWpn();
      if (!db) return { cursor, items: [] };
      if (cursor == null) return { cursor: Number(db.prepare('select max([Order]) as m from Notification').get().m ?? 0), items: [] };
      const rows = db.prepare("select n.[Order] as o, n.Id as id, h.PrimaryId as aumid, cast(n.Payload as text) as xml from Notification n join NotificationHandler h on h.RecordId = n.HandlerId where n.Type = 'toast' and n.[Order] > ? order by n.[Order] limit 20").all(cursor);
      let next = cursor;
      const items = rows.map((r) => { next = Math.max(next, Number(r.o)); return { key: `win:${r.id}:${r.o}`, app: appFromAumid(r.aumid), ...parseToast(r.xml) }; });
      return { cursor: next, items };
    },
    readClipboard: async () => String((await call({ op: 'clipboard' })) ?? ''),
    writeClipboard: (text) => call({ op: 'setclipboard', text }),
    close() { if (proc) { proc.stdin.end(); proc.kill(); proc = null; } },
  };
}
