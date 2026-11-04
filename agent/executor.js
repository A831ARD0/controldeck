// Ejecuta acciones validadas: revisa la política de la computadora, pide confirmación cuando
// corresponde, limita la frecuencia por dispositivo, ejecuta en orden y deja registro.

import fs from 'node:fs';
import path from 'node:path';
import { validateAction, actionTypes, parseKeys, resolveMods, classifyOpenTarget, expandText, ActionError, TABLET_ACTIONS, isValidMac, WINDOW_OPS, WINDOW_OP_NAMES, windowFrame, isWindowId, isTabId, findOpenSite } from '../shared/actions.js';
import { sendWol as defaultSendWol } from './wol.js';

const TYPE_NAMES = { hotkey: 'atajos', text: 'texto', open: 'abrir', media: 'multimedia', power: 'energía', script: 'scripts', clipboard: 'portapapeles', wake: 'encender otras computadoras', mouse: 'mouse', window: 'ventanas' };
const CLIPBOARD_MAX = 1024 * 1024;
const SCRIPT_EXT = { mac: ['.sh', '.command', '.applescript', '.scpt'], win: ['.ps1', '.bat', '.cmd'] };

export function describeAction(a) {
  switch (a.type) {
    case 'hotkey': return `Atajo ${a.keys}`;
    case 'text': return `Escribir texto (${a.text.length} caracteres)`;
    case 'open': return `Abrir ${a.target.slice(0, 60)}`;
    case 'media': return a.cmd === 'setvolume' ? `Volumen al ${a.value} %` : `Multimedia: ${a.cmd}`;
    case 'power': return `Energía: ${a.cmd}`;
    case 'script': return `Script ${a.name}`;
    case 'multi': return `Secuencia de ${a.steps.length} pasos`;
    case 'delay': return `Pausa ${a.ms} ms`;
    case 'clipboard': return 'Pasar lo copiado';
    case 'wake': return 'Encender computadora';
    case 'window': return `Ventana activa: ${WINDOW_OP_NAMES[a.op]?.toLowerCase()}`;
    default: return a.type;
  }
}

// Busca el script por nombre dentro de la carpeta de scripts, sin seguir enlaces que salgan de ella.
export function resolveScript(scriptsDir, name, os) {
  const realDir = fs.realpathSync(scriptsDir);
  for (const ext of SCRIPT_EXT[os] ?? []) {
    const candidate = path.join(realDir, name + ext);
    let real;
    try { real = fs.realpathSync(candidate); } catch { continue; }
    if (!real.startsWith(realDir + path.sep)) throw new ActionError('El script apunta fuera de la carpeta de scripts');
    if (!fs.statSync(real).isFile()) continue;
    return real;
  }
  throw new ActionError(`No existe el script "${name}" en la carpeta de scripts de esta computadora`);
}

function createRateLimiter({ perSecond = 20, burst = 40 } = {}) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

