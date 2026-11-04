import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeys, resolveMods, validateAction, validateButton, validateDeck, classifyOpenTarget, expandText, isDangerous } from '../shared/actions.js';
import { defaultDeck } from '../agent/default-deck.js';

test('atajos: modificadores portables y alias', () => {
  assert.deepEqual(parseKeys('Mod+Shift+S'), { mods: ['mod', 'shift'], key: 's' });
  assert.deepEqual(parseKeys('ctrl+alt+del'), { mods: ['ctrl', 'alt'], key: 'delete' });
  assert.deepEqual(parseKeys('f13'), { mods: [], key: 'f13' });
  assert.deepEqual(resolveMods(['mod', 'shift'], 'mac'), ['cmd', 'shift']);
  assert.deepEqual(resolveMods(['mod', 'shift'], 'win'), ['ctrl', 'shift']);
  assert.deepEqual(resolveMods(['cmd'], 'win'), ['win']);
});

test('atajos inválidos', () => {
  for (const bad of ['', 'ctrl', 'ctrl+shift', 'hyper+a', 'f25', 'mod+ñ', 'a'.repeat(80)]) {
    assert.throws(() => parseKeys(bad), undefined, bad);
  }
});

test('abrir: solo http, https y mailto; sin rutas con ..', () => {
  assert.equal(classifyOpenTarget('https://example.com').kind, 'url');
  assert.equal(classifyOpenTarget('mailto:a@b.com').kind, 'url');
  assert.equal(classifyOpenTarget('Microsoft Excel').kind, 'app');
  assert.equal(classifyOpenTarget('/Applications/Notes.app').kind, 'path');
  assert.equal(classifyOpenTarget('C:\\Users\\a\\doc.xlsx').kind, 'path');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ms-settings:privacy', '-n', '/tmp/../etc/passwd', 'calc; del', 'a\nb']) {
    assert.throws(() => classifyOpenTarget(bad), undefined, bad);
  }
});

test('scripts: solo nombres simples, sin rutas', () => {
  assert.deepEqual(validateAction({ type: 'script', name: 'respaldo_1' }), { type: 'script', name: 'respaldo_1' });
  for (const bad of ['../x', 'a/b', 'a.sh', '', 'x y']) assert.throws(() => validateAction({ type: 'script', name: bad }));
});

test('secuencias: sin anidar, con límite de pasos y pausas acotadas', () => {
  assert.ok(validateAction({ type: 'multi', steps: [{ type: 'hotkey', keys: 'mod+c' }, { type: 'delay', ms: 200 }] }));
  assert.throws(() => validateAction({ type: 'multi', steps: [{ type: 'multi', steps: [] }] }));
  assert.throws(() => validateAction({ type: 'multi', steps: Array(33).fill({ type: 'media', cmd: 'next' }) }));
  assert.throws(() => validateAction({ type: 'multi', steps: [{ type: 'delay', ms: 999999 }] }));
  assert.throws(() => validateAction({ type: 'delay', ms: 10 }), /secuencia/);
});

test('campos extra no pasan la validación (no se guardan)', () => {
  const a = validateAction({ type: 'media', cmd: 'next', evil: 'x' });
  assert.deepEqual(a, { type: 'media', cmd: 'next' });
});

test('botones: color e imagen validados', () => {
  const base = { id: 'b1', label: 'x', action: { type: 'media', cmd: 'mute' } };
  assert.ok(validateButton({ ...base, color: '#AABBCC' }));
  assert.throws(() => validateButton({ ...base, color: 'red;background:url(x)' }));
  assert.throws(() => validateButton({ ...base, image: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  assert.ok(validateButton({ ...base, image: 'data:image/png;base64,iVBORw0KGgo=' }));
  assert.throws(() => validateButton({ ...base, id: '<script>' }));
});

test('el deck inicial es válido y tiene acciones peligrosas marcadas', () => {
  const d = validateDeck(defaultDeck());
  assert.equal(d.pages.length, 3);
  const lock = d.pages[2].buttons[0];
  assert.ok(isDangerous(lock.action));
});

test('deck con ids repetidos se rechaza', () => {
  const d = defaultDeck();
  d.pages[0].buttons.push({ ...d.pages[0].buttons[0] });
  assert.throws(() => validateDeck(d), /repetidos/);
});

test('variables de texto', async () => {
  const now = new Date(2026, 9, 29, 8, 5);
  assert.equal(await expandText('Hoy {fecha} a las {hora} {otra}', { now }), 'Hoy 29/10/2026 a las 08:05 {otra}');
  assert.equal(await expandText('[{portapapeles}]', { readClipboard: async () => 'hola' }), '[hola]');
});

test('atajos se muestran con las teclas de cada sistema', async () => {
  const { formatKeys, actionHint } = await import('../shared/actions.js');
  assert.deepEqual(formatKeys({ keys: 'mod+shift+s' }, 'mac'), ['⇧', '⌘', 'S']);
  assert.deepEqual(formatKeys({ keys: 'mod+shift+s' }, 'win'), ['Ctrl', 'Shift', 'S']);
  assert.deepEqual(formatKeys({ keys: 'mod+y', mac: 'cmd+shift+z' }, 'mac'), ['⇧', '⌘', 'Z']);
  assert.deepEqual(formatKeys({ keys: 'mal+x' }, 'mac'), []);
  assert.equal(actionHint({ type: 'text', text: '{fecha}' }), 'Escribe la fecha');
  assert.equal(actionHint({ type: 'open', target: 'https://www.google.com' }), 'Abre google.com');
});

test('todas las plantillas son botones válidos', async () => {
  const { PRESET_CATEGORIES } = await import('../web/presets.js');
  let n = 0;
  for (const c of PRESET_CATEGORIES) for (const i of c.items) {
    validateButton({ id: 'x', label: i.label, icon: i.icon, color: c.color, target: i.target ?? 'focus', action: i.action });
    n++;
  }
  assert.ok(n >= 40);
});
