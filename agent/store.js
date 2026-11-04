// Estado persistente del agente: identidad, dispositivos emparejados, deck y política.
// Archivos JSON con permisos 0600 en una carpeta 0700, escritos de forma atómica.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { validateDeck, validateAutomations } from '../shared/actions.js';
import { defaultDeck } from './default-deck.js';

export const DEFAULT_POLICY = {
  allow: { hotkey: true, text: true, open: true, media: true, power: true, script: false, clipboard: true, wake: true, mouse: true, automations: true, window: true, notifications: true },
  // Tipos que la tablet debe confirmar explícitamente antes de ejecutarse.
  confirm: { power: true, script: true },
};

export function defaultHome() {
  if (process.env.CONTROLDECK_HOME) return process.env.CONTROLDECK_HOME;
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), 'ControlDeck');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'ControlDeck');
  return path.join(os.homedir(), '.config', 'controldeck');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // Un archivo dañado no debe tumbar el agente, pero tampoco se pisa: se guarda una copia.
    const backup = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, backup); } catch {}
    console.error(`[controldeck] ${path.basename(file)} estaba dañado; se movió a ${backup}`);
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

export function openStore({ home = defaultHome(), proto }) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(home, 0o700); } catch {}
  const scriptsDir = path.join(home, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true, mode: 0o700 });
  const file = (name) => path.join(home, name);

  let identity = readJson(file('identity.json'), null);
  if (!identity || typeof identity.secretKey !== 'string') {
    const kp = proto.boxKeyPair();
    identity = {
      id: crypto.randomBytes(8).toString('hex'),
      name: os.hostname().replace(/\.local$/, '').slice(0, 40) || 'Computadora',
      publicKey: proto.toB64(kp.publicKey),
      secretKey: proto.toB64(kp.secretKey),
      createdAt: new Date().toISOString(),
    };
    writeJson(file('identity.json'), identity);
  }

  let devices = readJson(file('devices.json'), []);
  if (!Array.isArray(devices)) devices = [];

  let automations;
  try { automations = validateAutomations(readJson(file('automations.json'), [])); } catch { automations = []; }

  // Asistente de IA: servidor Ollama (en esta computadora o en otra de la red/tailnet) y modelo.
  // Configuración guiada: si ya se terminó (o se saltó) una vez, el panel ya no la muestra sola.
  let setup = readJson(file('setup.json'), {});
  if (typeof setup !== 'object' || setup === null) setup = {};
  let ai = readJson(file('ai.json'), {});
  if (typeof ai.url !== 'string' || typeof ai.model !== 'string') ai = { url: '', model: '' };

  let deck;
  try { deck = validateDeck(readJson(file('deck.json'), defaultDeck())); } catch { deck = defaultDeck(); }

  const storedPolicy = readJson(file('policy.json'), {});
  let policy = {
    allow: { ...DEFAULT_POLICY.allow, ...(storedPolicy.allow ?? {}) },
    confirm: { ...DEFAULT_POLICY.confirm, ...(storedPolicy.confirm ?? {}) },
  };

  return {
    home,
    scriptsDir,
    identity: {
      id: identity.id,
      name: identity.name,
      publicKey: proto.fromB64(identity.publicKey, 32),
      secretKey: proto.fromB64(identity.secretKey, 32),
    },

    listDevices: () => devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })),
    findDeviceByPub(pubB64) { return devices.find((d) => d.publicKey === pubB64) ?? null; },
    addDevice({ publicKey, name }) {
      const existing = devices.find((d) => d.publicKey === publicKey);
      if (existing) return existing;
      const d = { id: crypto.randomBytes(6).toString('hex'), name, publicKey, pairedAt: new Date().toISOString(), lastSeen: null };
      devices.push(d);
      writeJson(file('devices.json'), devices);
      return d;
    },
    revokeDevice(id) {
      const before = devices.length;
      devices = devices.filter((d) => d.id !== id);
      if (devices.length !== before) writeJson(file('devices.json'), devices);
      return devices.length !== before;
    },
    touchDevice(id) {
      const d = devices.find((x) => x.id === id);
      if (d) { d.lastSeen = new Date().toISOString(); writeJson(file('devices.json'), devices); }
    },

    getDeck: () => deck,
    saveDeck(next) {
      const valid = validateDeck(next);
      if (Buffer.byteLength(JSON.stringify(valid)) > 4 * 1024 * 1024) throw new Error('El deck es demasiado grande');
      deck = valid;
      writeJson(file('deck.json'), deck);
      return deck;
    },

    getPolicy: () => structuredClone(policy),
    savePolicy(next) {
      const clean = { allow: {}, confirm: {} };
      for (const k of Object.keys(DEFAULT_POLICY.allow)) clean.allow[k] = Boolean(next?.allow?.[k] ?? policy.allow[k]);
      for (const k of Object.keys(DEFAULT_POLICY.confirm)) clean.confirm[k] = Boolean(next?.confirm?.[k] ?? policy.confirm[k]);
      policy = clean;
      writeJson(file('policy.json'), policy);
      return structuredClone(policy);
    },

    getAutomations: () => structuredClone(automations),
    saveAutomations(next) {
      automations = validateAutomations(next);
      writeJson(file('automations.json'), automations);
      return structuredClone(automations);
    },

    get setupDone() { return setup.done === true; },
    setSetupDone(done) {
      setup = { done: done === true, at: new Date().toISOString() };
      writeJson(file('setup.json'), setup);
    },

    getAi: () => ({ ...ai }),
    saveAi({ url = '', model = '' } = {}) {
      const u = String(url).trim();
      if (u) {
        let parsed;
        try { parsed = new URL(u); } catch { throw new Error('Dirección inválida'); }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Usa una dirección http o https');
      }
      ai = { url: u.replace(/\/+$/, ''), model: String(model).trim().slice(0, 100) };
      writeJson(file('ai.json'), ai);
      return { ...ai };
    },

    rename(name) {
      const clean = String(name ?? '').trim().slice(0, 40);
      if (!clean) throw new Error('Nombre vacío');
      identity.name = clean;
      writeJson(file('identity.json'), identity);
      this.identity.name = clean;
    },
  };
}
