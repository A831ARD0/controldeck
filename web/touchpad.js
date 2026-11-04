// Touchpad remoto: la tablet como mouse y teclado de la computadora.
//   Un dedo: mover · tocar: clic · dos dedos al tocar: clic derecho · dos dedos arrastrando: desplazar.
// Los movimientos se juntan y se mandan una vez por cuadro de pantalla (unos 60 por segundo).
// Teclado: lo que se escribe en la tablet se manda como texto, y borrar, Enter, Tab, flechas y
// Esc como teclas. Las letras seguidas se juntan en un solo envío.

import { h, openSheet, segmented, haptic, toast } from './ui.js';

const SPEEDS = { lenta: 1.2, normal: 2, rapida: 3.2 };
const PREF_KEY = 'cd.touchpad';

export function openTouchpad({ button, conns }) {
  const target = conns.stateFor(button.target);
  let speed = 'normal';
  try { speed = localStorage.getItem(PREF_KEY) ?? 'normal'; } catch {}

  const surface = h('div', { class: 'touchpad', role: 'application', 'aria-label': 'Superficie del touchpad' },
    h('span', { class: 'touchpad-hint' }, 'Un dedo mueve · toca para clic · dos dedos: clic derecho o desplazar'));
  const send = (ev) => {
    if (!conns.pointer(button, ev)) status.textContent = 'Sin conexión con la computadora';
  };
  const status = h('span', { class: 'hint' }, target ? `Controlando ${target.agent.name}` : 'No hay ninguna computadora conectada');

  // --- Gestos
  const pointers = new Map();
  let pending = { dx: 0, dy: 0, sx: 0, sy: 0 };
  let gesture = null; // { start, maxFingers, moved }
  let frame = 0;
  let dragging = false;

  function flush() {
    frame = 0;
    if (pending.dx || pending.dy) send({ op: 'move', dx: pending.dx, dy: pending.dy });
    if (pending.sx || pending.sy) send({ op: 'scroll', dx: pending.sx, dy: pending.sy });
    pending = { dx: 0, dy: 0, sx: 0, sy: 0 };
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };

  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) gesture = { start: Date.now(), maxFingers: 0, moved: 0 };
    gesture.maxFingers = Math.max(gesture.maxFingers, pointers.size);
  });

  surface.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (gesture) gesture.moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 1) {
      // Aceleración suave: los movimientos rápidos recorren más pantalla.
      const factor = SPEEDS[speed] * (1 + Math.min(Math.hypot(dx, dy), 40) / 25);
      pending.dx += dx * factor;
      pending.dy += dy * factor;
    } else if (pointers.size === 2) {
      // Cada dedo aporta la mitad; desplazamiento "natural" como en macOS e iPadOS.
      pending.sx += dx / 2;
      pending.sy += dy / 2;
    }
    schedule();
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size > 0 || !gesture) return;
    const quick = Date.now() - gesture.start < 260 && gesture.moved < 10;
    if (quick) {
      send({ op: 'click', button: gesture.maxFingers >= 2 ? 'right' : 'left' });
      haptic(8);
    }
    gesture = null;
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);

  // --- Teclado
  // El campo siempre conserva un espacio: así el teclado de la tablet tiene algo que borrar y
  // cada borrado llega como evento aunque no haya nada escrito.
  const KEEP = ' ';
  const kb = h('input', { type: 'text', class: 'kb-input', value: KEEP, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'enter', 'aria-label': 'Escribe aquí para escribir en la computadora' });
  let queue = Promise.resolve();
  let textBuf = '';
  let textTimer = null;
  let composing = false;
  const run = (action) => {
    queue = queue.then(async () => {
      const results = await conns.run({ ...button, label: 'Teclado', action }, { confirm: async () => false }).catch((err) => [{ ok: false, error: err.message }]);
      const bad = results.find((r) => !r.ok);
      if (bad) toast(bad.error, true);
    });
  };
  const flushText = () => { clearTimeout(textTimer); textTimer = null; if (textBuf) { run({ type: 'text', text: textBuf, raw: true }); textBuf = ''; } };
  const typeText = (t) => { if (!t) return; textBuf += t; if (textBuf.length >= 200) flushText(); else if (!textTimer) textTimer = setTimeout(flushText, 60); };
  const key = (keys, extra = {}) => { flushText(); run({ type: 'hotkey', keys, ...extra }); haptic(4); };
  const reset = () => { kb.value = KEEP; try { kb.setSelectionRange(1, 1); } catch {} };
  kb.addEventListener('compositionstart', () => { composing = true; });
  kb.addEventListener('compositionend', (e) => { composing = false; typeText(e.data); reset(); });
  kb.addEventListener('beforeinput', (e) => {
    if (composing || e.inputType === 'insertCompositionText') return;
    e.preventDefault();
    if (e.inputType === 'insertText' || e.inputType === 'insertReplacementText' || e.inputType === 'insertFromPaste') typeText(e.data ?? e.dataTransfer?.getData('text/plain') ?? '');
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') key('enter');
    else if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteWordBackward') (e.inputType === 'deleteWordBackward' ? key('ctrl+backspace', { mac: 'alt+backspace' }) : key('backspace'));
    else if (e.inputType === 'deleteContentForward') key('delete');
    reset();
  });
  // Por si el navegador no avisa antes de cambiar el texto.
  kb.addEventListener('input', () => { if (!composing && kb.value !== KEEP) { typeText(kb.value.replace(/^ /, '')); reset(); } });
  const SPECIAL = { Tab: 'tab', Escape: 'escape', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Backspace: 'backspace' };
  kb.addEventListener('keydown', (e) => {
    if (composing || !(e.key in SPECIAL)) return;
    // Enter y borrar ya llegan como beforeinput con el teclado de pantalla; con teclado físico
    // también, salvo con modificadores.
    if ((e.key === 'Enter' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) return;
    e.preventDefault();
    const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'mod'].filter(Boolean);
    key([...mods, SPECIAL[e.key]].join('+'));
  });
  const arrows = h('div', { class: 'kb-keys' }, ...[['escape', 'Esc'], ['tab', 'Tab'], ['left', '←'], ['up', '↑'], ['down', '↓'], ['right', '→']]
    .map(([k, label]) => h('button', { class: 'btn small', type: 'button', onpointerdown: (e) => e.preventDefault(), onclick: () => { key(k); kb.focus(); } }, label)));
  const kbBox = h('div', { class: 'kb-box', hidden: true }, kb, arrows,
    h('p', { class: 'hint' }, 'Lo que escribas aquí se escribe en la computadora. Mantén el teclado abierto mientras escribes.'));
  const kbBtn = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => toggleKeyboard() }, '⌨️ Teclado');
  function toggleKeyboard(on = kbBox.hidden) {
    kbBox.hidden = !on;
    kbBtn.setAttribute('aria-pressed', String(on));
    kbBtn.classList.toggle('primary', on);
    if (on) { reset(); kb.focus(); } else { flushText(); kb.blur(); }
  }

  // --- Botones de apoyo
  const dragBtn = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => {
    dragging = !dragging;
    dragBtn.setAttribute('aria-pressed', String(dragging));
    dragBtn.classList.toggle('primary', dragging);
    send({ op: dragging ? 'down' : 'up' });
  } }, 'Mantener presionado');
  const speedSeg = segmented([['lenta', 'Lenta'], ['normal', 'Normal'], ['rapida', 'Rápida']], speed, (v) => {
    speed = v;
    try { localStorage.setItem(PREF_KEY, v); } catch {}
  });

  const sheet = openSheet([
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, status, speedSeg.element),
    kbBox,
    surface,
    h('div', { class: 'actions touchpad-actions' },
      h('button', { class: 'btn', onclick: () => send({ op: 'click', button: 'left' }) }, 'Clic'),
      h('button', { class: 'btn', onclick: () => send({ op: 'click', button: 'right' }) }, 'Clic derecho'),
      dragBtn, kbBtn),
  ], { title: button.label || 'Touchpad', onClose: () => { flushText(); if (dragging) send({ op: 'up' }); cancelAnimationFrame(frame); } });
  sheet.element.classList.add('sheet-touchpad');
  if (button.action?.keyboard) toggleKeyboard(true);
  return sheet;
}

