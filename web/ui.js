// Utilidades de interfaz. Todo el texto se inserta como texto (nunca como HTML), así que un
// nombre o etiqueta con código no se ejecuta.

import { icon } from './icons.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const root = () => document.getElementById('modal-root');

// Hoja que sube desde abajo (en pantallas grandes, centrada). `center` la muestra como diálogo.
export function openSheet(content, { title, dismissable = true, center = false, onClose } = {}) {
  const head = title ? h('div', { class: 'sheet-head' },
    h('h2', {}, title),
    dismissable ? h('button', { class: 'icon-close', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close', { size: 18 })) : null) : null;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title ?? 'Diálogo' },
    center ? null : h('div', { class: 'grabber', 'aria-hidden': 'true' }), head, content);
  const scrim = h('div', { class: center ? 'scrim center' : 'scrim' }, sheet);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    sheet.classList.add('closing');
    setTimeout(() => scrim.remove(), 180);
    onClose?.();
  }
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  if (dismissable) scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);

  // Deslizar la hoja hacia abajo desde el agarrador la cierra.
  if (dismissable && !center) {
    let startY = null;
    sheet.addEventListener('pointerdown', (e) => { if (sheet.scrollTop === 0 && e.target.closest('.grabber, .sheet-head')) startY = e.clientY; });
    sheet.addEventListener('pointermove', (e) => { if (startY !== null && e.clientY - startY > 0) sheet.style.transform = `translateY(${e.clientY - startY}px)`; });
    const end = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      if (dy > 90) close(); else sheet.style.transform = '';
    };
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
  }

  root().append(scrim);
  return { close, element: sheet, get closed() { return closed; } };
}

export function confirmModal(message, { title = '¿Seguro?', okText = 'Sí, continuar', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { answered = true; resolve(v); m.close(); };
    const m = openSheet([
      h('p', { class: 'lead' }, message),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => answer(false) }, 'Cancelar'),
        h('button', { class: danger ? 'btn danger' : 'btn primary', onclick: () => answer(true) }, okText)),
    ], { title, center: true, onClose: () => { if (!answered) resolve(false); } });
    m.element.querySelector('.btn.primary, .btn.danger')?.focus();
  });
}

export function toast(message, isError = false) {
  const el = h('div', { class: isError ? 'toast err' : 'toast', role: 'status' }, icon(isError ? 'close' : 'check', { size: 16, stroke: 2.4 }), h('span', {}, message));
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, isError ? 4500 : 2200);
}

export const randomId = (prefix) => prefix + Math.random().toString(36).slice(2, 10);

export function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

// Selector segmentado accesible. options: [[valor, texto, ícono?]]
export function segmented(options, value, onChange) {
  let current = value;
  const wrap = h('div', { class: 'seg', role: 'group' });
  const render = () => wrap.replaceChildren(...options.map(([v, label, ic]) => h('button', {
    type: 'button', 'aria-pressed': String(v === current),
    onclick: () => { current = v; render(); onChange(v); },
  }, ic ? icon(ic, { size: 16 }) : null, label)));
  render();
  return { element: wrap, get value() { return current; }, set value(v) { current = v; render(); } };
}

export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch {}
}
