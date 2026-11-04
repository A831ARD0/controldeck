import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { createProtocol } from '../shared/protocol.js';

const P = createProtocol(nacl);

test('el código SAS coincide en ambos lados y cambia si cambia cualquier llave', () => {
  const agent = P.boxKeyPair();
  const dev = P.boxKeyPair();
  const rA = P.randomBytes(32);
  const rD = P.randomBytes(32);
  const sas = P.pairSas(agent.publicKey, dev.publicKey, rA, rD);
  assert.match(sas, /^\d{6}$/);
  assert.equal(P.pairSas(agent.publicKey, dev.publicKey, rA, rD), sas);
  const other = P.boxKeyPair();
  assert.notEqual(P.pairSas(other.publicKey, dev.publicKey, rA, rD), sas);
});

test('el compromiso solo se abre con la misma llave y el mismo aleatorio', () => {
  const dev = P.boxKeyPair();
  const rD = P.randomBytes(32);
  const c = P.pairCommit(dev.publicKey, rD);
  assert.ok(P.equal(c, P.pairCommit(dev.publicKey, rD)));
  assert.ok(!P.equal(c, P.pairCommit(dev.publicKey, P.randomBytes(32))));
  assert.ok(!P.equal(c, P.pairCommit(P.boxKeyPair().publicKey, rD)));
});

function sessionPair() {
  const agent = P.boxKeyPair(); const dev = P.boxKeyPair();
  const eA = P.boxKeyPair(); const eD = P.boxKeyPair();
  const nS = P.randomBytes(32); const nC = P.randomBytes(32);
  const kA = P.deriveSessionKeys({ staticShared: P.sharedKey(dev.publicKey, agent.secretKey), ephShared: P.sharedKey(eD.publicKey, eA.secretKey), nS, nC });
  const kD = P.deriveSessionKeys({ staticShared: P.sharedKey(agent.publicKey, dev.secretKey), ephShared: P.sharedKey(eA.publicKey, eD.secretKey), nS, nC });
  return { kA, kD };
}

test('las dos partes derivan las mismas llaves, distintas por dirección', () => {
  const { kA, kD } = sessionPair();
  assert.deepEqual(kA, kD);
  assert.ok(!P.equal(kA.c2s, kA.s2c));
});

test('el canal rechaza mensajes repetidos, reordenados y alterados', () => {
  const { kD } = sessionPair();
  const tx = P.createChannel({ sendKey: kD.c2s, recvKey: kD.s2c });
  const rx = P.createChannel({ sendKey: kD.s2c, recvKey: kD.c2s });
  const f1 = tx.wrap({ a: 1 });
  const f2 = tx.wrap({ a: 2 });
  assert.deepEqual(rx.unwrap(f1), { a: 1 });
  assert.equal(rx.unwrap(f1), null, 'repetido');

  const rx2 = P.createChannel({ sendKey: kD.s2c, recvKey: kD.c2s });
  assert.equal(rx2.unwrap(f2), null, 'fuera de orden');

  const rx3 = P.createChannel({ sendKey: kD.s2c, recvKey: kD.c2s });
  const bytes = P.fromB64(f1.c); bytes[5] ^= 1;
  assert.equal(rx3.unwrap({ ...f1, c: P.toB64(bytes) }), null, 'alterado');
});

test('un mensaje cifrado con otra llave no se abre', () => {
  const a = sessionPair(); const b = sessionPair();
  const frame = P.seal(a.kA.c2s, { x: 1 });
  assert.equal(P.open(b.kA.c2s, frame), null);
});

test('base64 rechaza longitudes inesperadas', () => {
  assert.throws(() => P.fromB64(P.toB64(new Uint8Array(31)), 32));
  assert.throws(() => P.fromB64('%%%'));
});
