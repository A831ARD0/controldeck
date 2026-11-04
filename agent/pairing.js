// Solicitudes de emparejamiento esperando aprobación en la computadora.

import crypto from 'node:crypto';

const MAX_PENDING = 3;
const EXPIRE_MS = 120_000;
const ATTEMPT_WINDOW_MS = 10 * 60_000;

export function createPairingManager({ onChange = () => {}, attemptsPerIp = 6 } = {}) {
  const pending = new Map();
  const attempts = new Map();

  function sweep() {
    const now = Date.now();
    for (const [id, p] of pending) {
      if (now - p.createdAt > EXPIRE_MS) { pending.delete(id); p.decide(false, 'expired'); }
    }
    for (const [ip, list] of attempts) {
      const recent = list.filter((t) => now - t < ATTEMPT_WINDOW_MS);
      if (recent.length) attempts.set(ip, recent); else attempts.delete(ip);
    }
  }
  const timer = setInterval(() => { const n = pending.size; sweep(); if (pending.size !== n) onChange(); }, 5_000);
  timer.unref?.();

  return {
    // Limita intentos por IP antes de gastar trabajo en un emparejamiento.
    allowAttempt(ip) {
      sweep();
      const list = attempts.get(ip) ?? [];
      if (list.length >= attemptsPerIp) return false;
      list.push(Date.now());
      attempts.set(ip, list);
      return true;
    },

    add({ deviceName, devicePub, sas, ip, onDecision }) {
      sweep();
      if (pending.size >= MAX_PENDING) return null;
      const id = crypto.randomBytes(6).toString('hex');
      let done = false;
      const entry = {
        id, deviceName, devicePub, sas, ip, createdAt: Date.now(),
        decide(ok, reason) { if (!done) { done = true; onDecision(ok, reason); } },
      };
      pending.set(id, entry);
      onChange();
      return id;
    },

    cancel(id) {
      if (pending.delete(id)) onChange();
    },

    list() {
      sweep();
      return [...pending.values()].map(({ id, deviceName, sas, ip }) => ({ id, deviceName, sas, ip }));
    },

    decide(id, ok) {
      const p = pending.get(id);
      if (!p) return false;
      pending.delete(id);
      p.decide(ok, ok ? 'approved' : 'rejected');
      onChange();
      return true;
    },

    close() { clearInterval(timer); for (const p of pending.values()) p.decide(false, 'closed'); pending.clear(); },
  };
}
