import os from 'node:os';

// Direcciones IPv4 de esta computadora en la red local (sin la interna 127.0.0.1).
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    // Se omiten las direcciones 169.254.x.x: el sistema las asigna sola cuando no hay red real.
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}
