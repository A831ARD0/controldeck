import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTailscale, clientIp, SERVE_PORT } from '../agent/tailscale.js';
import { isLocalOrigin } from '../agent/http-util.js';

const STATUS = {
  BackendState: 'Running',
  MagicDNSSuffix: 'tail123.ts.net',
  CertDomains: ['mac.tail123.ts.net'],
  Self: { DNSName: 'mac.tail123.ts.net.', TailscaleIPs: ['100.64.0.5', 'fd7a::1'] },
  Peer: {
    a: { HostName: 'PC-OFICINA', DNSName: 'pc-oficina.tail123.ts.net.', OS: 'windows', Online: true, TailscaleIPs: ['100.64.0.9'] },
    b: { HostName: 'Pixel', DNSName: 'pixel.tail123.ts.net.', OS: 'android', Online: true, TailscaleIPs: ['100.64.0.7'] },
    c: { HostName: 'Laptop', DNSName: 'laptop.tail123.ts.net.', OS: 'macOS', Online: false, TailscaleIPs: ['100.64.0.8'] },
  },
};

function fake({ serving = false, serveFails = false } = {}) {
  const calls = [];
  const execFile = (cmd, args, opts, cb) => {
    calls.push(args);
    if (args[0] === 'status') return cb(null, JSON.stringify(STATUS), '');
    if (args[0] === 'serve' && args[1] === 'status') {
      const web = serving ? { [`mac.tail123.ts.net:${SERVE_PORT}`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4455' } } }, 'mac.tail123.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:8001' } } } } : { 'mac.tail123.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:8001' } } } };
      return cb(null, JSON.stringify({ Web: web }), '');
    }
    if (args[0] === 'serve') return serveFails ? cb(new Error('x'), '', 'boom') : cb(null, '', '');
    cb(null, '', '');
  };
  return { calls, execFile };
}

test('lee el estado: nombre, HTTPS y si ya está publicado (sin confundir otros servicios)', async () => {
  const { execFile } = fake();
  const ts = createTailscale({ platform: 'darwin', execFile, exists: () => true, lanPort: 4455, fetchImpl: null });
  const s = await ts.status();
  assert.equal(s.running, true);
  assert.equal(s.dnsName, 'mac.tail123.ts.net');
  assert.equal(s.https, true);
  assert.equal(s.serving, false, 'el servicio del puerto 443 es de otro proyecto');
  assert.deepEqual(s.ips, ['100.64.0.5']);
  assert.equal(s.peers.length, 2, 'solo los que están en línea');
});

test('activar publica solo el puerto de ControlDeck, nunca con Funnel', async () => {
  const { calls, execFile } = fake();
  const ts = createTailscale({ platform: 'darwin', execFile, exists: () => true, lanPort: 4455, fetchImpl: null });
  await ts.enable();
  const serve = calls.find((a) => a[0] === 'serve' && a[1] === '--bg');
  assert.deepEqual(serve, ['serve', '--bg', `--https=${SERVE_PORT}`, 'http://127.0.0.1:4455']);
  assert.ok(!calls.flat().includes('funnel'));
  await ts.disable();
  assert.ok(calls.some((a) => a.join(' ') === `serve --https=${SERVE_PORT} off`));
});

test('detecta cuando ya está publicado', async () => {
  const { execFile } = fake({ serving: true });
  const s = await createTailscale({ platform: 'darwin', execFile, exists: () => true, lanPort: 4455, fetchImpl: null }).status();
  assert.equal(s.serving, true);
  assert.equal(s.url, `https://mac.tail123.ts.net:${SERVE_PORT}/`);
});

test('sin Tailscale instalado no falla', async () => {
  const s = await createTailscale({ platform: 'darwin', exists: () => false, lanPort: 4455 }).status();
  assert.deepEqual(s, { installed: false, running: false });
});

test('encuentra otras computadoras con ControlDeck en la tailnet', async () => {
  const { execFile } = fake();
  const fetchImpl = async (url) => ({ json: async () => (url.includes('pc-oficina') ? { name: 'ControlDeck' } : { name: 'Otra' }) });
  const found = await createTailscale({ platform: 'darwin', execFile, exists: () => true, lanPort: 4455, fetchImpl }).findAgents();
  assert.deepEqual(found, [{ id: null, name: 'PC-OFICINA', os: 'win', url: `wss://pc-oficina.tail123.ts.net:${SERVE_PORT}/ws`, via: 'tailscale' }]);
});

test('orígenes: se acepta la tailnet propia y no otras de *.ts.net', () => {
  assert.equal(isLocalOrigin('https://mac.tail123.ts.net:4443', ['tail123.ts.net']), true);
  assert.equal(isLocalOrigin('https://evil.otratailnet.ts.net', ['tail123.ts.net']), false);
  assert.equal(isLocalOrigin('https://tail123.ts.net.evil.com', ['tail123.ts.net']), false);
  assert.equal(isLocalOrigin('https://mac.tail123.ts.net:4443'), false);
});

test('IP real detrás de tailscale serve, solo si la conexión viene de esta computadora', () => {
  const req = (remote, fwd) => ({ socket: { remoteAddress: remote }, headers: fwd ? { 'x-forwarded-for': fwd } : {} });
  assert.equal(clientIp(req('127.0.0.1', '100.64.0.9')), '100.64.0.9');
  assert.equal(clientIp(req('192.168.1.50', '1.2.3.4')), '192.168.1.50', 'un equipo de la red no puede falsear su IP');
  assert.equal(clientIp(req('127.0.0.1', 'basura<>')), '127.0.0.1');
});
