// Controlador para macOS. Usa osascript (AppleScript/JXA), open, pmset, lsappinfo e ioreg.
// Lo que llega de la tablet viaja siempre como argumento (argv), nunca dentro del texto del script.
// Requiere el permiso de Accesibilidad para la app que ejecuta el agente.

import os from 'node:os';
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';

const MAC_KEY_CODES = {
  enter: 36, tab: 48, space: 49, escape: 53, backspace: 51, delete: 117, insert: 114,
  home: 115, end: 119, pageup: 116, pagedown: 121, left: 123, right: 124, down: 125, up: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109,
  f11: 103, f12: 111, f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
};
const MAC_CHARS = { minus: '-', equal: '=', comma: ',', period: '.', slash: '/', semicolon: ';',
  quote: "'", bracketleft: '[', bracketright: ']', backslash: '\\', grave: '`' };

const HOTKEY_SCRIPT = `on run argv
  set mode to item 1 of argv
  set k to item 2 of argv
  set m to {}
  repeat with i from 3 to count of argv
    set x to item i of argv
    if x is "cmd" then set end of m to command down
    if x is "ctrl" then set end of m to control down
    if x is "alt" then set end of m to option down
    if x is "shift" then set end of m to shift down
  end repeat
  tell application "System Events"
    if mode is "code" then
      key code (k as integer) using m
    else
      keystroke k using m
    end if
  end tell
end run`;

const TEXT_SCRIPT = `on run argv
  tell application "System Events" to keystroke (item 1 of argv)
end run`;

const VOLUME_SCRIPT = `on run argv
  set cmd to item 1 of argv
  set s to get volume settings
  if cmd is "mute" then
    set volume output muted (not (output muted of s))
  else
    set v to output volume of s
    if cmd is "volup" then
      set v to v + 6
    else
      set v to v - 6
    end if
    if v > 100 then set v to 100
    if v < 0 then set v to 0
    set volume output volume v
  end if
end run`;

// Teclas multimedia del sistema (NX_KEYTYPE_PLAY=16, NEXT=17, PREVIOUS=18) vía JXA.
const MEDIA_KEY_JXA = `ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
function run(argv) {
  const key = parseInt(argv[0], 10);
  for (const down of [true, false]) {
    const ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
      14, $.NSMakePoint(0, 0), down ? 0xa00 : 0xb00, 0, 0, null, 8, (key << 16) | ((down ? 0xa : 0xb) << 8), -1);
    $.CGEventPost(0, ev.CGEvent);
  }
}`;

// Música y Spotify se controlan directo: macOS ya no siempre entrega las teclas multimedia
// simuladas. Se elige la que está sonando, si no la que está en pausa. Devuelve "" si ninguna
// aplica, y entonces se usa la tecla del sistema (para el navegador y otras apps).
const MEDIA_APP_JXA = `function run(argv) {
  var cmd = argv[0];
  var ids = ['com.spotify.client', 'com.apple.Music'];
  var apps = [];
  for (var i = 0; i < ids.length; i++) {
    try { var a = Application(ids[i]); if (a.running()) apps.push(a); } catch (e) {}
  }
  var state = function (a) { try { return a.playerState(); } catch (e) { return ''; } };
  var target = apps.filter(function (a) { return state(a) === 'playing'; })[0] || apps.filter(function (a) { return state(a) === 'paused'; })[0];
  if (!target) return '';
  if (cmd === 'playpause') target.playpause();
  else if (cmd === 'next') target.nextTrack();
  else if (cmd === 'prev') target.previousTrack();
  return target.name();
}`;

const SET_VOLUME_SCRIPT = `on run argv
  set volume output volume ((item 1 of argv) as integer)
  if output muted of (get volume settings) then set volume output muted false
end run`;

