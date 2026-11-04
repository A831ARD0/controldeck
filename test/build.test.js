// Autorrevisión y archivos que van dentro de la app compilada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ASSETS, LAN_ROUTES, readAsset, isCompiled } from '../agent/assets.js';
import { createDiagnostics } from '../agent/diagnostics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('todos los archivos que se embeben existen y se leen', () => {
  assert.equal(isCompiled, false);
  for (const rel of ALL_ASSETS) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
    assert.ok(readAsset(rel).length > 0, rel);
  }
  // Cada módulo que importa la app de tablet está publicado.
  const served = new Set(Object.keys(LAN_ROUTES));
  for (const file of fs.readdirSync(path.join(ROOT, 'web')).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, 'web', file), 'utf8');
    for (const [, spec] of src.matchAll(/from '([^']+)'/g)) {
      const route = spec.startsWith('./') ? `/${spec.slice(2)}` : spec;
      assert.ok(served.has(route), `${file} importa ${spec}, que no se sirve`);
    }
  }
});

function fakeExec(outputs) {
  const calls = [];
  const execFile = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    const key = Object.keys(outputs).find((k) => [cmd, ...args].join(' ').includes(k));
    cb(null, key ? outputs[key] : '', '');
  };
  return { calls, execFile };
}

test('autorrevisión: detecta permiso faltante y firewall que bloquea todo', async () => {
  const { execFile } = fakeExec({ AXIsProcessTrusted: 'false\n', '--getglobalstate': 'Firewall is enabled. (State = 1)', '--getblockall': 'Firewall is set to block all non-essential incoming connections\nBlock all ENABLED!' });
  const checks = await createDiagnostics({ platform: 'darwin', execFile, lanPort: 4455, addresses: () => ['192.168.1.5'] }).run();
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId.accessibility.ok, false);
  assert.equal(byId.accessibility.fix, 'accessibility');
  assert.equal(byId.firewall.ok, false);
  assert.equal(byId.network.ok, true);
  assert.match(byId.network.detail, /192\.168\.1\.5:4455/);
});

test('autorrevisión: todo bien y sin red', async () => {
  const { execFile } = fakeExec({ AXIsProcessTrusted: 'true\n', '--getglobalstate': 'Firewall is disabled. (State = 0)', '--getblockall': 'Block all DISABLED!' });
  const checks = await createDiagnostics({ platform: 'darwin', execFile, lanPort: 4455, addresses: () => [] }).run();
  assert.deepEqual(checks.map((c) => [c.id, c.ok]), [['accessibility', true], ['firewall', true], ['network', false]]);
});

test('autorrevisión: pedir el permiso abre la pantalla de Accesibilidad', async () => {
  const { calls, execFile } = fakeExec({});
  const d = createDiagnostics({ platform: 'darwin', execFile, lanPort: 1 });
  assert.equal(await d.fix('accessibility'), true);
  assert.ok(calls.some((c) => c[0] === 'open' && c[1].includes('Privacy_Accessibility')));
  assert.equal(await d.fix('otra-cosa'), false);
});

test('en Windows solo se revisa la red', async () => {
  const checks = await createDiagnostics({ platform: 'win32', execFile: () => {}, lanPort: 1, addresses: () => ['10.0.0.2'] }).run();
  assert.deepEqual(checks.map((c) => c.id), ['network']);
});
