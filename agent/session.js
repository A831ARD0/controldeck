// Una conexión WebSocket de una tablet. Máquina de estados:
//   saludo → (emparejamiento con aprobación en la computadora) → autenticación → canal cifrado.
// Cualquier mensaje fuera de orden, alterado o repetido cierra la conexión.

import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { localMacs } from './wol.js';

const AUTH_TIMEOUT_MS = 15_000;
const PAIR_TIMEOUT_MS = 130_000;
const MAX_MSGS_PER_SEC = 60;
const PRE_AUTH_MAX_BYTES = 8 * 1024;

export function handleConnection(ws, ip, ctx) {
  const { proto, store, executor, pairing, hub, activity, automations, assistant } = ctx;
  const nS = proto.randomBytes(32);
  const eph = proto.boxKeyPair();
  let state = 'hello';
  let pair = null;
  let channel = null;
  let device = null;
  let pendingId = null;
  let msgCount = 0;
  let msgWindow = Date.now();

  const sendClear = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const send = (payload) => { if (channel && ws.readyState === 1) ws.send(JSON.stringify(channel.wrap(payload))); };
  const fail = (code, message, wsCode = 4000) => {
    sendClear({ t: 'error', code, message });
    ws.close(wsCode, code);
  };

  let deadline = setTimeout(() => fail('timeout', 'Tiempo de espera agotado'), AUTH_TIMEOUT_MS);
  const resetDeadline = (ms) => { clearTimeout(deadline); deadline = setTimeout(() => fail('timeout', 'Tiempo de espera agotado'), ms); };

  sendClear({
    t: 'hello', v: PROTOCOL_VERSION,
    agentId: store.identity.id, name: store.identity.name, os: ctx.os,
    agentPub: proto.toB64(store.identity.publicKey),
    nS: proto.toB64(nS), ePub: proto.toB64(eph.publicKey),
  });

  function onPairCommit(msg) {
    // Solo se aceptan emparejamientos mientras el panel está abierto en la computadora: es cuando
    // la persona está enfrente para comparar el código. Así nadie de la red puede llenar la
    // computadora de solicitudes ni esperar a que alguien apruebe una por error.
    if (!ctx.pairingOpen()) return fail('pair-closed', `Abre el panel de ControlDeck en la computadora para emparejar esta tablet (${ctx.os === 'win' ? 'menú Inicio → ControlDeck' : 'abre la app ControlDeck'})`);
    if (!pairing.allowAttempt(ip)) return fail('rate-limited', 'Demasiados intentos de emparejamiento; espera unos minutos');
    let cD;
    try { cD = proto.fromB64(msg.cD, 32); } catch { return fail('protocol', 'Mensaje inválido'); }
    const name = typeof msg.name === 'string' ? msg.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Tablet' : 'Tablet';
    const rA = proto.randomBytes(32);
    pair = { cD, rA, name };
    state = 'pair-revealed';
    resetDeadline(AUTH_TIMEOUT_MS);
    sendClear({ t: 'pair-reveal', rA: proto.toB64(rA) });
  }

  function onPairOpen(msg) {
    let devicePub, rD;
    try { devicePub = proto.fromB64(msg.devicePub, 32); rD = proto.fromB64(msg.rD, 32); } catch { return fail('protocol', 'Mensaje inválido'); }
    if (!proto.equal(proto.pairCommit(devicePub, rD), pair.cD)) return fail('pair-commit', 'El compromiso de emparejamiento no coincide');
    const sas = proto.pairSas(store.identity.publicKey, devicePub, pair.rA, rD);
    const devicePubB64 = proto.toB64(devicePub);
    if (store.findDeviceByPub(devicePubB64)) {
      // Ya estaba emparejado: no hace falta volver a aprobar.
      state = 'await-auth';
      return sendClear({ t: 'pair-ok' });
    }
    state = 'pair-wait';
    resetDeadline(PAIR_TIMEOUT_MS);
    pendingId = pairing.add({
      deviceName: pair.name, devicePub: devicePubB64, sas, ip,
      onDecision(ok, reason) {
        pendingId = null;
        if (ws.readyState !== 1) return;
        if (!ok) return fail(reason === 'expired' ? 'pair-expired' : 'pair-rejected', reason === 'expired' ? 'Nadie aprobó el emparejamiento a tiempo' : 'La computadora rechazó el emparejamiento');
        store.addDevice({ publicKey: devicePubB64, name: pair.name });
        state = 'await-auth';
        resetDeadline(AUTH_TIMEOUT_MS);
        sendClear({ t: 'pair-ok' });
      },
    });
    if (!pendingId) return fail('pair-busy', 'Hay demasiadas solicitudes de emparejamiento pendientes');
  }

  function onAuth(msg) {
    let devicePub, ePubC, nC;
    try {
      devicePub = proto.fromB64(msg.devicePub, 32);
      ePubC = proto.fromB64(msg.ePub, 32);
      nC = proto.fromB64(msg.nC, 32);
    } catch { return fail('protocol', 'Mensaje inválido'); }
    const known = store.findDeviceByPub(proto.toB64(devicePub));
    if (!known) return fail('not-paired', 'Esta tablet no está emparejada con esta computadora', 4003);
    const keys = proto.deriveSessionKeys({
      staticShared: proto.sharedKey(devicePub, store.identity.secretKey),
      ephShared: proto.sharedKey(ePubC, eph.secretKey),
      nS, nC,
    });
    const ch = proto.createChannel({ sendKey: keys.s2c, recvKey: keys.c2s });
    const proof = ch.unwrap(msg.proof);
    if (!proof || proof.k !== 'auth' || proof.nS !== proto.toB64(nS)) return fail('auth-failed', 'Autenticación fallida', 4003);
    channel = ch;
    device = { id: known.id, name: known.name };
    state = 'ready';
    clearTimeout(deadline);
    store.touchDevice(known.id);
    hub.add(session);
    send({
      k: 'ready',
      agent: { id: store.identity.id, name: store.identity.name, os: ctx.os, fingerprint: proto.fingerprint(store.identity.publicKey), macs: localMacs(), ai: assistant.configured, notifs: ctx.notifier.supported },
      device,
    });
    const s = activity.current();
    if (s) send({ k: 'state', ...s });
  }

  async function onRequest(p) {
    if (p.k === 'pointer') return void executor.pointer(device, p);
    if (p.k === 'state.want') return void activity.want(session, { music: p.music === true });
    if (p.k === 'windows.watch') return void (p.on === true ? ctx.windowsWatch.add(session) : ctx.windowsWatch.remove(session));
    const reqId = Number.isSafeInteger(p.reqId) ? p.reqId : null;
    const reply = (body) => send({ k: 'result', reqId, ...body });
    try {
      switch (p.k) {
        case 'ping': return reply({ ok: true });
        case 'deck.get': return reply({ ok: true, deck: store.getDeck() });
        case 'deck.save': {
          const deck = store.saveDeck(p.deck);
          reply({ ok: true, deck });
          return hub.broadcast({ k: 'deck', deck }, session);
        }
        case 'action.run':
          return reply(await executor.run({ action: p.action, confirmed: p.confirmed === true, device }));
        case 'agents.list':
          return reply({ ok: true, agents: await ctx.listAgents() });
        case 'clipboard.get':
          return reply(await executor.clipboardGet(device));
        case 'clipboard.set':
          return reply(await executor.clipboardSet(device, p.text, p.paste === true));
        case 'wake':
          return reply(await executor.wake(device, Array.isArray(p.macs) ? p.macs.slice(0, 4) : []));
        case 'automations.get':
          return reply({ ok: true, automations: store.getAutomations(), lastRun: automations.status() });
        case 'automations.save': {
          const saved = store.saveAutomations(p.automations);
          automations.changed();
          return reply({ ok: true, automations: saved });
        }
        case 'ai.suggest':
          return reply({ ok: true, button: await assistant.suggest({ prompt: p.prompt, os: p.os === 'win' ? 'win' : 'mac', deviceId: device.id }) });
        case 'windows.list':
          return reply(await executor.windowsList(device));
        case 'window.do': {
          const r = await executor.windowDo(device, p.id, p.op, p.title);
          ctx.windowsWatch.kick();
          return reply(r);
        }
        case 'notifs.get':
          return reply({ ok: true, supported: ctx.notifier.supported, ...ctx.notifier.snapshot() });
        case 'log.get':
          return reply({ ok: true, log: executor.getLog().slice(0, 50) });
        default:
          return reply({ ok: false, error: 'Petición desconocida' });
      }
    } catch (err) {
      return reply({ ok: false, error: String(err.message ?? err).slice(0, 300) });
    }
  }

  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    if (now - msgWindow > 1000) { msgWindow = now; msgCount = 0; }
    if (++msgCount > MAX_MSGS_PER_SEC) return fail('rate-limited', 'Demasiados mensajes', 4008);
    if (isBinary) return fail('protocol', 'Solo se aceptan mensajes de texto');
    if (state !== 'ready' && data.length > PRE_AUTH_MAX_BYTES) return fail('protocol', 'Mensaje demasiado grande', 1009);
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return fail('protocol', 'Mensaje inválido'); }
    if (!msg || typeof msg !== 'object') return fail('protocol', 'Mensaje inválido');

    if (state === 'ready') {
      if (msg.t !== 'm') return fail('protocol', 'Mensaje sin cifrar después de autenticar');
      const p = channel.unwrap(msg);
      if (!p || typeof p !== 'object') return ws.close(4001, 'tampered');
      return void onRequest(p);
    }
    if (state === 'hello' && msg.t === 'pair-commit') return onPairCommit(msg);
    if (state === 'pair-revealed' && msg.t === 'pair-open') return onPairOpen(msg);
    if ((state === 'hello' || state === 'await-auth') && msg.t === 'auth') return onAuth(msg);
    return fail('protocol', 'Mensaje fuera de orden');
  });

  ws.on('close', () => {
    clearTimeout(deadline);
    if (pendingId) pairing.cancel(pendingId);
    hub.remove(session);
    activity.want(session, { music: false });
    ctx.windowsWatch.remove(session);
  });

  const session = {
    get deviceId() { return device?.id ?? null; },
    send,
    kick() { ws.close(4003, 'revoked'); },
  };
  return session;
}