// Ayudante de mouse que queda abierto (arrancar osascript por cada movimiento sería lento):
// lee una orden JSON por línea y genera eventos de mouse con CoreGraphics.
const POINTER_JXA = `ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
var held = false;
function loc() { return $.CGEventGetLocation($.CGEventCreate(null)); }
function post(type, x, y, button) { $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button)); }
function handle(m) {
  var p = loc();
  if (m.op === 'move') { post(held ? 6 : 5, p.x + m.dx, p.y + m.dy, 0); }
  else if (m.op === 'click') { var r = m.button === 'right'; post(r ? 3 : 1, p.x, p.y, r ? 1 : 0); post(r ? 4 : 2, p.x, p.y, r ? 1 : 0); }
  else if (m.op === 'down') { held = true; post(1, p.x, p.y, 0); }
  else if (m.op === 'up') { held = false; post(2, p.x, p.y, 0); }
  else if (m.op === 'scroll') { $.CGEventPost(0, $.CGEventCreateScrollWheelEvent(null, 0, 2, m.dy | 0, m.dx | 0)); }
}
function run() {
  var input = $.NSFileHandle.fileHandleWithStandardInput, buf = '';
  while (true) {
    var data = input.availableData;
    if (Number(data.length) === 0) break; // fin de la entrada: el agente se cerró
    buf += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    var i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      var line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { handle(JSON.parse(line)); } catch (e) {}
    }
  }
}`;

// Canción en reproducción en Spotify o Música. Solo se consulta una app si ya está abierta,
// para no abrirla ni pedir permisos de más.
const NOW_PLAYING_JXA = `function run() {
  var se = Application('System Events');
  var names = ['Spotify', 'Music'];
  for (var i = 0; i < names.length; i++) {
    if (se.processes.whose({ name: names[i] }).length === 0) continue;
    try {
      var app = Application(names[i]);
      if (app.playerState() !== 'playing') continue;
      var t = app.currentTrack();
      return t.artist() + ' — ' + t.name();
    } catch (e) {}
  }
  return '';
}`;

// Ventanas abiertas de todas las apps visibles, leídas directo con la API de Accesibilidad
// (unas 3 veces más rápido que preguntarle a System Events). Cada app tiene un límite de
// espera corto para que una app trabada no frene la lista. El orden de las ventanas es el mismo
// que usa System Events, así que los ids "pid:índice" sirven para WINDOW_JXA.
const LIST_WINDOWS_JXA = `ObjC.import('AppKit');
ObjC.import('ApplicationServices');
function attr(el, name) {
  const ref = Ref();
  if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0) return null;
  return ObjC.castRefToObject(ref[0]);
}
function run() {
  if (!$.AXIsProcessTrusted()) throw new Error('assistive: falta el permiso de Accesibilidad');
  const ws = $.NSWorkspace.sharedWorkspace;
  const apps = ws.runningApplications;
  const front = ws.frontmostApplication.processIdentifier;
  const out = [];
  for (let i = 0; i < apps.count && out.length < 80; i++) {
    const a = apps.objectAtIndex(i);
    if (Number(a.activationPolicy) !== 0) continue;
    const pid = a.processIdentifier;
    const ax = $.AXUIElementCreateApplication(pid);
    $.AXUIElementSetMessagingTimeout(ax, 0.4);
    const wins = attr(ax, 'AXWindows');
    if (!wins) continue;
    let first = true;
    for (let k = 0; k < wins.count && out.length < 80; k++) {
      const w = wins.objectAtIndex(k);
      // Solo ventanas de verdad (el escritorio de Finder también aparece, como área sin subrol).
      const role = attr(w, 'AXRole');
      const sub = attr(w, 'AXSubrole');
      const s = sub ? sub.js : '';
      if ((role && role.js !== 'AXWindow') || (s !== 'AXStandardWindow' && s !== 'AXDialog')) continue;
      const t = attr(w, 'AXTitle');
      const m = attr(w, 'AXMinimized');
      const min = m ? Boolean(m.boolValue) : false;
      out.push({ id: pid + ':' + k, app: a.localizedName.js, bid: a.bundleIdentifier.js || '', title: t ? t.js : '', active: pid === front && first && !min, minimized: min });
      first = false;
    }
  }
  return JSON.stringify(out);
}`;

