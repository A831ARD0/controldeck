// Dibuja una tecla: pozo con ícono o imagen arriba a la izquierda, nombre abajo y, debajo,
// el atajo real como teclitas para el sistema de destino (o una descripción de la acción).

import { h } from './ui.js';
import { icon, ACTION_ICONS } from './icons.js';
import { formatKeys, actionHint } from '/shared/actions.js';

const IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,/;

// live: texto del dato en vivo (teclas de datos) o volumen actual (deslizador).
// cycleIndex: paso actual de una tecla de varios estados.
export function renderKey(button, { os = 'mac', tag = null, showHints = true, as = 'button', live = null, cycleIndex = 0 } = {}) {
  const outer = button.action ?? {};
  const step = outer.type === 'cycle' ? outer.steps[cycleIndex % outer.steps.length] : null;
  const a = step ? step.action : outer;
  const well = h('span', { class: 'well', 'aria-hidden': 'true' });
  if (button.image && IMAGE_RE.test(button.image)) well.append(h('img', { src: button.image, alt: '' }));
  else if (button.icon) well.append(button.icon);
  else well.append(icon(ACTION_ICONS[a.type] ?? 'keyboard', { size: 24 }));

  let detail = null;
  if (outer.type === 'stat') {
    detail = h('span', { class: 'stat-value', 'aria-live': 'polite' }, live ?? '—');
  } else if (outer.type === 'volume') {
    detail = h('input', { type: 'range', class: 'vol', min: '0', max: '100', step: '2', value: String(live ?? 50), 'aria-label': `Volumen de ${button.label || 'la computadora'}` });
  } else if (step) {
    const n = outer.steps.length;
    detail = h('span', { class: 'cycle' },
      h('span', { class: 'dots', 'aria-hidden': 'true' }, outer.steps.map((_, i) => h('i', { class: i === cycleIndex % n ? 'on' : '' }))),
      h('span', { class: 'hint' }, step.label || `Paso ${(cycleIndex % n) + 1} de ${n}`));
  } else if (showHints) {
    if (a.type === 'hotkey') {
      const caps = formatKeys(a, os);
      if (caps.length) detail = h('span', { class: 'caps', 'aria-hidden': 'true' }, caps.map((c) => h('span', { class: 'cap' }, c)));
    } else {
      const hint = actionHint(a);
      if (hint) detail = h('span', { class: 'hint' }, hint);
    }
  }

  const el = h(as, { class: 'key', ...(as === 'button' ? { type: 'button' } : {}), 'aria-label': button.label || 'Botón sin nombre', 'data-id': button.id ?? '' },
    well,
    tag ? h('span', { class: 'tag' }, icon(tag.icon, { size: 13 }), tag.text) : null,
    h('span', { class: 'bottom' },
      button.label ? h('span', { class: 'label' }, button.label) : h('span', { class: 'label hint' }, 'Sin nombre'),
      detail),
    h('span', { class: 'burst', 'aria-hidden': 'true' }),
    h('span', { class: 'handle', 'aria-hidden': 'true' }, icon('grip', { size: 18, stroke: 3 })));
  if (button.color) el.style.setProperty('--c', button.color);
  if (outer.type === 'stat') el.classList.add('key-stat');
  if (outer.type === 'volume') el.classList.add('key-volume');
  return el;
}

export function flash(el, ok) {
  const burst = el.querySelector('.burst');
  burst?.replaceChildren(icon(ok ? 'check' : 'close', { size: 16, stroke: 3 }));
  el.classList.remove('ok', 'err');
  void el.offsetWidth;
  el.classList.add(ok ? 'ok' : 'err');
  setTimeout(() => el.classList.remove('ok', 'err'), 950);
}
