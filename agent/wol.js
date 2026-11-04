// Encender a distancia (Wake-on-LAN): "paquete mágico" por difusión UDP en la red local.
// La computadora dormida debe tener Wake-on-LAN activado (BIOS/UEFI en PC, "Activar con acceso
// a la red" en Mac) y estar conectada a la corriente, normalmente por cable.

import dgram from 'node:dgram';
import os from 'node:os';
import { isValidMac } from '../shared/actions.js';

export function buildMagicPacket(mac) {
  if (!isValidMac(mac)) throw new Error('Dirección MAC inválida');
  const bytes = Buffer.from(mac.split(':').map((x) => parseInt(x, 16)));
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(bytes)]);
}

// Direcciones de difusión de cada red local de esta computadora, más la general.
export function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  return [...out];
}

// Direcciones MAC de esta computadora, para que la tablet pueda encenderla después.
export function localMacs(interfaces = os.networkInterfaces()) {
  const out = new Set();
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isValidMac(a.mac)) out.add(a.mac.toLowerCase());
  }
  return [...out].slice(0, 4);
}

export async function sendWol(macs, { createSocket = () => dgram.createSocket('udp4'), addresses = broadcastAddresses(), ports = [9, 7] } = {}) {
  const valid = macs.filter(isValidMac).slice(0, 4);
  if (valid.length === 0) throw new Error('No hay una dirección MAC válida para encender esa computadora');
  const socket = createSocket();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, () => { socket.off('error', reject); resolve(); }); });
  try {
    socket.setBroadcast(true);
    const sends = [];
    for (const mac of valid) {
      const packet = buildMagicPacket(mac);
      for (const addr of addresses) for (const port of ports) {
        sends.push(new Promise((resolve) => socket.send(packet, port, addr, () => resolve())));
      }
    }
    await Promise.all(sends);
    return valid.length;
  } finally {
    socket.close();
  }
}
