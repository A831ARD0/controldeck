// Observa qué app está al frente y cuánto lleva la persona sin tocar teclado o mouse. La tablet
// usa el tiempo de inactividad para saber en qué computadora estás trabajando ("sigue el foco").
// Solo consulta mientras hay alguna tablet conectada.

import os from 'node:os';

const ACTIVE_MS = 3000;
const HEARTBEAT_MS = 5_000;

// Uso de procesador entre dos lecturas de os.cpus(), en %.
export function cpuPercent(prev, next) {
  let idle = 0, total = 0;
  next.forEach((c, i) => {
    const p = prev[i];
    if (!p) return;
    const t = (o) => Object.values(o.times).reduce((a, b) => a + b, 0);
    total += t(c) - t(p);
    idle += c.times.idle - p.times.idle;
  });
  return total > 0 ? Math.round(100 * (1 - idle / total)) : null;
}

export function createActivityMonitor({ driver, hub, intervalMs = 1500, onApp = () => {} }) {
  let current = null;
  let polls = 0;
  let lastCpus = os.cpus();
  let volume = null;
  let battery = null;
  let ram = null;
  let music = null;
  const wantMusic = new Set();
  let lastSent = 0;
  let wantClients = false;
  let wantAutomations = false;
  let closed = false;
  let timer = null;
  let busy = false;

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const [app, idleMs] = await Promise.all([
        driver.frontmostApp().catch(() => ''),
        driver.idleMs().catch(() => null),
      ]);
      onApp(app);
      polls += 1;
      const cpus = os.cpus();
      const cpu = cpuPercent(lastCpus, cpus);
      lastCpus = cpus;
      const prevVolume = volume;
      if (polls % 3 === 1 && driver.volume) volume = await driver.volume().catch(() => null);
      if (polls % 20 === 1 && driver.battery) battery = await driver.battery().catch(() => null);
      if (polls % 3 === 1) ram = (driver.memory ? await driver.memory().catch(() => null) : null) ?? Math.round(100 * (1 - os.freemem() / os.totalmem()));
      const prevMusic = music;
      if (wantMusic.size && polls % 2 === 1 && driver.nowPlaying) music = await driver.nowPlaying().catch(() => null);
      if (!wantMusic.size) music = null;
      const next = { app, idleMs, at: Date.now(), cpu, ram, volume, battery, music };
      // Se avisa solo cuando cambia la app, cuando la persona empieza o deja de usar esta
      // computadora, o cada 10 s. La tablet estima el resto sumando el tiempo transcurrido.
      const active = (s) => s && s.idleMs !== null && s.idleMs < ACTIVE_MS;
      const changed = !current || current.app !== next.app || active(current) !== active(next) || prevVolume !== volume || prevMusic !== music
        || next.at - lastSent >= HEARTBEAT_MS;
      current = next;
      if (changed) { lastSent = next.at; hub.broadcast({ k: 'state', ...next }); }
    } finally {
      busy = false;
    }
  }

  return {
    current: () => current,
    // Se consulta si hay tablets conectadas o si alguna automatización depende de la app al frente.
    update(hasClients = wantClients) {
      wantClients = hasClients;
      // Una vez cerrado no vuelve a arrancar (al cerrar el agente, las tablets se desconectan después).
      const want = !closed && (wantClients || wantAutomations);
      if (want && !timer) { driver.warmup?.(); timer = setInterval(poll, intervalMs); poll(); }
      if (!want && timer) { clearInterval(timer); timer = null; }
    },
    needForAutomations(v) { wantAutomations = v; this.update(); },
    // Solo se consulta la música si alguna tablet tiene una tecla que la muestra.
    want(who, { music: m }) { if (m) wantMusic.add(who); else wantMusic.delete(who); },
    close() { closed = true; if (timer) clearInterval(timer); timer = null; },
  };
}

export function createHub({ onSizeChange = () => {} } = {}) {
  const sessions = new Set();
  return {
    add(s) { sessions.add(s); onSizeChange(sessions.size); },
    remove(s) { if (sessions.delete(s)) onSizeChange(sessions.size); },
    broadcast(payload, except) { for (const s of sessions) if (s !== except) s.send(payload); },
    kickDevice(deviceId) { for (const s of sessions) if (s.deviceId === deviceId) s.kick(); },
    get size() { return sessions.size; },
    // Conexiones abiertas por tablet: una tablet puede tener ControlDeck abierto en varios lugares.
    perDevice() { const m = {}; for (const s of sessions) if (s.deviceId) m[s.deviceId] = (m[s.deviceId] ?? 0) + 1; return m; },
  };
}
