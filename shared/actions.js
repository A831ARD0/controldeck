// Validación de acciones y del deck. Se usa en la tablet (para avisar antes de guardar) y en el
// agente (que es quien decide: nunca confía en lo que manda la tablet).

export const LIMITS = {
  label: 40,
  text: 2000,
  target: 2048,
  pages: 50,
  buttonsPerPage: 64,
  multiSteps: 32,
  delayMs: 10_000,
  imageBytes: 96 * 1024,
  deckBytes: 4 * 1024 * 1024,
};

// Acciones que coordina la tablet entre varias computadoras (no las ejecuta un solo agente).
export const TABLET_ACTIONS = ['clipboard', 'wake', 'cycle', 'stat', 'volume', 'touchpad', 'windows'];
export const STAT_METRICS = ['cpu', 'ram', 'battery', 'app', 'clock', 'music'];
export const CYCLE_MAX = 8;
export const MEDIA_CMDS = ['playpause', 'next', 'prev', 'volup', 'voldown', 'mute'];
export const POWER_CMDS = ['lock', 'sleep', 'restart', 'shutdown'];
// Acomodar ventanas: la activa (en una tecla) o la que se elija en la lista de ventanas.
export const WINDOW_OPS = ['left', 'right', 'top', 'bottom', 'center', 'maximize', 'minimize'];
export const WINDOW_OP_NAMES = { focus: 'Mostrar', left: 'Mitad izquierda', right: 'Mitad derecha', top: 'Mitad de arriba', bottom: 'Mitad de abajo', center: 'Al centro', maximize: 'Maximizar', minimize: 'Minimizar' };
// Parte del área de trabajo de la pantalla (sin barra de menús ni de tareas) que ocupa la ventana.
export function windowFrame(op) {
  return {
    left: { x: 0, y: 0, w: 0.5, h: 1 },
    right: { x: 0.5, y: 0, w: 0.5, h: 1 },
    top: { x: 0, y: 0, w: 1, h: 0.5 },
    bottom: { x: 0, y: 0.5, w: 1, h: 0.5 },
    center: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
    maximize: { x: 0, y: 0, w: 1, h: 1 },
  }[op] ?? null;
}
export const isWindowId = (id) => typeof id === 'string' && /^(front|\d{1,20}(:\d{1,4})?)$/.test(id);
// Pestaña de un navegador: t:<ventana o proceso>:<ventana del navegador>:<pestaña>.
export const isTabId = (id) => typeof id === 'string' && /^t:\d{1,20}:\d{1,12}:\d{1,4}$/.test(id);

const MODIFIERS = new Set(['mod', 'ctrl', 'shift', 'alt', 'cmd', 'win', 'meta', 'option']);
const PUNCTUATION = ['minus', 'equal', 'comma', 'period', 'slash', 'semicolon', 'quote',
  'bracketleft', 'bracketright', 'backslash', 'grave'];
const NAMED_KEYS = ['enter', 'tab', 'space', 'escape', 'backspace', 'delete', 'insert', 'home', 'end',
  'pageup', 'pagedown', 'up', 'down', 'left', 'right', 'printscreen', ...PUNCTUATION];
const KEY_ALIASES = { esc: 'escape', return: 'enter', del: 'delete', ins: 'insert', pgup: 'pageup',
  pgdn: 'pagedown', '-': 'minus', '=': 'equal', ',': 'comma', '.': 'period', '/': 'slash',
  ';': 'semicolon', "'": 'quote', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash',
  '`': 'grave', control: 'ctrl', command: 'cmd', super: 'win' };

export function isValidKey(k) {
  return /^[a-z0-9]$/.test(k) || /^f([1-9]|1[0-9]|2[0-4])$/.test(k) || NAMED_KEYS.includes(k);
}