// Pestañas de los navegadores abiertos (Safari y los basados en Chromium). Va aparte de la
// lista de ventanas: la primera vez macOS pide permiso para controlar cada navegador y, mientras
// nadie responde, esto se queda esperando; la lista de ventanas no debe esperar por eso.
const BROWSERS = { 'com.apple.Safari': 'safari', 'com.google.Chrome': 'chrome', 'com.brave.Browser': 'chrome', 'com.microsoft.edgemac': 'chrome', 'org.chromium.Chromium': 'chrome', 'com.vivaldi.Vivaldi': 'chrome' };
const LIST_TABS_JXA = `function run(argv) {
  const kinds = JSON.parse(argv[0]);
  const se = Application('System Events');
  const out = [];
  Object.keys(kinds).forEach(function (bid) {
    let app;
    try { app = Application(bid); if (!app.running()) return; } catch (e) { return; }
    try {
      const p = se.applicationProcesses.whose({ bundleIdentifier: bid })()[0];
      if (!p) return;
      const pid = p.unixId();
      const safari = kinds[bid] === 'safari';
      const ids = app.windows.id();
      const names = safari ? app.windows.name() : app.windows.title();
      const titles = app.windows.tabs[safari ? 'name' : 'title']();
      const urls = app.windows.tabs.url();
      let current = [];
      try { current = safari ? app.windows.currentTab.index() : app.windows.activeTabIndex(); } catch (e) {}
      for (let i = 0; i < ids.length; i++) {
        if (!titles[i] || !titles[i].length) continue;
        out.push({ pid: pid, bid: bid, wid: ids[i], title: names[i] || '', tabs: titles[i].map(function (t, k) {
          let host = '', path = '';
          try {
            const rest = String(urls[i][k] || '').replace(/^[a-z]+:[/][/](www[.])?/i, '').split(/[?#]/)[0];
            host = rest.split('/')[0];
            path = rest.slice(host.length);
          } catch (e) {}
          return { i: k, title: t || '', host: host, path: path, active: current[i] === k + 1 };
        }) });
      }
    } catch (e) {}
  });
  return JSON.stringify(out);
}`;

// Muestra una pestaña: la activa, trae su ventana al frente y activa el navegador.
const TAB_JXA = `function run(argv) {
  const pid = Number(argv[0]), wid = Number(argv[1]), idx = Number(argv[2]);
  const se = Application('System Events');
  const p = se.applicationProcesses.whose({ unixId: pid })()[0];
  if (!p) throw new Error('Ese navegador ya se cerró');
  const app = Application(p.bundleIdentifier());
  const w = app.windows.byId(wid);
  try { w.id(); } catch (e) { throw new Error('Esa ventana ya no existe'); }
  if (idx >= w.tabs.length) throw new Error('Esa pestaña ya se cerró');
  if (p.bundleIdentifier() === 'com.apple.Safari') {
    try { if (w.miniaturized()) w.miniaturized = false; } catch (e) {}
    w.currentTab = w.tabs[idx];
  } else {
    try { if (w.minimized()) w.minimized = false; } catch (e) {}
    w.activeTabIndex = idx + 1;
  }
  w.index = 1;
  app.activate();
}`;

// Une las pestañas con las ventanas de la lista. Primero por título exacto en el mismo proceso;
// las apps web instaladas (por ejemplo WhatsApp Web desde Edge) son ventanas de otro proceso:
// a esas no se les ponen pestañas, solo el sitio que muestran ("site"), para encontrarlas.
export function mergeTabs(windows, browsers) {
  const left = [];
  for (const b of browsers) {
    const own = windows.filter((x) => x.id.startsWith(`${b.pid}:`) && !x.tabs);
    // Chrome y Edge le agregan el nombre del navegador al título ("Nueva pestaña: Microsoft Edge").
    const w = b.title ? own.find((x) => x.title === b.title) ?? own.find((x) => x.title.startsWith(b.title)) : null;
    if (w) attach(w, b); else left.push(b);
  }
  for (const b of left) {
    const pwa = b.bid && b.tabs.length === 1 ? windows.filter((x) => x.bid?.startsWith(`${b.bid}.app.`) && !x.site) : [];
    const p = pwa.find((x) => x.title === b.title) ?? (pwa.length === 1 ? pwa[0] : null);
    if (p) { p.site = b.tabs[0].host; continue; }
    if (!b.title) continue;
    const own = windows.filter((x) => x.id.startsWith(`${b.pid}:`) && !x.tabs);
    const w = own.find((x) => x.title.startsWith(b.title) || b.title.startsWith(x.title)) ?? (own.length === 1 ? own[0] : null);
    if (w) attach(w, b);
  }
  return windows;

  function attach(w, b) {
    // `path` solo se usa en esta computadora (para no abrir otra pestaña de la misma página);
    // a la tablet solo le llega el dominio.
    w.tabs = b.tabs.map((t) => ({ id: `t:${b.pid}:${b.wid}:${t.i}`, title: t.title, host: t.host, path: t.path, active: t.active }));
  }
}

