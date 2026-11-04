// Conexión de la tablet con un agente. Funciona con el WebSocket del navegador y con el paquete
// `ws` de Node (en las pruebas). Maneja emparejamiento, autenticación mutua y peticiones.

const REQUEST_TIMEOUT_MS = 15_000;

export function createAgentClient({ proto, WebSocketImpl, url, device, pinnedAgentPub = null, deviceName = 'Tablet', onEvent = () => {} }) {
  let ws = null;
  let channel = null;
  let authed = false;
  let agentInfo = null;
  let pairingState = null;
  let closedByUser = false;
  let nextReq = 1;
  const pending = new Map();

  const emit = (e) => { try { onEvent(e); } catch (err) { console.error(err); } };
  const sendClear = (obj) => ws && ws.readyState === 1 && ws.send(JSON.stringify(obj));

  function fail(code, message) {
    emit({ type: 'status', status: 'error', code, message });
    shutdown();
  }

  function shutdown() {
    channel = null;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Conexión cerrada')); }
    pending.clear();
    if (ws) { try { ws.close(); } catch {} }
  }

  function startAuth(hello, agentPub) {
    const eph = proto.boxKeyPair();
    const nC = proto.randomBytes(32);
    const nS = proto.fromB64(hello.nS, 32);
    const ePubS = proto.fromB64(hello.ePub, 32);
    const keys = proto.deriveSessionKeys({
      staticShared: proto.sharedKey(agentPub, device.sec),
      ephShared: proto.sharedKey(ePubS, eph.secretKey),
      nS, nC,
    });
    channel = proto.createChannel({ sendKey: keys.c2s, recvKey: keys.s2c });
    sendClear({
      t: 'auth',
      devicePub: proto.toB64(device.pub),
      ePub: proto.toB64(eph.publicKey),
      nC: proto.toB64(nC),
      proof: channel.wrap({ k: 'auth', nS: hello.nS }),
    });
    emit({ type: 'status', status: 'authenticating' });
  }

  function onHello(hello) {
    let agentPub;
    try { agentPub = proto.fromB64(hello.agentPub, 32); proto.fromB64(hello.nS, 32); proto.fromB64(hello.ePub, 32); } catch { return fail('bad-hello', 'Respuesta inválida del agente'); }
    agentInfo = { id: hello.agentId, name: hello.name, os: hello.os, agentPub: hello.agentPub, fingerprint: proto.fingerprint(agentPub) };
    emit({ type: 'hello', info: agentInfo });
    if (pinnedAgentPub) {
      if (!proto.equal(pinnedAgentPub, agentPub)) {
        return fail('identity-changed', 'La identidad de la computadora cambió. Si no reinstalaste el agente, alguien podría estar suplantándola.');
      }
      return startAuth(hello, agentPub);
    }
    // Emparejamiento: comprometerse primero, revelar después.
    const rD = proto.randomBytes(32);
    const state = { hello, agentPub, rD };
    pairingState = state;
    sendClear({ t: 'pair-commit', cD: proto.toB64(proto.pairCommit(device.pub, rD)), name: String(deviceName).slice(0, 40) });
    emit({ type: 'status', status: 'pairing' });
  }

  function onClear(msg) {
    switch (msg.t) {
      case 'hello': return channel || agentInfo ? fail('protocol', 'Saludo repetido') : onHello(msg);
      case 'pair-reveal': {
        if (!pairingState || pairingState.rA) return fail('protocol', 'Mensaje fuera de orden');
        let rA;
        try { rA = proto.fromB64(msg.rA, 32); } catch { return fail('protocol', 'Mensaje inválido'); }
        pairingState.rA = rA;
        sendClear({ t: 'pair-open', devicePub: proto.toB64(device.pub), rD: proto.toB64(pairingState.rD) });
        const sas = proto.pairSas(pairingState.agentPub, device.pub, rA, pairingState.rD);
        emit({ type: 'status', status: 'sas', sas });
        return;
      }
      case 'pair-ok': {
        if (!pairingState || !pairingState.rA) return fail('protocol', 'Mensaje fuera de orden');
        const { hello, agentPub } = pairingState;
        pairingState = null;
        emit({ type: 'paired', agentPub: proto.toB64(agentPub), info: agentInfo });
        return startAuth(hello, agentPub);
      }
      case 'error':
        return fail(String(msg.code ?? 'error'), String(msg.message ?? 'Error del agente').slice(0, 300));
      default:
        return fail('protocol', 'Mensaje desconocido');
    }
  }

  function onSealed(frame) {
    const payload = channel.unwrap(frame);
    if (!payload) return fail('tampered', 'Mensaje alterado o repetido; conexión cerrada por seguridad');
    if (payload.k === 'ready') {
      authed = true;
      emit({ type: 'status', status: 'ready', info: { ...agentInfo, ...payload.agent } });
      return;
    }
    if (payload.k === 'result' && pending.has(payload.reqId)) {
      const { resolve, timer } = pending.get(payload.reqId);
      clearTimeout(timer);
      pending.delete(payload.reqId);
      resolve(payload);
      return;
    }
    emit({ type: 'message', payload });
  }

  return {
    get info() { return agentInfo; },
    get ready() { return authed && channel !== null && ws?.readyState === 1; },

    connect() {
      closedByUser = false;
      authed = false;
      agentInfo = null;
      pairingState = null;
      channel = null;
      emit({ type: 'status', status: 'connecting' });
      ws = new WebSocketImpl(url);
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return fail('protocol', 'Mensaje inválido'); }
        if (msg && msg.t === 'm') {
          if (!channel) return fail('protocol', 'Mensaje cifrado antes de autenticar');
          return onSealed(msg);
        }
        onClear(msg ?? {});
      };
      ws.onclose = () => {
        channel = null;
        authed = false;
        for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Conexión cerrada')); }
        pending.clear();
        emit({ type: 'status', status: 'closed', byUser: closedByUser });
      };
      ws.onerror = () => {};
    },

    close() { closedByUser = true; shutdown(); },

    send(payload) {
      if (!authed || ws?.readyState !== 1) throw new Error('No conectado');
      ws.send(JSON.stringify(channel.wrap(payload)));
    },

    // timeoutMs: algunas peticiones tardan más (el asistente de IA puede tardar en cargar su modelo).
    request(payload, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
      if (!authed || ws?.readyState !== 1) return Promise.reject(new Error('No conectado'));
      const reqId = nextReq++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('La computadora no respondió a tiempo')); }, timeoutMs);
        pending.set(reqId, { resolve, reject, timer });
        ws.send(JSON.stringify(channel.wrap({ ...payload, reqId })));
      });
    },
  };
}
