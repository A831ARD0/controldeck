// Descubrimiento en la red local por difusión UDP. Cada agente anuncia su nombre, sistema, puerto
// y llave pública cada 5 segundos. Esta información no es secreta ni se usa para confiar: la
// confianza solo se establece con el emparejamiento aprobado en la computadora.

import dgram from 'node:dgram';

export const DISCOVERY_PORT = 47811;
const ANNOUNCE_MS = 5_000;
const EXPIRE_MS = 20_000;
const MAX_PEERS = 64;

export function createDiscovery({ self, port = DISCOVERY_PORT, enabled = true }) {
  const peers = new Map();
  let socket = null;
  let timer = null;

  function announce() {
    const msg = Buffer.from(JSON.stringify({ cd: 1, ...self() }));
    socket?.send(msg, port, '255.255.255.255', () => {});
  }

  function onMessage(buf, rinfo) {
    if (buf.length > 1024) return;
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    const me = self();
    if (!m || m.cd !== 1 || m.id === me.id) return;
    if (typeof m.id !== 'string' || !/^[0-9a-f]{16}$/.test(m.id)) return;
    if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) return;
    if (typeof m.pub !== 'string' || m.pub.length !== 44) return;
    if (!peers.has(m.id) && peers.size >= MAX_PEERS) return;
    peers.set(m.id, {
      id: m.id,
      name: String(m.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) || 'Computadora',
      os: m.os === 'win' ? 'win' : m.os === 'mac' ? 'mac' : 'otro',
      url: `ws://${rinfo.address}:${m.port}/ws`,
      pub: m.pub,
      lastSeen: Date.now(),
    });
  }

  if (enabled) {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', onMessage);
    socket.on('error', (err) => { console.error(`[controldeck] descubrimiento desactivado: ${err.message}`); socket?.close(); socket = null; });
    socket.bind(port, () => {
      try { socket.setBroadcast(true); } catch {}
      announce();
      timer = setInterval(announce, ANNOUNCE_MS);
      timer.unref?.();
    });
  }

  return {
    list() {
      const now = Date.now();
      for (const [id, p] of peers) if (now - p.lastSeen > EXPIRE_MS) peers.delete(id);
      return [...peers.values()].map(({ lastSeen, ...p }) => p);
    },
    close() { clearInterval(timer); try { socket?.close(); } catch {} socket = null; },
    _onMessage: onMessage,
  };
}