// Avisos que están en pantalla (Centro de notificaciones), leídos directo con la API de
// Accesibilidad. La descripción del aviso empieza con el nombre de la app ("Slack, Ana, Hola");
// cada aviso trae un identificador propio, así el mismo no se manda dos veces.
const NOTIFS_JXA = `ObjC.import('AppKit');
ObjC.import('ApplicationServices');
function attr(el, name) {
  const ref = Ref();
  if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0) return null;
  return ObjC.castRefToObject(ref[0]);
}
const str = (v) => { try { return v ? (v.string ? v.string.js : v.js) || '' : ''; } catch (e) { return ''; } };
function run() {
  const list = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.apple.notificationcenterui');
  if (!list.count) return '[]';
  const ax = $.AXUIElementCreateApplication(list.objectAtIndex(0).processIdentifier);
  $.AXUIElementSetMessagingTimeout(ax, 0.5);
  const out = [];
  function walk(el, depth) {
    if (depth > 8 || out.length >= 10) return;
    const sub = str(attr(el, 'AXSubrole'));
    if (sub === 'AXNotificationCenterBanner' || sub === 'AXNotificationCenterAlert') {
      const texts = {};
      const kids = attr(el, 'AXChildren');
      if (kids) for (let i = 0; i < kids.count; i++) {
        const k = kids.objectAtIndex(i);
        const id = str(attr(k, 'AXIdentifier')), v = str(attr(k, 'AXValue'));
        if (v && id) texts[id] = texts[id] ? texts[id] + ' ' + v : v;
      }
      out.push({ key: str(attr(el, 'AXIdentifier')), desc: str(attr(el, 'AXAttributedDescription')) || str(attr(el, 'AXDescription')), title: texts.title || '', subtitle: texts.subtitle || '', body: texts.body || '' });
      return;
    }
    const kids = attr(el, 'AXChildren');
    if (kids) for (let i = 0; i < kids.count; i++) walk(kids.objectAtIndex(i), depth + 1);
  }
  const wins = attr(ax, 'AXWindows');
  if (wins) for (let i = 0; i < wins.count; i++) walk(wins.objectAtIndex(i), 0);
  return JSON.stringify(out);
}`;

// "Slack, Ana López, ¿Revisamos?" con título "Ana López" → "Slack".
export function appFromBanner(desc, title) {
  const d = String(desc ?? '');
  const t = String(title ?? '');
  if (t) { const i = d.indexOf(`, ${t}`); if (i > 0) return d.slice(0, i).trim(); }
  const first = d.split(', ')[0].trim();
  return first && first !== d.trim() ? first : '';
}

// "StatusLabel"={ "label"="43" } "LSDisplayName"="Slack" → { app: 'Slack', count: '43' }
export function parseBadge(out) {
  const label = /"label"="([^"]*)"/.exec(out)?.[1] ?? '';
  const app = /"(?:LSDisplayName|name)"="([^"]*)"/.exec(out)?.[1] ?? '';
  return label && app ? { app, count: label } : null;
}