export function createExecutor({ driver, store, logSize = 200, sendWol = defaultSendWol }) {
  const log = [];
  const allow = createRateLimiter();
  // El touchpad manda muchos movimientos por segundo; tiene su propio límite.
  const allowPointer = createRateLimiter({ perSecond: 150, burst: 300 });
  let queue = Promise.resolve();

  function record(entry) {
    log.push(entry);
    if (log.length > logSize) log.shift();
  }

  async function runOne(a) {
    switch (a.type) {
      case 'hotkey': {
        const combo = parseKeys(a[driver.os] || a.keys);
        return driver.hotkey({ mods: resolveMods(combo.mods, driver.os), key: combo.key });
      }
      case 'text':
        return driver.text(a.raw ? a.text : await expandText(a.text, { readClipboard: () => driver.readClipboard() }));
      case 'open': {
        const target = classifyOpenTarget(a.target);
        // Un sitio que ya está abierto se trae al frente en vez de abrir otra pestaña.
        if (target.kind === 'url' && /^https?:/.test(target.value) && !a.newTab && driver.listWindows && driver.windowDo && store.getPolicy().allow.window) {
          // La lista sin recortar: trae la ruta de cada pestaña, que no se le manda a la tablet.
          const hit = await Promise.race([
            driver.listWindows().then((ws) => findOpenSite(ws, target.value)),
            new Promise((r) => setTimeout(r, 3000, null)),
          ]).catch(() => null);
          if (hit) {
            try { return await driver.windowDo({ id: hit.id, op: 'focus', title: hit.title }); } catch {}
          }
        }
        return driver.open(target);
      }
      case 'media':
        return driver.media(a.cmd, a.value);
      case 'power':
        return driver.power(a.cmd);
      case 'script':
        return driver.runScript(resolveScript(store.scriptsDir, a.name, driver.os));
      case 'delay':
        return new Promise((r) => setTimeout(r, a.ms));
      case 'window':
        if (!driver.windowDo) throw new ActionError('Esta computadora no puede acomodar ventanas');
        return driver.windowDo({ id: 'front', op: a.op, frame: windowFrame(a.op) });
      case 'multi':
        for (const step of a.steps) await runOne(step);
        return undefined;
      default:
        throw new ActionError('Tipo de acción desconocido');
    }
  }

  function requireAllowed(type) {
    if (!store.getPolicy().allow[type]) throw new ActionError(`Esta computadora no permite acciones de ${TYPE_NAMES[type]}. Actívalas en la configuración del agente.`);
  }

  // Envuelve una operación fuera de las acciones normales con política, límite y registro.
  async function guarded(device, summary, type, fn, { quiet = false } = {}) {
    const entry = { ts: new Date().toISOString(), device: device?.name ?? '?', summary, ok: false };
    try {
      if (!allow(device?.id ?? 'local')) throw new ActionError('Demasiadas acciones seguidas; espera un momento');
      requireAllowed(type);
      const result = await fn();
      entry.ok = true;
      if (!quiet) record(entry);
      return { ok: true, ...result };
    } catch (err) {
      entry.error = err instanceof ActionError ? err.message : String(err.message ?? err).slice(0, 300);
      record(entry);
      return { ok: false, error: entry.error };
    }
  }

  // Lista de ventanas ya revisada (ids válidos, textos recortados). Sin límite de acciones ni
  // registro: la usa también la lista en vivo, que relee cada segundo.
  async function windowsSnapshot() {
    requireAllowed('window');
    if (!driver.listWindows) throw new ActionError('Esta computadora no puede listar ventanas');
    const raw = await driver.listWindows();
    const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
    let tabBudget = 400;
    const windows = (Array.isArray(raw) ? raw : []).filter((w) => isWindowId(String(w?.id))).slice(0, 80).map((w) => {
      const out = { id: String(w.id), app: clip(w.app, 60).replace(/\.(exe|root)$/i, '').trim(), title: clip(w.title, 160), active: w.active === true, minimized: w.minimized === true };
      if (w.site) out.site = clip(w.site, 80);
      if (Array.isArray(w.tabs)) {
        const tabs = w.tabs.filter((t) => isTabId(String(t?.id))).slice(0, Math.min(60, tabBudget)).map((t) => ({ id: String(t.id), title: clip(t.title, 160), host: clip(t.host, 60), active: t.active === true }));
        tabBudget -= tabs.length;
        if (tabs.length) out.tabs = tabs;
      }
      return out;
    });
    return windows;
  }

  return {
    getLog: () => log.slice().reverse(),

    clipboardGet: (device) => guarded(device, 'Enviar lo copiado a otra computadora', 'clipboard', async () => {
      const text = String(await driver.readClipboard() ?? '');
      if (text.length > CLIPBOARD_MAX) throw new ActionError('Lo copiado es demasiado grande (máximo 1 MB de texto)');
      return { text };
    }),

    clipboardSet: (device, text, paste) => guarded(device, paste ? 'Recibir y pegar lo copiado' : 'Recibir lo copiado', 'clipboard', async () => {
      if (typeof text !== 'string' || text.length > CLIPBOARD_MAX) throw new ActionError('Texto inválido o mayor a 1 MB');
      if (paste) requireAllowed('hotkey');
      const job = queue.then(async () => {
        await driver.writeClipboard(text);
        if (paste) {
          await new Promise((r) => setTimeout(r, 80));
          await driver.hotkey({ mods: resolveMods(['mod'], driver.os), key: 'v' });
        }
      });
      queue = job.catch(() => {});
      await job;
      return {};
    }),

    // Movimiento del touchpad: sin registro (serían cientos de líneas) y sin esperar respuesta.
    pointer(device, ev) {
      if (!store.getPolicy().allow.mouse || !allowPointer(device?.id ?? 'local') || !driver.pointer) return false;
      const n = (v) => Math.max(-2000, Math.min(2000, Math.round(Number(v) || 0)));
      if (!['move', 'click', 'down', 'up', 'scroll'].includes(ev?.op)) return false;
      driver.pointer({ op: ev.op, dx: n(ev.dx), dy: n(ev.dy), button: ev.button === 'right' ? 'right' : 'left' });
      return true;
    },

    // Lista de ventanas abiertas (sin registro: la tablet la pide cada vez que abre el panel).
    windowsList: (device) => guarded(device, 'Ver ventanas', 'window', async () => ({ windows: await windowsSnapshot() }), { quiet: true }),
    windowsSnapshot,

    windowDo: (device, id, op, title) => guarded(device, `Ventana: ${WINDOW_OP_NAMES[op]?.toLowerCase() ?? op}`, 'window', async () => {
      if (op !== 'focus' && !WINDOW_OPS.includes(op)) throw new ActionError('Acción de ventana inválida');
      if (!isWindowId(id) && !(op === 'focus' && isTabId(id))) throw new ActionError('Ventana inválida');
      if (!driver.windowDo) throw new ActionError('Esta computadora no puede acomodar ventanas');
      const job = queue.then(() => driver.windowDo({ id, op, frame: windowFrame(op), title: typeof title === 'string' ? title.slice(0, 160) : '' }));
      queue = job.catch(() => {});
      await job;
      return {};
    }),

    wake: (device, macs) => guarded(device, 'Encender otra computadora', 'wake', async () => {
      if (!Array.isArray(macs) || !macs.some(isValidMac)) throw new ActionError('No conozco la dirección física de esa computadora; conéctala una vez para guardarla');
      await sendWol(macs.filter(isValidMac));
      return {};
    }),

    async run({ action, confirmed = false, device }) {
      const entry = { ts: new Date().toISOString(), device: device?.name ?? '?', summary: '?', ok: false };
      try {
        const a = validateAction(action);
        entry.summary = describeAction(a);
        if (TABLET_ACTIONS.includes(a.type)) throw new ActionError('Esta acción la coordina la tablet, no una sola computadora');
        if (!allow(device?.id ?? 'local')) throw new ActionError('Demasiadas acciones seguidas; espera un momento');
        const policy = store.getPolicy();
        for (const t of actionTypes(a)) {
          if (t === 'delay') continue;
          if (!policy.allow[t]) throw new ActionError(`Esta computadora no permite acciones de ${TYPE_NAMES[t] ?? t}. Actívalas en la configuración del agente.`);
          if (policy.confirm[t] && !confirmed) throw new ActionError('Esta acción necesita confirmación');
        }
        const job = queue.then(() => runOne(a));
        queue = job.catch(() => {});
        await job;
        entry.ok = true;
        record(entry);
        return { ok: true };
      } catch (err) {
        entry.error = err instanceof ActionError ? err.message : String(err.message ?? err).slice(0, 300);
        record(entry);
        return { ok: false, error: entry.error, needsConfirm: entry.error === 'Esta acción necesita confirmación' };
      }
    },
  };
}
