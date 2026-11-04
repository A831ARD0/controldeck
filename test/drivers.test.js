import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMacDriver, parseIoregIdle, parseLsappinfoName, _scripts } from '../agent/drivers/mac.js';
import { createWindowsDriver, buildCombo, keyToVk } from '../agent/drivers/windows.js';

function fakeExec() {
  const calls = [];
  const execFile = (cmd, args, opts, cb) => { calls.push({ cmd, args }); cb(null, '', ''); };
  return { calls, execFile };
}

test('Mac: el texto del usuario va como argumento, nunca dentro del script', async () => {
  const { calls, execFile } = fakeExec();
  const d = createMacDriver({ execFile });
  const evil = '" & do shell script "rm -rf ~" & "';
  await d.text(evil);
  assert.equal(calls[0].cmd, 'osascript');
  assert.equal(calls[0].args[1], _scripts.TEXT_SCRIPT);
  assert.equal(calls[0].args[2], evil);
  assert.ok(!_scripts.TEXT_SCRIPT.includes(evil));
});

test('Mac: atajos con letras usan keystroke y teclas especiales usan key code', async () => {
  const { calls, execFile } = fakeExec();
  const d = createMacDriver({ execFile });
  await d.hotkey({ mods: ['cmd', 'shift'], key: 's' });
  await d.hotkey({ mods: [], key: 'f13' });
  await d.hotkey({ mods: ['win'], key: 'left' });
  assert.deepEqual(calls[0].args.slice(2), ['char', 's', 'cmd', 'shift']);
  assert.deepEqual(calls[1].args.slice(2), ['code', '105']);
  assert.deepEqual(calls[2].args.slice(2), ['code', '123', 'cmd']);
  await assert.rejects(d.hotkey({ mods: [], key: 'f24' }), /no existe en Mac/);
});

test('Mac: abrir apps y URLs con argumentos separados', async () => {
  const { calls, execFile } = fakeExec();
  const d = createMacDriver({ execFile });
  await d.open({ kind: 'app', value: 'Microsoft Excel' });
  await d.open({ kind: 'url', value: 'https://example.com/' });
  assert.deepEqual(calls[0], { cmd: 'open', args: ['-a', 'Microsoft Excel'] });
  assert.deepEqual(calls[1], { cmd: 'open', args: ['https://example.com/'] });
});

test('Mac: lectura de app al frente e inactividad', () => {
  assert.equal(parseLsappinfoName('"LSDisplayName"="Safari"\n'), 'Safari');
  assert.equal(parseLsappinfoName(''), '');
  assert.equal(parseIoregIdle('  |   "HIDIdleTime" = 2500000000\n'), 2500);
});

test('Mac: permiso de Accesibilidad faltante da un mensaje claro', async () => {
  const execFile = (cmd, args, opts, cb) => cb(new Error('fail'), '', 'osascript: System Events got an error: osascript is not allowed assistive access. (-1719)');
  const d = createMacDriver({ execFile });
  await assert.rejects(d.text('hola'), /Accesibilidad/);
});

test('Windows: códigos de tecla', () => {
  assert.equal(keyToVk('a'), 0x41);
  assert.equal(keyToVk('7'), 0x37);
  assert.equal(keyToVk('f1'), 0x70);
  assert.equal(keyToVk('f24'), 0x87);
  assert.deepEqual(buildCombo({ mods: ['ctrl', 'shift'], key: 'left' }), { op: 'combo', mods: [0x11, 0x10], key: 0x25, extended: true });
  assert.throws(() => keyToVk('nope'));
});

test('Windows: el ayudante recibe JSON por línea y responde por id', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough(), kill() {} });
  const seen = [];
  stdin.on('data', (buf) => {
    for (const line of buf.toString().split('\n').filter(Boolean)) {
      const req = JSON.parse(line);
      seen.push(req);
      const result = req.op === 'foreground' ? 'EXCEL' : req.op === 'idle' ? 1234 : null;
      stdout.write('﻿' + JSON.stringify(req.op === 'text' && req.text === 'falla' ? { id: req.id, ok: false, error: 'bloqueado' } : { id: req.id, ok: true, result }) + '\n');
    }
  });
  const d = createWindowsDriver({ spawn: () => proc });
  await d.hotkey({ mods: ['win'], key: 'd' });
  assert.equal(await d.frontmostApp(), 'EXCEL');
  assert.equal(await d.idleMs(), 1234);
  await assert.rejects(d.text('falla'), /bloqueado/);
  await d.media('playpause');
  assert.deepEqual(seen[0], { op: 'combo', mods: [0x5b], key: 0x44, extended: false, id: 1 });
  assert.deepEqual(seen.at(-1), { op: 'combo', mods: [], key: 0xb3, extended: true, id: 5 });
});