// Muestra, minimiza o acomoda una ventana. argv: orden, id ("front" o "pid:índice" de la lista),
// título esperado (por si el orden cambió) y la parte de la pantalla "x,y,ancho,alto" (0 a 1).
// Busca la ventana con la API de Accesibilidad, igual que la lista, para que los ids coincidan.
// Para mover y cambiar el tamaño usa System Events sobre la ventana ya traída al frente.
const WINDOW_JXA = `ObjC.import('AppKit');
ObjC.import('ApplicationServices');
function attr(el, name) {
  const ref = Ref();
  if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0) return null;
  return ObjC.castRefToObject(ref[0]);
}
const str = (v) => (v && v.js) || '';
function run(argv) {
  const op = argv[0], id = argv[1], title = argv[2] || '';
  const fr = argv[3] ? argv[3].split(',').map(Number) : null;
  let pid, idx = 0;
  if (id === 'front') {
    const f = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!f) throw new Error('No hay una ventana activa');
    pid = f.processIdentifier;
  } else {
    const parts = id.split(':').map(Number);
    pid = parts[0]; idx = parts[1] || 0;
  }
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (!app || app.isTerminated) throw new Error('Esa app ya se cerró');
  const ax = $.AXUIElementCreateApplication(pid);
  $.AXUIElementSetMessagingTimeout(ax, 1);
  const ws = attr(ax, 'AXWindows');
  if (!ws || !ws.count) throw new Error('Esa app ya no tiene ventanas abiertas');
  let w = null;
  if (id === 'front') w = attr(ax, 'AXFocusedWindow') || attr(ax, 'AXMainWindow') || ws.objectAtIndex(0);
  else {
    const at = idx < ws.count ? ws.objectAtIndex(idx) : null;
    if (at && (!title || str(attr(at, 'AXTitle')) === title)) w = at;
    for (let i = 0; !w && i < ws.count; i++) if (str(attr(ws.objectAtIndex(i), 'AXTitle')) === title) w = ws.objectAtIndex(i);
    if (!w) w = at;
  }
  if (!w) throw new Error('Esa ventana ya se cerró');
  const yes = $.NSNumber.numberWithBool(true), no = $.NSNumber.numberWithBool(false);
  if (op === 'minimize') { $.AXUIElementSetAttributeValue(w, $('AXMinimized'), yes); return; }
  $.AXUIElementSetAttributeValue(w, $('AXMinimized'), no);
  app.activateWithOptions(3);
  $.AXUIElementPerformAction(w, $('AXRaise'));
  $.AXUIElementSetAttributeValue(w, $('AXMain'), yes);
  if (!fr) return;
  delay(0.08);
  const p = Application('System Events').applicationProcesses.whose({ unixId: pid })()[0];
  const sw = p && p.windows()[0];
  if (!sw) throw new Error('No se pudo acomodar esa ventana');
  const screens = $.NSScreen.screens;
  const H = screens.objectAtIndex(0).frame.size.height;
  let pos = [0, 0], size = [0, 0];
  try { pos = sw.position(); size = sw.size(); } catch (e) {}
  const cx = pos[0] + size[0] / 2, cy = pos[1] + size[1] / 2;
  const toArea = function (v) { return { x: v.origin.x, y: H - (v.origin.y + v.size.height), w: v.size.width, h: v.size.height }; };
  let area = toArea(screens.objectAtIndex(0).visibleFrame);
  for (let i = 0; i < screens.count; i++) {
    const s = screens.objectAtIndex(i), f = s.frame, top = H - (f.origin.y + f.size.height);
    if (cx >= f.origin.x && cx < f.origin.x + f.size.width && cy >= top && cy < top + f.size.height) { area = toArea(s.visibleFrame); break; }
  }
  const x = Math.round(area.x + fr[0] * area.w), y = Math.round(area.y + fr[1] * area.h);
  sw.position = [x, y];
  sw.size = [Math.round(fr[2] * area.w), Math.round(fr[3] * area.h)];
  sw.position = [x, y];
}`;

const SYSTEM_EVENTS_POWER = { restart: 'tell application "System Events" to restart', shutdown: 'tell application "System Events" to shut down' };

