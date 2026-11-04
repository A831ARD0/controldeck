// Protocolo criptográfico de ControlDeck. Se usa igual en el agente (Node) y en la tablet (navegador).
// No depende de WebCrypto, porque la app de tablet se sirve por HTTP en la red local y ahí el
// navegador no expone crypto.subtle. Toda la criptografía viene de tweetnacl, que se inyecta.
//
// Emparejamiento: compromiso + revelación + código de verificación de 6 dígitos (SAS), aprobado
// por la persona en la computadora. El compromiso impide que un atacante en medio elija sus
// llaves para forzar que los dos códigos coincidan.
//
// Sesión: Diffie-Hellman estático (identidades) + efímero (secreto hacia adelante), llaves
// distintas por dirección, cada mensaje con nonce aleatorio y número de secuencia estricto.

export const PROTOCOL_VERSION = 1;

const TAGS = {
  commit: 'controldeck/v1/pair-commit',
  sas: 'controldeck/v1/pair-sas',
  session: 'controldeck/v1/session',
  fingerprint: 'controldeck/v1/fingerprint',
};

export function createProtocol(nacl) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function concat(...parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(str, expectedLen) {
    if (typeof str !== 'string' || str.length > 8_000_000) throw new Error('base64 inválido');
    let bin;
    try { bin = atob(str); } catch { throw new Error('base64 inválido'); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    if (expectedLen !== undefined && out.length !== expectedLen) throw new Error('longitud inválida');
    return out;
  }

  const tag = (name) => encoder.encode(TAGS[name]);
  const hash = (...parts) => nacl.hash(concat(...parts));

  function equal(a, b) {
    return a.length === b.length && a.length > 0 && nacl.verify(a, b);
  }

  // --- Emparejamiento -------------------------------------------------------

  function pairCommit(devicePub, rD) {
    return hash(tag('commit'), devicePub, rD).subarray(0, 32);
  }

  function pairSas(agentPub, devicePub, rA, rD) {
    const h = hash(tag('sas'), agentPub, devicePub, rA, rD);
    const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
    return String(n % 1_000_000).padStart(6, '0');
  }

  // Huella corta de una llave pública, para mostrar en pantalla.
  function fingerprint(pub) {
    const h = hash(tag('fingerprint'), pub);
    return Array.from(h.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join('').replace(/(.{4})(?!$)/g, '$1-');
  }

  // --- Sesión ---------------------------------------------------------------

  function deriveSessionKeys({ staticShared, ephShared, nS, nC }) {
    const h = hash(tag('session'), staticShared, ephShared, nS, nC);
    return { c2s: h.slice(0, 32), s2c: h.slice(32, 64) };
  }

  function seal(key, obj) {
    const nonce = nacl.randomBytes(24);
    const box = nacl.secretbox(encoder.encode(JSON.stringify(obj)), nonce, key);
    return { t: 'm', n: toB64(nonce), c: toB64(box) };
  }

  function open(key, frame) {
    if (!frame || frame.t !== 'm' || typeof frame.n !== 'string' || typeof frame.c !== 'string') return null;
    let nonce, box;
    try { nonce = fromB64(frame.n, 24); box = fromB64(frame.c); } catch { return null; }
    const plain = nacl.secretbox.open(box, nonce, key);
    if (!plain) return null;
    try { return JSON.parse(decoder.decode(plain)); } catch { return null; }
  }

  // Canal cifrado con secuencia estricta en cada dirección: un mensaje repetido, reordenado o
  // alterado se rechaza y la conexión se cierra.
  function createChannel({ sendKey, recvKey }) {
    let sendSeq = 0;
    let recvSeq = 0;
    return {
      wrap(payload) {
        sendSeq += 1;
        return seal(sendKey, { s: sendSeq, p: payload });
      },
      unwrap(frame) {
        const inner = open(recvKey, frame);
        if (!inner || !Number.isSafeInteger(inner.s) || inner.s !== recvSeq + 1) return null;
        recvSeq = inner.s;
        return inner.p;
      },
    };
  }

  return {
    concat, toB64, fromB64, equal, hash,
    randomBytes: (n) => nacl.randomBytes(n),
    boxKeyPair: () => nacl.box.keyPair(),
    sharedKey: (peerPub, mySecret) => nacl.box.before(peerPub, mySecret),
    pairCommit, pairSas, fingerprint,
    deriveSessionKeys, seal, open, createChannel,
  };
}
