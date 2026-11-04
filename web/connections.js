// Conexiones de la tablet con todas sus computadoras a la vez. La primera computadora es la que
// sirvió esta página ("casa"): guarda el deck. Las demás se agregan desde Ajustes.

import { createProtocol } from '/shared/protocol.js';
import { createAgentClient } from '/shared/client.js';
import { isDangerous } from '/shared/actions.js';

const proto = createProtocol(window.nacl);
const STORE = { device: 'cd.device', agents: 'cd.agents', name: 'cd.name', cycle: 'cd.cycle' };
const STOP_CODES = new Set(['identity-changed', 'pair-rejected', 'pair-expired', 'pair-busy', 'rate-limited', 'not-paired', 'pair-commit']);

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function loadDevice() {
  const stored = load(STORE.device, null);
  if (stored?.pub && stored?.sec) {
    try { return { pub: proto.fromB64(stored.pub, 32), sec: proto.fromB64(stored.sec, 32) }; } catch {}
  }
  const kp = proto.boxKeyPair();
  save(STORE.device, { pub: proto.toB64(kp.publicKey), sec: proto.toB64(kp.secretKey) });
  return { pub: kp.publicKey, sec: kp.secretKey };
}

export function createConnections({ onChange, onDeck, onToast, onNotifs = () => {}, onWindows = () => {} }) {
  const device = loadDevice();
  const homeUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let deviceName = load(STORE.name, null) ?? defaultName();
  let agents = load(STORE.agents, []).filter((a) => a && typeof a.url === 'string');
  if (!agents.some((a) => a.url === homeUrl)) agents.unshift({ key: 'home', url: homeUrl, name: location.hostname, home: true, agentPub: null });
  for (const a of agents) a.home = a.url === homeUrl;
  const live = new Map(); // key -> { client, status, sas, error, state, retry, timer }
  const cycleState = load(STORE.cycle, {});
  let wantsNow = { music: false };

  const persist = () => save(STORE.agents, agents.map(({ key, url, name, os, id, agentPub, macs }) => ({ key, url, name, os, id, agentPub, macs })));
  persist();

  function defaultName() {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
    if (/iPhone/.test(ua)) return 'iPhone';
    return 'Tablet';
  }

  function homeLive() { const h = agents.find((a) => a.home); return h ? live.get(h.key) : undefined; }

  function keyFor(a) { return a.key ?? (a.key = Math.random().toString(36).slice(2, 10)); }

  function connect(a) {
    const key = keyFor(a);
    const prev = live.get(key);
    if (prev?.client) prev.client.close();
    clearTimeout(prev?.timer);
    const entry = { client: null, status: 'connecting', sas: null, error: null, state: null, retry: prev?.retry ?? 0, timer: null };
    live.set(key, entry);
    entry.client = createAgentClient({
      proto, WebSocketImpl: WebSocket, url: a.url, device, deviceName,
      pinnedAgentPub: a.agentPub ? proto.fromB64(a.agentPub, 32) : null,
      onEvent: (e) => handleEvent(a, entry, e),
    });
    entry.client.connect();
    onChange();
  }

  function handleEvent(a, entry, e) {
    if (live.get(a.key) !== entry) return; // conexión vieja
    if (e.type === 'hello') {
      a.id = e.info.id; a.name = e.info.name; a.os = e.info.os; a.fingerprint = e.info.fingerprint;
      persist();
    } else if (e.type === 'paired') {
      a.agentPub = e.agentPub;
      persist();
      onToast(`Emparejada con ${a.name}`);
    } else if (e.type === 'status') {
      entry.status = e.status;
      if (e.status === 'sas') entry.sas = e.sas;
      if (e.status === 'ready') {
        entry.sas = null; entry.error = null; entry.retry = 0;
        // La misma computadora guardada dos veces (por ejemplo, la abriste antes con otra
        // dirección): se queda una sola conexión, la principal si alguna lo es.
        const twin = agents.find((x) => x !== a && x.id && x.id === a.id && live.get(x.key)?.status === 'ready');
        if (twin) {
          const drop = a.home ? twin : a;
          setTimeout(() => api.remove(drop.key), 0);
          if (drop === a) return;
        }
        if (Array.isArray(e.info?.macs) && e.info.macs.length) { a.macs = e.info.macs.slice(0, 4); persist(); }
        a.ai = e.info?.ai === true;
        if (wantsNow.music) entry.client.send({ k: 'state.want', ...wantsNow });
        if (a.home) refreshDeck();
        entry.notifs = e.info?.notifs === true;
        if (entry.notifs) entry.client.request({ k: 'notifs.get' }).then((r) => { if (r.ok) onNotifs(a.key, r.items, r.badges, true); }).catch(() => {});
      }
      if (e.status === 'error') entry.error = { code: e.code, message: e.message };
      if (e.status === 'closed' && !e.byUser) {
        const stop = entry.error && STOP_CODES.has(entry.error.code);
        // Un error sin cifrar podría venir de un atacante: la llave fijada solo se borra si la
        // persona toca "Volver a emparejar".
        if (!stop) {
          entry.retry = Math.min(entry.retry + 1, 6);
          const delay = entry.error?.code === 'pair-closed' ? 3000 : Math.min(15_000, 500 * 2 ** entry.retry);
          entry.timer = setTimeout(() => { if (live.get(a.key) === entry) connect(a); }, delay);
        }
      }
    } else if (e.type === 'message') {
      const p = e.payload;
      if (p.k === 'state') entry.state = { app: p.app, idleMs: p.idleMs, cpu: p.cpu, ram: p.ram, volume: p.volume, battery: p.battery, music: p.music, at: Date.now() };
      if (p.k === 'deck' && a.home) onDeck(p.deck);
      if (p.k === 'notifs' && Array.isArray(p.items)) onNotifs(a.key, p.items, null, false);
      if (p.k === 'badges' && Array.isArray(p.badges)) onNotifs(a.key, null, p.badges, false);
      if (p.k === 'windows') return void onWindows(a.key, p);
    }
    onChange();
  }

  async function refreshDeck() {
    const home = homeLive();
    try {
      const r = await home.client.request({ k: 'deck.get' });
      if (r.ok) onDeck(r.deck);
    } catch (err) { onToast(err.message, true); }
  }

  // La computadora donde estás trabajando: la que tuvo actividad de teclado o mouse más reciente.
  function focusAgent() {
    let best = null;
    for (const a of agents) {
      const l = live.get(a.key);
      if (l?.status !== 'ready') continue;
      const idle = l.state?.idleMs == null ? Number.POSITIVE_INFINITY : l.state.idleMs + (Date.now() - l.state.at);
      if (!best || idle < best.idle) best = { a, idle };
    }
    return best?.a ?? null;
  }

  function resolveTargets(target) {
    if (target === 'all') return agents.filter((a) => live.get(a.key)?.status === 'ready');
    if (target === 'focus') { const f = focusAgent(); return f ? [f] : []; }
    const a = agents.find((x) => x.id === target);
    return a && live.get(a.key)?.status === 'ready' ? [a] : [];
  }

  // Se conecta después de devolver el objeto, para que quien lo crea ya lo tenga al recibir eventos.
  queueMicrotask(() => { for (const a of agents) connect(a); });

  // Al volver a la app (por ejemplo después de bloquear la tablet), reconectar de inmediato.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const a of agents) {
      const l = live.get(a.key);
      if (l && (l.status === 'closed') && !(l.error && STOP_CODES.has(l.error.code))) { l.retry = 0; connect(a); }
    }
  });

  const api = {
    get deviceName() { return deviceName; },
    setDeviceName(n) { deviceName = String(n).trim().slice(0, 40) || defaultName(); save(STORE.name, deviceName); },
    get deviceFingerprint() { return proto.fingerprint(device.pub); },
    list: () => agents.map((a) => ({ ...a, live: live.get(a.key) ?? { status: 'closed' } })),
    focusAgent,
    reconnect(key) { const a = agents.find((x) => x.key === key); if (a) { const l = live.get(key); if (l) { l.retry = 0; l.error = null; } connect(a); } },
    repair(key) { const a = agents.find((x) => x.key === key); if (a) { a.agentPub = null; persist(); const l = live.get(key); if (l) l.error = null; connect(a); } },
    remove(key) {
      const a = agents.find((x) => x.key === key);
      if (!a || a.home) return;
      live.get(key)?.client.close();
      clearTimeout(live.get(key)?.timer);
      live.delete(key);
      agents = agents.filter((x) => x.key !== key);
      persist();
      onChange();
    },
    // Acepta "192.168.1.20", "192.168.1.20:4455", "mi-pc.tail123.ts.net" o una URL completa.
    // Si esta página se abrió por HTTPS (Tailscale), las demás computadoras también deben ir por wss.
    addressToUrl(input) {
      const v = String(input).trim();
      const secure = location.protocol === 'https:';
      if (/^wss?:\/\//i.test(v) || /^https?:\/\//i.test(v)) {
        const u = new URL(v.replace(/^http/i, 'ws'));
        return `${u.protocol}//${u.host}/ws`;
      }
      if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(v)) throw new Error('Escribe la dirección como 192.168.1.20 o mi-pc.tailnet.ts.net');
      if (secure || /\.ts\.net(:|$)/i.test(v)) return `wss://${v.includes(':') ? v : `${v}:4443`}/ws`;
      return `ws://${v.includes(':') ? v : `${v}:4455`}/ws`;
    },

    add(url) {
      if (agents.some((a) => a.url === url)) return onToast('Esa computadora ya está agregada', true);
      const a = { url, name: new URL(url.replace(/^ws/, 'http')).hostname, home: false, agentPub: null };
      keyFor(a);
      agents.push(a);
      persist();
      connect(a);
    },
    async discover() {
      const home = homeLive();
      if (home?.status !== 'ready') throw new Error('Primero conecta con esta computadora');
      const r = await home.client.request({ k: 'agents.list' });
      // Desde una página HTTPS el navegador bloquea conexiones ws:// sin cifrar.
      const secure = location.protocol === 'https:';
      return (r.agents ?? []).filter((p) => !agents.some((a) => (p.id && a.id === p.id) || a.url === p.url) && (!secure || p.url.startsWith('wss://')));
    },
    async saveDeck(deck) {
      const home = homeLive();
      if (home?.status !== 'ready') throw new Error('No hay conexión con la computadora principal');
      const r = await home.client.request({ k: 'deck.save', deck });
      if (!r.ok) throw new Error(r.error);
      onDeck(r.deck);
    },

    // Despierta una computadora dormida pidiéndoselo a otra que esté conectada.
    async wake(agentId) {
      const target = agents.find((a) => a.id === agentId || a.key === agentId);
      if (!target) throw new Error('Esa computadora ya no está en la lista');
      if (!target.macs?.length) throw new Error(`Conecta ${target.name} al menos una vez para poder encenderla después`);
      const helpers = agents.filter((a) => a !== target && live.get(a.key)?.status === 'ready').sort((a, b) => Number(b.home) - Number(a.home));
      if (helpers.length === 0) throw new Error('Necesito otra computadora encendida en la misma red para mandar la señal');
      const r = await live.get(helpers[0].key).client.request({ k: 'wake', macs: target.macs });
      if (!r.ok) throw new Error(r.error);
      return [{ agent: target, ok: true }];
    },

    // Pasa lo copiado de una computadora a otra(s) y, si se pide, lo pega.
    async transferClipboard(action) {
      const ready = agents.filter((a) => live.get(a.key)?.status === 'ready');
      const source = action.from === 'focus' ? focusAgent() : ready.find((a) => a.id === action.from);
      if (!source) throw new Error('La computadora de origen no está conectada');
      const targets = action.to === 'others' || action.to === 'all' ? ready.filter((a) => a !== source) : ready.filter((a) => a.id === action.to && a !== source);
      if (targets.length === 0) throw new Error('Conecta otra computadora para recibir lo copiado');
      const got = await live.get(source.key).client.request({ k: 'clipboard.get' });
      if (!got.ok) throw new Error(`${source.name}: ${got.error}`);
      return Promise.all(targets.map(async (a) => {
        try { return { agent: a, ...(await live.get(a.key).client.request({ k: 'clipboard.set', text: got.text, paste: action.paste })) }; } catch (err) { return { agent: a, ok: false, error: err.message }; }
      }));
    },

    // Ejecuta un botón en su destino. Devuelve el resultado por computadora.
    // Teclas de varios estados: el paso que toca se recuerda en esta tablet.
    cycleIndex(button) {
      const n = button.action?.steps?.length ?? 0;
      const i = cycleState[button.id] ?? 0;
      return n ? i % n : 0;
    },

    // Volumen exacto en la(s) computadora(s) de destino.
    async setVolume(button, value) {
      const targets = resolveTargets(button.target);
      if (targets.length === 0) throw new Error('No hay ninguna computadora conectada');
      return Promise.all(targets.map(async (a) => ({ agent: a, ...(await live.get(a.key).client.request({ k: 'action.run', action: { type: 'media', cmd: 'setvolume', value } })) })));
    },

    // Movimiento del touchpad: se manda sin esperar respuesta, a la primera computadora de destino.
    pointer(button, ev) {
      const a = resolveTargets(button.target)[0];
      const l = a && live.get(a.key);
      if (!l?.client.ready) return false;
      l.client.send({ k: 'pointer', ...ev });
      return true;
    },

    // Le dice a cada computadora qué datos opcionales necesita esta tablet (por ahora, la música).
    setWants(wants) {
      wantsNow = wants;
      for (const a of agents) { const l = live.get(a.key); if (l?.status === 'ready') l.client.send({ k: 'state.want', ...wants }); }
    },

    // Petición a una computadora concreta (por ejemplo, sus automatizaciones).
    // Mensaje sin respuesta (por ejemplo, empezar o dejar de seguir las ventanas en vivo).
    sendTo(key, payload) {
      const l = live.get(key);
      if (l?.status === 'ready') { try { l.client.send(payload); } catch {} }
    },

    async requestTo(key, payload) {
      const l = live.get(key);
      if (l?.status !== 'ready') throw new Error('Esa computadora no está conectada');
      const r = await l.client.request(payload);
      if (!r.ok) throw new Error(r.error);
      return r;
    },

    // Computadora con el asistente de IA configurado (de preferencia la principal).
    aiAgent() {
      return agents.filter((a) => a.ai && live.get(a.key)?.status === 'ready').sort((x, y) => Number(y.home) - Number(x.home))[0] ?? null;
    },

    async suggest(prompt) {
      const a = this.aiAgent();
      if (!a) throw new Error('Ninguna computadora conectada tiene el asistente de IA configurado');
      const os = focusAgent()?.os ?? a.os;
      const r = await live.get(a.key).client.request({ k: 'ai.suggest', prompt, os }, { timeoutMs: 150_000 });
      if (!r.ok) throw new Error(r.error);
      return r.button;
    },

    stateFor(target) {
      const a = resolveTargets(target)[0];
      return a ? { agent: a, state: live.get(a.key)?.state ?? null } : null;
    },

    async run(button, { confirm }) {
      const type = button.action?.type;
      if (type === 'clipboard') return this.transferClipboard(button.action);
      if (type === 'wake') return this.wake(button.action.agent);
      if (type === 'stat' || type === 'volume' || type === 'touchpad' || type === 'windows') return [];
      if (type === 'cycle') {
        const i = this.cycleIndex(button);
        const results = await this.run({ ...button, action: button.action.steps[i].action }, { confirm });
        if (results.length && results.every((r) => r.ok)) {
          cycleState[button.id] = (i + 1) % button.action.steps.length;
          save(STORE.cycle, cycleState);
        }
        return results;
      }
      const targets = resolveTargets(button.target);
      if (targets.length === 0) throw new Error(button.target === 'focus' || button.target === 'all' ? 'No hay ninguna computadora conectada' : 'La computadora de este botón no está conectada');
      let confirmed = false;
      if (isDangerous(button.action)) {
        confirmed = await confirm(`¿Ejecutar "${button.label || 'esta acción'}" en ${targets.map((t) => t.name).join(', ')}?`);
        if (!confirmed) return [];
      }
      return Promise.all(targets.map(async (a) => {
        try {
          let r = await live.get(a.key).client.request({ k: 'action.run', action: button.action, confirmed });
          if (!r.ok && r.needsConfirm && !confirmed) {
            if (await confirm(`${a.name} pide confirmar "${button.label || 'esta acción'}". ¿Continuar?`)) {
              r = await live.get(a.key).client.request({ k: 'action.run', action: button.action, confirmed: true });
            } else return { agent: a, ok: false, error: 'Cancelado' };
          }
          return { agent: a, ...r };
        } catch (err) {
          return { agent: a, ok: false, error: err.message };
        }
      }));
    },
  };
  return api;
}