export function createMacDriver({ execFile = nodeExecFile, spawn = nodeSpawn } = {}) {
  let pointerProc = null;
  const iphoneApps = new Map();
  // ¿Es una app del iPhone registrada por Duplicación del iPhone? (se busca una vez por nombre)
  function isIphoneApp(name) {
    if (iphoneApps.has(name)) return iphoneApps.get(name);
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    const job = new Promise((resolve) => {
      execFile('/bin/sh', ['-c', '"$LSR" -dump 2>/dev/null | grep -F "Placeholders-v6.noindex/" | grep -F -m1 "/$APP.app"'],
        { timeout: 15_000, maxBuffer: 1024 * 1024, env: { ...process.env, LSR: lsregister, APP: name } },
        (err, stdout) => resolve(!err && String(stdout).trim().length > 0));
    });
    iphoneApps.set(name, job);
    return job;
  }
  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, maxBuffer: 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message);
        if (/not allowed|1002|-25211|assistive/i.test(msg)) {
          reject(new Error('macOS bloqueó la acción: da permiso de Accesibilidad al agente en Configuración del Sistema → Privacidad y seguridad'));
        } else reject(new Error(msg.trim().slice(0, 300)));
      } else resolve(String(stdout));
    });
  });

  return {
    os: 'mac',

    async hotkey({ mods, key }) {
      let mode, k;
      if (MAC_KEY_CODES[key] !== undefined) { mode = 'code'; k = String(MAC_KEY_CODES[key]); }
      else if (MAC_CHARS[key]) { mode = 'char'; k = MAC_CHARS[key]; }
      else if (/^[a-z0-9]$/.test(key)) { mode = 'char'; k = key; }
      else throw new Error(`La tecla ${key} no existe en Mac`);
      const macMods = mods.map((m) => (m === 'win' ? 'cmd' : m));
      await run('osascript', ['-e', HOTKEY_SCRIPT, mode, k, ...macMods]);
    },

    async text(str) {
      await run('osascript', ['-e', TEXT_SCRIPT, str]);
    },

    async open({ kind, value }) {
      if (kind !== 'app') return void await run('open', [value]);
      try {
        await run('open', ['-a', value]);
      } catch (err) {
        if (!/Unable to find application/i.test(err.message)) throw err;
        // Las notificaciones del iPhone (Duplicación del iPhone) llegan con el nombre de una app
        // que en la Mac solo existe como acceso a la del iPhone: se abre la duplicación.
        if (await isIphoneApp(value)) return void await run('open', ['-b', 'com.apple.ScreenContinuity']);
        throw new Error(`No encontré la app “${value}” en esta Mac`);
      }
    },

    async media(cmd, value) {
      if (cmd === 'setvolume') return void await run('osascript', ['-e', SET_VOLUME_SCRIPT, String(value)]);
      if (cmd === 'volup' || cmd === 'voldown' || cmd === 'mute') return void await run('osascript', ['-e', VOLUME_SCRIPT, cmd]);
      const code = { playpause: 16, next: 17, prev: 18 }[cmd];
      const handled = await run('osascript', ['-l', 'JavaScript', '-e', MEDIA_APP_JXA, cmd]).catch(() => '');
      if (handled.trim()) return;
      await run('osascript', ['-l', 'JavaScript', '-e', MEDIA_KEY_JXA, String(code)]);
    },

    async power(cmd) {
      if (cmd === 'lock') return void await run('osascript', ['-e', HOTKEY_SCRIPT, 'char', 'q', 'cmd', 'ctrl']);
      if (cmd === 'sleep') return void await run('pmset', ['sleepnow']);
      await run('osascript', ['-e', SYSTEM_EVENTS_POWER[cmd]]);
    },

    async runScript(file) {
      if (/\.(applescript|scpt)$/i.test(file)) return run('osascript', [file], { timeout: 60_000 });
      if (/\.(sh|command)$/i.test(file)) return run('/bin/sh', [file], { timeout: 60_000 });
      throw new Error('Tipo de script no soportado en Mac (.sh, .command, .applescript, .scpt)');
    },

    async frontmostApp() {
      const asn = (await run('lsappinfo', ['front'])).trim();
      if (!/^ASN:[0-9a-fx-]+:?$/i.test(asn)) return '';
      return parseLsappinfoName(await run('lsappinfo', ['info', '-only', 'name', asn]));
    },

    async idleMs() {
      return parseIoregIdle(await run('ioreg', ['-c', 'IOHIDSystem', '-d', '4']));
    },

    async volume() {
      const out = await run('osascript', ['-e', 'output volume of (get volume settings)']);
      const n = parseInt(out, 10);
      return Number.isFinite(n) ? n : null;
    },

    async nowPlaying() {
      return (await run('osascript', ['-l', 'JavaScript', '-e', NOW_PLAYING_JXA])).trim().slice(0, 120);
    },

    async memory() {
      return parseVmStat(await run('vm_stat', []), os.totalmem());
    },

    async battery() {
      return parseBattery(await run('pmset', ['-g', 'batt']));
    },

    pointer(ev) {
      if (!pointerProc || pointerProc.exitCode !== null) {
        pointerProc = spawn('osascript', ['-l', 'JavaScript', '-e', POINTER_JXA], { stdio: ['pipe', 'ignore', 'ignore'] });
        pointerProc.on('error', () => { pointerProc = null; });
        pointerProc.stdin.on('error', () => {});
      }
      pointerProc.stdin.write(JSON.stringify(ev) + '\n');
    },

    async listWindows() {
      const windows = JSON.parse((await run('osascript', ['-l', 'JavaScript', '-e', LIST_WINDOWS_JXA], { timeout: 20_000 })) || '[]');
      // Pestañas solo de los navegadores abiertos, uno por proceso: si uno espera el permiso de
      // macOS, los demás no se pierden.
      const open = [...new Set(windows.map((w) => w.bid).filter((b) => BROWSERS[b]))];
      const tabs = (await Promise.all(open.map((bid) => run('osascript', ['-l', 'JavaScript', '-e', LIST_TABS_JXA, JSON.stringify({ [bid]: BROWSERS[bid] })], { timeout: 8_000 })
        .then((out) => JSON.parse(out || '[]')).catch(() => [])))).flat();
      return mergeTabs(windows, tabs);
    },

    async windowDo({ id, op, frame, title = '' }) {
      if (id.startsWith('t:')) {
        const [, pid, wid, idx] = id.split(':');
        return void await run('osascript', ['-l', 'JavaScript', '-e', TAB_JXA, pid, wid, idx]);
      }
      const f = frame ? [frame.x, frame.y, frame.w, frame.h].join(',') : '';
      await run('osascript', ['-l', 'JavaScript', '-e', WINDOW_JXA, op, id, title, f]);
    },

    async notifications() {
      const items = JSON.parse((await run('osascript', ['-l', 'JavaScript', '-e', NOTIFS_JXA], { timeout: 6_000 })) || '[]');
      return { items: items.map((n) => ({
        key: `mac:${n.key || [n.title, n.body].join('|')}`,
        app: appFromBanner(n.desc, n.title || n.subtitle || n.body),
        title: n.title,
        body: [n.subtitle, n.body].filter(Boolean).join(' · '),
      })) };
    },

    // Contadores de las apps (el número rojo del Dock), con lsappinfo: rápido y sin permisos.
    async badges() {
      const asns = (await run('lsappinfo', ['visibleProcessList'])).match(/ASN:0x[0-9a-f]+-0x[0-9a-f]+/gi) ?? [];
      const all = await Promise.all(asns.slice(0, 60).map((asn) => run('lsappinfo', ['info', '-only', 'StatusLabel', '-only', 'name', asn]).then(parseBadge, () => null)));
      return all.filter(Boolean);
    },

    async readClipboard() {
      return run('pbpaste', [], { env: { ...process.env, LANG: 'en_US.UTF-8' } });
    },

    writeClipboard(text) {
      return new Promise((resolve, reject) => {
        const p = spawn('pbcopy', [], { env: { ...process.env, LANG: 'en_US.UTF-8' }, stdio: ['pipe', 'ignore', 'pipe'] });
        let err = '';
        p.stderr?.on('data', (d) => { err += d; });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || 'No se pudo copiar'))));
        p.stdin.end(text, 'utf8');
      });
    },

    close() { pointerProc?.kill(); pointerProc = null; },
  };
}