// "Mod+Shift+S" -> { mods: ['mod', 'shift'], key: 's' }
export function parseKeys(combo) {
  if (typeof combo !== 'string' || combo.length === 0 || combo.length > 64) throw new ActionError('Atajo vacío o demasiado largo');
  const parts = combo.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
    .map((p) => KEY_ALIASES[p] ?? p);
  if (parts.length === 0) throw new ActionError('Atajo vacío');
  const key = parts.pop();
  if (MODIFIERS.has(key)) throw new ActionError('El atajo necesita una tecla además de los modificadores');
  if (!isValidKey(key)) throw new ActionError(`Tecla no soportada: ${key}`);
  const mods = [];
  for (const m of parts) {
    if (!MODIFIERS.has(m)) throw new ActionError(`Modificador no soportado: ${m}`);
    if (!mods.includes(m)) mods.push(m);
  }
  return { mods, key };
}

// Traduce modificadores portables a los del sistema: "mod" es Ctrl en Windows y Cmd en Mac.
export function resolveMods(mods, os) {
  const out = new Set();
  for (const m of mods) {
    if (m === 'mod') out.add(os === 'mac' ? 'cmd' : 'ctrl');
    else if (m === 'cmd' || m === 'win' || m === 'meta') out.add(os === 'mac' ? 'cmd' : 'win');
    else if (m === 'option') out.add('alt');
    else out.add(m);
  }
  return [...out];
}

export class ActionError extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function str(v, max, name) {
  if (typeof v !== 'string' || v.length === 0) throw new ActionError(`Falta ${name}`);
  if (v.length > max) throw new ActionError(`${name} es demasiado largo`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new ActionError(`${name} tiene caracteres de control`);
  return v;
}

// Destinos de "Abrir": URL web o de correo, nombre de app o ruta absoluta.
export function classifyOpenTarget(target) {
  str(target, LIMITS.target, 'el destino');
  if (target.startsWith('-')) throw new ActionError('Destino inválido');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    let url;
    try { url = new URL(target); } catch { throw new ActionError('URL inválida'); }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new ActionError('Solo se permiten URLs http, https y mailto');
    return { kind: 'url', value: url.href };
  }
  if (target.startsWith('/') || /^[a-z]:\\/i.test(target)) {
    if (target.split(/[\\/]/).includes('..')) throw new ActionError('La ruta no puede contener ..');
    return { kind: 'path', value: target };
  }
  if (/^[\p{L}\p{N} ._()&'-]{1,128}$/u.test(target)) return { kind: 'app', value: target };
  throw new ActionError('Destino inválido: usa una URL, una ruta absoluta o el nombre de una app');
}

export function validateAction(a, { inMulti = false } = {}) {
  if (!isObj(a)) throw new ActionError('Acción inválida');
  switch (a.type) {
    case 'hotkey': {
      const out = { type: 'hotkey', keys: str(a.keys, 64, 'el atajo') };
      parseKeys(out.keys);
      for (const os of ['mac', 'win']) {
        if (a[os] !== undefined && a[os] !== '') { out[os] = str(a[os], 64, `el atajo de ${os}`); parseKeys(out[os]); }
      }
      return out;
    }
    case 'text': {
      // raw: escribir tal cual, sin cambiar {fecha}, {hora} ni {portapapeles} (teclado de la tablet).
      const text = str(a.text, LIMITS.text, 'el texto');
      return a.raw === true ? { type: 'text', text, raw: true } : { type: 'text', text };
    }
    case 'open': {
      const target = str(a.target, LIMITS.target, 'el destino');
      classifyOpenTarget(target);
      // newTab: abrir siempre otra pestaña aunque el sitio ya esté abierto.
      return a.newTab === true ? { type: 'open', target, newTab: true } : { type: 'open', target };
    }
    case 'media': {
      // "setvolume" lo manda el deslizador de volumen; no se elige a mano en el editor.
      if (a.cmd === 'setvolume') {
        const value = Number(a.value);
        if (!Number.isInteger(value) || value < 0 || value > 100) throw new ActionError('Volumen inválido (0 a 100)');
        return { type: 'media', cmd: 'setvolume', value };
      }
      if (!MEDIA_CMDS.includes(a.cmd)) throw new ActionError('Comando multimedia inválido');
      return { type: 'media', cmd: a.cmd };
    }
    case 'power':
      if (!POWER_CMDS.includes(a.cmd)) throw new ActionError('Comando de energía inválido');
      return { type: 'power', cmd: a.cmd };
    case 'script':
      if (typeof a.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(a.name)) throw new ActionError('Nombre de script inválido: solo letras, números, - y _');
      return { type: 'script', name: a.name };
    case 'delay': {
      if (!inMulti) throw new ActionError('La pausa solo existe dentro de una secuencia');
      const ms = Number(a.ms);
      if (!Number.isInteger(ms) || ms < 0 || ms > LIMITS.delayMs) throw new ActionError('Pausa inválida (0 a 10000 ms)');
      return { type: 'delay', ms };
    }
    case 'multi': {
      if (inMulti) throw new ActionError('Una secuencia no puede contener otra secuencia');
      if (!Array.isArray(a.steps) || a.steps.length === 0) throw new ActionError('La secuencia está vacía');
      if (a.steps.length > LIMITS.multiSteps) throw new ActionError('La secuencia tiene demasiados pasos');
      return { type: 'multi', steps: a.steps.map((s) => validateAction(s, { inMulti: true })) };
    }
    case 'clipboard': {
      if (inMulti) throw new ActionError('Pasar el portapapeles no puede ir dentro de una secuencia');
      const from = a.from ?? 'focus';
      const to = a.to ?? 'others';
      if (from !== 'focus' && !ID_RE.test(from)) throw new ActionError('Origen inválido');
      if (to !== 'others' && to !== 'all' && !ID_RE.test(to)) throw new ActionError('Destino inválido');
      if (from === to) throw new ActionError('El origen y el destino son la misma computadora');
      return { type: 'clipboard', from, to, paste: a.paste === true };
    }
    case 'wake':
      if (inMulti) throw new ActionError('Encender no puede ir dentro de una secuencia');
      if (typeof a.agent !== 'string' || !ID_RE.test(a.agent)) throw new ActionError('Elige qué computadora encender');
      return { type: 'wake', agent: a.agent };
    case 'cycle': {
      // Tecla de varios estados: cada toque ejecuta el siguiente paso (por ejemplo, micrófono sí/no).
      if (inMulti) throw new ActionError('Una tecla de varios estados no puede ir dentro de una secuencia');
      if (!Array.isArray(a.steps) || a.steps.length < 2) throw new ActionError('Una tecla de varios estados necesita al menos 2 pasos');
      if (a.steps.length > CYCLE_MAX) throw new ActionError(`Máximo ${CYCLE_MAX} estados`);
      return {
        type: 'cycle',
        steps: a.steps.map((s, i) => {
          if (!isObj(s)) throw new ActionError(`Paso ${i + 1} inválido`);
          const action = validateAction(s.action);
          if (TABLET_ACTIONS.includes(action.type)) throw new ActionError(`El paso ${i + 1} no puede ser de ese tipo`);
          const label = typeof s.label === 'string' ? s.label.trim().slice(0, LIMITS.label) : '';
          return label ? { label, action } : { action };
        }),
      };
    }
    case 'stat':
      if (!STAT_METRICS.includes(a.metric)) throw new ActionError('Dato en vivo inválido');
      return { type: 'stat', metric: a.metric };
    case 'volume':
      return { type: 'volume' };
    case 'touchpad':
      // keyboard: abrir directo con el teclado de la tablet a la vista.
      return a.keyboard === true ? { type: 'touchpad', keyboard: true } : { type: 'touchpad' };
    case 'window':
      if (!WINDOW_OPS.includes(a.op)) throw new ActionError('Acción de ventana inválida');
      return { type: 'window', op: a.op };
    case 'windows':
      return { type: 'windows' };
    default:
      throw new ActionError('Tipo de acción desconocido');
  }
}

// Direcciones físicas (MAC) para encender a distancia.
export function isValidMac(mac) {
  return typeof mac === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac) && mac !== '00:00:00:00:00:00' && mac.toLowerCase() !== 'ff:ff:ff:ff:ff:ff';
}

// Tipos que una acción usa, contando los pasos de una secuencia.
export function actionTypes(a) {
  if (a.type === 'multi') return [...new Set(a.steps.map((s) => s.type))];
  if (a.type === 'cycle') return [...new Set(a.steps.flatMap((s) => actionTypes(s.action)))];
  return [a.type];
}

export function isDangerous(a) {
  return actionTypes(a).some((t) => t === 'power' || t === 'script');
}

const ID_RE = /^[a-z0-9_-]{1,40}$/i;
const IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function validateButton(b) {
  if (!isObj(b)) throw new ActionError('Botón inválido');
  if (!ID_RE.test(b.id ?? '')) throw new ActionError('Id de botón inválido');
  const out = { id: b.id, label: typeof b.label === 'string' ? b.label.slice(0, LIMITS.label) : '' };
  if (b.icon !== undefined && b.icon !== '') out.icon = String(b.icon).slice(0, 8);
  if (b.color !== undefined && b.color !== '') {
    if (!COLOR_RE.test(b.color)) throw new ActionError('Color inválido');
    out.color = b.color.toLowerCase();
  }
  if (b.image !== undefined && b.image !== '') {
    if (typeof b.image !== 'string' || b.image.length > LIMITS.imageBytes * 1.37 || !IMAGE_RE.test(b.image)) {
      throw new ActionError('Imagen inválida o mayor a 96 KB (png, jpeg, gif o webp)');
    }
    out.image = b.image;
  }
  const target = b.target ?? 'focus';
  if (target !== 'focus' && target !== 'all' && !ID_RE.test(target)) throw new ActionError('Destino de botón inválido');
  out.target = target;
  out.action = validateAction(b.action);
  return out;
}

export function validateDeck(deck) {
  if (!isObj(deck) || !Array.isArray(deck.pages)) throw new ActionError('Deck inválido');
  if (deck.pages.length === 0 || deck.pages.length > LIMITS.pages) throw new ActionError('Número de páginas inválido');
  const seen = new Set();
  const pages = deck.pages.map((p) => {
    if (!isObj(p) || !ID_RE.test(p.id ?? '') || seen.has(p.id)) throw new ActionError('Página inválida');
    seen.add(p.id);
    if (!Array.isArray(p.buttons) || p.buttons.length > LIMITS.buttonsPerPage) throw new ActionError('Demasiados botones en una página');
    const ids = new Set();
    const buttons = p.buttons.map((b) => {
      const vb = validateButton(b);
      if (ids.has(vb.id)) throw new ActionError('Hay botones repetidos');
      ids.add(vb.id);
      return vb;
    });
    const out = { id: p.id, name: str(p.name, LIMITS.label, 'el nombre de la página'), buttons };
    // Apps que abren esta página sola cuando están al frente.
    if (p.apps !== undefined) {
      if (!Array.isArray(p.apps) || p.apps.length > 10) throw new ActionError('Demasiadas apps en una página');
      const apps = [...new Set(p.apps.map((x) => str(String(x ?? '').trim(), 60, 'el nombre de la app')))];
      if (apps.length) out.apps = apps;
    }
    return out;
  });
  return { version: 1, pages };
}

// Sustituye {fecha}, {hora} y {portapapeles}. Las variables desconocidas se dejan tal cual.
export async function expandText(text, { now = new Date(), readClipboard } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const values = {
    fecha: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    hora: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  if (text.includes('{portapapeles}') && readClipboard) values.portapapeles = (await readClipboard()).slice(0, LIMITS.text);
  return text.replace(/\{(fecha|hora|portapapeles)\}/g, (m, k) => values[k] ?? m);
}

// Cómo se ve un atajo en cada sistema: ['⌘', '⇧', 'S'] en Mac, ['Ctrl', 'Shift', 'S'] en Windows.
const MAC_MOD_SYMBOLS = { cmd: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' };
const WIN_MOD_NAMES = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', win: 'Win' };
const KEY_LABELS = {
  enter: '↵', tab: '⇥', space: 'Espacio', escape: 'Esc', backspace: '⌫', delete: 'Supr', insert: 'Ins',
  home: 'Inicio', end: 'Fin', pageup: 'RePág', pagedown: 'AvPág', up: '↑', down: '↓', left: '←', right: '→',
  printscreen: 'ImpPt', minus: '-', equal: '=', comma: ',', period: '.', slash: '/', semicolon: ';',
  quote: "'", bracketleft: '[', bracketright: ']', backslash: '\\', grave: '`',
};
const MOD_ORDER = { mac: ['ctrl', 'alt', 'shift', 'cmd'], win: ['win', 'ctrl', 'alt', 'shift'] };

export function formatKeys(action, os = 'mac') {
  try {
    const { mods, key } = parseKeys(action[os] || action.keys);
    const resolved = resolveMods(mods, os).sort((a, b) => MOD_ORDER[os].indexOf(a) - MOD_ORDER[os].indexOf(b));
    const names = os === 'mac' ? MAC_MOD_SYMBOLS : WIN_MOD_NAMES;
    return [...resolved.map((m) => names[m] ?? m), KEY_LABELS[key] ?? key.toUpperCase()];
  } catch {
    return [];
  }
}

// Descripción corta de lo que hace una acción, para mostrar debajo del nombre del botón.
export function actionHint(a) {
  switch (a?.type) {
    case 'text': {
      const friendly = a.text.replace(/\{(fecha|hora|portapapeles)\}/g, (_, v) => ({ fecha: 'la fecha', hora: 'la hora', portapapeles: 'lo copiado' })[v]).replace(/\s+/g, ' ').trim();
      if (/^(la fecha|la hora|lo copiado)( y? ?(la fecha|la hora|lo copiado))*$/.test(friendly)) return `Escribe ${friendly}`;
      const raw = a.text.replace(/\s+/g, ' ').trim();
      return `Escribe “${raw.length > 22 ? `${raw.slice(0, 21)}…` : raw}”`;
    }
    case 'open': {
      try { const u = new URL(a.target); if (u.protocol.startsWith('http')) return `Abre ${u.hostname.replace(/^www\./, '')}`; } catch {}
      return `Abre ${a.target.split(/[\\/]/).pop()}`;
    }
    case 'media': return { playpause: 'Reproducir o pausar', next: 'Siguiente pista', prev: 'Pista anterior', volup: 'Sube el volumen', voldown: 'Baja el volumen', mute: 'Silencia' }[a.cmd];
    case 'power': return { lock: 'Bloquea la pantalla', sleep: 'Suspende', restart: 'Reinicia', shutdown: 'Apaga' }[a.cmd];
    case 'script': return `Script ${a.name}`;
    case 'multi': return `${a.steps.length} pasos`;
    case 'clipboard': return a.paste ? 'Copia y pega en otra' : 'Pasa lo copiado';
    case 'wake': return 'Enciende a distancia';
    case 'cycle': return `${a.steps.length} estados`;
    case 'stat': return { cpu: 'Uso de procesador', ram: 'Uso de memoria', battery: 'Batería', app: 'App al frente', clock: 'Hora', music: 'Música en reproducción' }[a.metric];
    case 'volume': return 'Desliza para ajustar';
    case 'touchpad': return a.keyboard ? 'Escribe en la computadora con el teclado de la tablet' : 'Toca para usar como mouse y teclado';
    case 'window': return `Ventana activa: ${WINDOW_OP_NAMES[a.op]?.toLowerCase()}`;
    case 'windows': return 'Lista de ventanas abiertas';
    default: return '';
  }
}

// Página que corresponde a la app que está al frente (comparación sin mayúsculas ni acentos).
export function pageForApp(deck, app) {
  if (!app || !deck?.pages) return null;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const a = norm(app);
  return deck.pages.find((p) => p.apps?.some((x) => { const n = norm(x); return n && (a === n || a.includes(n)); })) ?? null;
}

// --- Automatizaciones -----------------------------------------------------------------------
// Corren en la computadora sin tocar la tablet: "cuando <app> pase al frente" o "a las 09:00".
// No admiten acciones de energía ni scripts: algo así nunca debe pasar sin que nadie lo confirme.

export const AUTOMATION_MAX = 30;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateAutomations(list) {
  if (!Array.isArray(list)) throw new ActionError('Lista de automatizaciones inválida');
  if (list.length > AUTOMATION_MAX) throw new ActionError(`Máximo ${AUTOMATION_MAX} automatizaciones`);
  const ids = new Set();
  return list.map((a, i) => {
    const n = i + 1;
    if (!isObj(a) || !ID_RE.test(a.id ?? '') || ids.has(a.id)) throw new ActionError(`Automatización ${n} inválida`);
    ids.add(a.id);
    const name = str(String(a.name ?? '').trim() || `Automatización ${n}`, LIMITS.label, 'el nombre');
    const w = a.when;
    let when;
    if (isObj(w) && w.type === 'app') {
      when = { type: 'app', app: str(String(w.app ?? '').trim(), 60, 'la app') };
    } else if (isObj(w) && w.type === 'time') {
      if (!TIME_RE.test(w.at ?? '')) throw new ActionError(`Hora inválida en "${name}" (usa HH:MM)`);
      const days = Array.isArray(w.days) ? [...new Set(w.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort() : [];
      if (days.length === 0) throw new ActionError(`Elige al menos un día en "${name}"`);
      when = { type: 'time', at: w.at, days };
    } else {
      throw new ActionError(`Falta cuándo se ejecuta "${name}"`);
    }
    const action = validateAction(a.action);
    if (TABLET_ACTIONS.includes(action.type)) throw new ActionError(`"${name}": esa acción solo funciona desde la tablet`);
    if (isDangerous(action)) throw new ActionError(`"${name}": por seguridad, las automatizaciones no pueden apagar, suspender ni ejecutar scripts`);
    return { id: a.id, name, enabled: a.enabled !== false, when, action };
  });
}

// Busca, en la lista de ventanas, una pestaña o app web abierta con la página `url`, para
// mostrarla en vez de abrir otra. Una pestaña sirve si es del mismo dominio y está en esa página
// o dentro de ella (https://github.com/org sirve para https://github.com/org/repo, no al revés).
// Las pestañas de Windows no traen dirección, solo título: ahí solo se reconoce la página
// principal de un sitio por su nombre ("WhatsApp", "Gmail"), y nunca un nombre genérico.
const SITE_NAMES = { 'mail.google.com': 'gmail', 'calendar.google.com': 'google calendar', 'drive.google.com': 'google drive', 'web.whatsapp.com': 'whatsapp', 'music.youtube.com': 'youtube music', 'outlook.office.com': 'outlook', 'outlook.live.com': 'outlook', 'teams.microsoft.com': 'microsoft teams' };
const GENERIC_NAMES = new Set(['google', 'microsoft', 'apple', 'amazon', 'live', 'office', 'yahoo', 'bing', 'msn', 'gob', 'gov', 'com', 'net', 'org']);
export function findOpenSite(windows, url) {
  let host, page;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    host = u.host.toLowerCase().replace(/^www\./, '');
    page = decodeURI(u.pathname).replace(/\/+$/, '');
  } catch { return null; }
  if (!host) return null;
  const sameHost = (h) => String(h ?? '').toLowerCase().replace(/^www\./, '') === host;
  const inPage = (p) => {
    if (!page) return true;
    let have = String(p ?? '');
    try { have = decodeURI(have); } catch {}
    have = have.replace(/\/+$/, '');
    return have === page || have.startsWith(`${page}/`);
  };
  const parts = host.split(':')[0].split('.');
  const label = SITE_NAMES[host] ?? (parts.length >= 2 ? parts[parts.length - 2] : parts[0]);
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = (title) => !page && label.length >= 4 && !GENERIC_NAMES.has(label)
    && new RegExp(`(^|[^a-z0-9])${esc(label)}([^a-z0-9]|$)`).test(norm(title));
  const list = Array.isArray(windows) ? windows : [];
  // 1. App web instalada de ese sitio (son del sitio completo).
  for (const w of list) if (w.site && sameHost(w.site)) return { id: w.id, title: w.title };
  // 2. Pestaña con dirección: la activa primero, por si hay varias.
  const tabs = list.flatMap((w) => (w.tabs ?? []).map((t) => ({ ...t, front: w.active === true })));
  tabs.sort((a, b) => (b.active === true) - (a.active === true) || (b.front === true) - (a.front === true));
  for (const t of tabs) if (t.host && sameHost(t.host) && inPage(t.path)) return { id: t.id, title: t.title };
  // 3. Pestaña sin dirección (Windows): por nombre del sitio.
  for (const t of tabs) if (!t.host && named(t.title)) return { id: t.id, title: t.title };
  return null;
}