export function parseLsappinfoName(out) {
  const m = /"(?:LSDisplayName|name)"\s*=\s*"([^"]*)"/.exec(out);
  return m ? m[1].slice(0, 80) : '';
}

// "Now drawing from 'Battery Power' … 87%; discharging" → { percent: 87, charging: false }
export function parseBattery(out) {
  const m = /(\d{1,3})%;\s*([a-z ]+)/i.exec(out);
  if (!m) return null;
  return { percent: Math.min(100, Number(m[1])), charging: !/discharging/i.test(m[2]) };
}

// Memoria en uso como la cuenta el Monitor de Actividad: activa + fija + comprimida.
export function parseVmStat(out, total) {
  const page = Number(/page size of (\d+) bytes/.exec(out)?.[1]);
  const pages = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? NaN);
  const used = (pages('Pages active') + pages('Pages wired down') + (pages('Pages occupied by compressor') || 0)) * page;
  return Number.isFinite(used) && total > 0 ? Math.min(100, Math.round((100 * used) / total)) : null;
}

export function parseIoregIdle(out) {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out);
  return m ? Math.floor(Number(m[1]) / 1e6) : 0;
}

export const _scripts = { MEDIA_APP_JXA, HOTKEY_SCRIPT, TEXT_SCRIPT, VOLUME_SCRIPT, MEDIA_KEY_JXA, SET_VOLUME_SCRIPT, POINTER_JXA, NOW_PLAYING_JXA, LIST_WINDOWS_JXA, WINDOW_JXA, LIST_TABS_JXA, TAB_JXA, NOTIFS_JXA };
