// Editor de botones con vista previa en vivo, plantillas y editor de páginas.

import { h, openSheet, field, segmented, toast } from './ui.js';
import { icon, ACTION_ICONS } from './icons.js';
import { renderKey } from './keyview.js';
import { PRESET_CATEGORIES, SWATCHES, EMOJIS } from './presets.js';
import { validateButton, parseKeys, formatKeys, MEDIA_CMDS, POWER_CMDS, LIMITS, STAT_METRICS, CYCLE_MAX, WINDOW_OPS, WINDOW_OP_NAMES } from '/shared/actions.js';

const TYPES = [
  ['hotkey', 'Atajo'], ['text', 'Escribir texto'], ['open', 'Abrir'], ['media', 'Multimedia'],
  ['power', 'Energía'], ['script', 'Script'], ['multi', 'Secuencia'],
  ['clipboard', 'Pasar lo copiado'], ['wake', 'Encender otra'],
  ['cycle', 'Varios estados'], ['stat', 'Dato en vivo'], ['volume', 'Deslizador de volumen'], ['touchpad', 'Touchpad'],
  ['window', 'Acomodar ventana'], ['windows', 'Lista de ventanas'],
];
const STAT_LABELS = { cpu: 'Procesador', ram: 'Memoria', battery: 'Batería', app: 'App al frente', clock: 'Hora', music: 'Música' };
const MEDIA_LABELS = { playpause: 'Reproducir / pausa', next: 'Siguiente', prev: 'Anterior', volup: 'Subir volumen', voldown: 'Bajar volumen', mute: 'Silenciar' };
const MEDIA_ICONS = { playpause: '⏯️', next: '⏭️', prev: '⏮️', volup: '🔊', voldown: '🔉', mute: '🔇' };
const POWER_LABELS = { lock: 'Bloquear', sleep: 'Suspender', restart: 'Reiniciar', shutdown: 'Apagar' };
const MODS = [['mod', '⌘ / Ctrl', 'Cmd en Mac, Ctrl en Windows'], ['shift', '⇧ Shift'], ['alt', '⌥ Alt'], ['ctrl', '⌃ Control'], ['win', 'Win']];
const MOD_ALIAS = { cmd: 'win', meta: 'win', option: 'alt' };

// Traduce una tecla física (KeyboardEvent.code) al nombre que entiende ControlDeck.
const CODE_NAMES = { Enter: 'enter', NumpadEnter: 'enter', Tab: 'tab', Space: 'space', Escape: 'escape', Backspace: 'backspace', Delete: 'delete',
  Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left',
  ArrowRight: 'right', PrintScreen: 'printscreen', Minus: 'minus', Equal: 'equal', Comma: 'comma', Period: 'period', Slash: 'slash',
  Semicolon: 'semicolon', Quote: 'quote', BracketLeft: 'bracketleft', BracketRight: 'bracketright', Backslash: 'backslash', Backquote: 'grave' };
function codeToKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
  return CODE_NAMES[code] ?? null;
}

const select = (options, value) => h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

export function openButtonEditor({ button, isNew, agents, osFor, onSave, onDelete, onDuplicate, onMove }) {
  const draft = structuredClone(button);
  draft.action ??= { type: 'hotkey', keys: '' };
  const err = h('div', { class: 'form-error', role: 'alert' });
  const previewBox = h('div');
  let readAction = () => draft.action;
  let stopRecording = () => {};

  function currentButton() {
    return { ...draft, action: readAction() };
  }
  function refreshPreview() {
    const b = currentButton();
    previewBox.replaceChildren(renderKey(b, { os: osFor(b.target), as: 'div' }));
  }

  // --- Nombre y destino
  const label = h('input', { type: 'text', value: draft.label ?? '', maxlength: String(LIMITS.label), placeholder: 'Ej. Copiar', oninput: () => { draft.label = label.value; refreshPreview(); } });
  const targetOptions = [['focus', 'Donde trabajo', 'focus'], ['all', 'Todas', 'all'], ...agents.filter((a) => a.id).map((a) => [a.id, a.name, 'pin'])];
  const target = segmented(targetOptions, draft.target ?? 'focus', (v) => { draft.target = v; refreshPreview(); });
  const targetField = field('Dónde se ejecuta', target.element);
  // Pasar lo copiado y Encender eligen sus computadoras dentro de la acción.
  const syncTarget = () => { targetField.hidden = ['clipboard', 'wake'].includes(draft.action.type); };

  // --- Apariencia
  const emojiGrid = h('div', { class: 'emojis', role: 'group', 'aria-label': 'Emojis' });
  const renderEmojis = () => emojiGrid.replaceChildren(...EMOJIS.map((e) => h('button', { type: 'button', 'aria-pressed': String(draft.icon === e && !draft.image), onclick: () => { draft.icon = e; draft.image = ''; renderEmojis(); refreshPreview(); } }, e)));
  renderEmojis();
  const customEmoji = h('input', { type: 'text', maxlength: '8', placeholder: 'Otro', value: EMOJIS.includes(draft.icon) ? '' : (draft.icon ?? ''), oninput: () => { draft.icon = customEmoji.value.trim(); draft.image = ''; renderEmojis(); refreshPreview(); } });

  const swatchRow = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Color' });
  const colorInput = h('input', { type: 'color', value: draft.color ?? '#3e63dd', 'aria-label': 'Color personalizado', oninput: () => { draft.color = colorInput.value; renderSwatches(); refreshPreview(); } });
  const renderSwatches = () => swatchRow.replaceChildren(
    ...SWATCHES.map((c) => { const b = h('button', { type: 'button', class: 'swatch', 'aria-label': c, 'aria-pressed': String(draft.color?.toLowerCase() === c), onclick: () => { draft.color = c; renderSwatches(); refreshPreview(); } }); b.style.background = c; return b; }),
    h('span', { class: `swatch custom`, 'aria-pressed': String(!!draft.color && !SWATCHES.includes(draft.color.toLowerCase())) }, colorInput));
  renderSwatches();

  const imageInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', class: 'sr' });
  const imageBtns = h('div', { class: 'actions', style: { justifyContent: 'flex-start', marginTop: '8px' } });
  const renderImageBtns = () => imageBtns.replaceChildren(...[
    h('button', { type: 'button', class: 'btn small', onclick: () => imageInput.click() }, icon('image', { size: 16 }), draft.image ? 'Cambiar imagen' : 'Usar una imagen'),
    draft.image ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { draft.image = ''; renderImageBtns(); refreshPreview(); } }, 'Quitar imagen') : null,
    imageInput].filter(Boolean));
  imageInput.addEventListener('change', () => {
    const f = imageInput.files?.[0];
    imageInput.value = '';
    if (!f) return;
    if (f.size > LIMITS.imageBytes) { err.textContent = 'La imagen pesa más de 96 KB. Usa una más pequeña.'; return; }
    const reader = new FileReader();
    reader.onload = () => { draft.image = String(reader.result); err.textContent = ''; renderImageBtns(); refreshPreview(); };
    reader.readAsDataURL(f);
  });
  renderImageBtns();

  // --- Acción
  const actionBox = h('div');
  const typeTiles = h('div', { class: 'tiles', role: 'group', 'aria-label': 'Tipo de acción' });
  const renderTypeTiles = () => typeTiles.replaceChildren(...TYPES.map(([t, l]) => h('button', {
    type: 'button', class: 'tile', 'aria-pressed': String(draft.action.type === t),
    onclick: () => { if (draft.action.type === t) return; stopRecording(); draft.action = { type: t }; renderTypeTiles(); renderAction(); syncTarget(); refreshPreview(); },
  }, icon(ACTION_ICONS[t], { size: 20 }), l)));
  renderTypeTiles();

  function renderAction() {
    const a = draft.action;
    const onAny = () => refreshPreview();
    switch (a.type) {
      case 'hotkey': {
        let parsed = { mods: [], key: '' };
        try { parsed = parseKeys(a.keys); } catch {}
        const mods = new Set(parsed.mods.map((m) => MOD_ALIAS[m] ?? m));
        const keyInput = h('input', { type: 'text', value: parsed.key, placeholder: 'C', maxlength: '12', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Tecla' });
        const modRow = h('div', { class: 'combo' });
        const preview = h('div', { class: 'preview-os' });
        const mac = h('input', { type: 'text', value: a.mac ?? '', placeholder: 'cmd+shift+z', autocapitalize: 'off', spellcheck: 'false' });
        const win = h('input', { type: 'text', value: a.win ?? '', placeholder: 'ctrl+y', autocapitalize: 'off', spellcheck: 'false' });
        const compose = () => [...MODS.map(([m]) => m).filter((m) => mods.has(m)), keyInput.value.trim().toLowerCase()].join('+');
        readAction = () => ({ type: 'hotkey', keys: compose(), mac: mac.value.trim() || undefined, win: win.value.trim() || undefined });
        const renderPreview = () => {
          const act = readAction();
          const show = (os) => { const caps = formatKeys(act, os); return caps.length ? caps.map((c) => h('span', { class: 'cap' }, c)) : h('span', { class: 'hint' }, '—'); };
          preview.replaceChildren(
            h('span', {}, h('span', { class: 'os-l' }, 'Mac'), show('mac')),
            h('span', {}, h('span', { class: 'os-l' }, 'Windows'), show('win')));
          refreshPreview();
        };
        const renderMods = () => modRow.replaceChildren(
          ...MODS.map(([m, l, title]) => h('button', { type: 'button', class: 'mod', title: title ?? l, 'aria-pressed': String(mods.has(m)), onclick: () => { mods.has(m) ? mods.delete(m) : mods.add(m); renderMods(); renderPreview(); } }, l)),
          h('span', { class: 'plus' }, '+'), keyInput, rec);
        const rec = h('button', { type: 'button', class: 'rec', onclick: () => (recording ? stop() : startRec()) }, icon('record', { size: 14 }), 'Grabar');
        let recording = false;
        const onKey = (e) => {
          if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
          e.preventDefault();
          const k = codeToKey(e.code);
          if (!k) return;
          mods.clear();
          if (e.metaKey) mods.add('mod');
          if (e.ctrlKey) mods.add(e.metaKey ? 'ctrl' : 'mod');
          if (e.altKey) mods.add('alt');
          if (e.shiftKey) mods.add('shift');
          keyInput.value = k;
          stop();
          renderMods(); renderPreview();
        };
        function startRec() { recording = true; rec.classList.add('on'); rec.lastChild.textContent = 'Presiona las teclas…'; window.addEventListener('keydown', onKey, true); }
        function stop() { recording = false; rec.classList.remove('on'); rec.lastChild.textContent = 'Grabar'; window.removeEventListener('keydown', onKey, true); }
        stopRecording = stop;
        keyInput.addEventListener('input', renderPreview);
        mac.addEventListener('input', renderPreview);
        win.addEventListener('input', renderPreview);
        renderMods();
        renderPreview();
        actionBox.replaceChildren(
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Combinación'), modRow,
            h('div', { class: 'hint' }, 'Elige modificadores y escribe la tecla (letra, número, F1–F24, enter, tab, esc, left…). Con un teclado físico conectado, toca Grabar y presiona el atajo.')),
          preview,
          h('details', {}, h('summary', { class: 'hint', style: { cursor: 'pointer', marginTop: '12px' } }, 'Usar un atajo distinto en Mac o en Windows'),
            h('div', { class: 'row' }, field('Solo en Mac', mac), field('Solo en Windows', win))));
        break;
      }
      case 'text': {
        const text = h('textarea', { maxlength: String(LIMITS.text), placeholder: 'Saludos cordiales,' });
        text.value = a.text ?? '';
        readAction = () => ({ type: 'text', text: text.value });
        text.addEventListener('input', onAny);
        const insert = (v) => { const s = text.selectionStart ?? text.value.length; text.setRangeText(v, s, text.selectionEnd ?? s, 'end'); text.focus(); onAny(); };
        actionBox.replaceChildren(field('Texto que se escribirá', text),
          h('div', { class: 'combo' }, h('span', { class: 'hint' }, 'Insertar:'),
            ...['fecha', 'hora', 'portapapeles'].map((v) => h('button', { type: 'button', class: 'mod', onclick: () => insert(`{${v}}`) }, `{${v}}`))));
        break;
      }
      case 'open': {
        const t = h('input', { type: 'text', value: a.target ?? '', placeholder: 'https://… · Excel · /ruta/archivo', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' });
        const fresh = h('input', { type: 'checkbox', class: 'switch', checked: a.newTab === true });
        const freshRow = h('label', { class: 'check-row' }, fresh, 'Abrir siempre una pestaña nueva');
        const syncFresh = () => { freshRow.hidden = !/^https?:/i.test(t.value.trim()); };
        readAction = () => ({ type: 'open', target: t.value.trim(), ...(fresh.checked && !freshRow.hidden ? { newTab: true } : {}) });
        t.addEventListener('input', () => { syncFresh(); onAny(); });
        fresh.addEventListener('change', onAny);
        syncFresh();
        actionBox.replaceChildren(field('Qué abrir', t, 'Una página web (https://…), el nombre de una app o la ruta completa de un archivo. Si la página ya está abierta, se muestra esa pestaña.'), freshRow);
        break;
      }
      case 'media': {
        let cmd = MEDIA_CMDS.includes(a.cmd) ? a.cmd : 'playpause';
        const tiles = h('div', { class: 'tiles' });
        const render = () => tiles.replaceChildren(...MEDIA_CMDS.map((m) => h('button', { type: 'button', class: 'tile', 'aria-pressed': String(cmd === m), onclick: () => { cmd = m; render(); onAny(); } }, h('span', { style: { fontSize: '22px' } }, MEDIA_ICONS[m]), MEDIA_LABELS[m])));
        readAction = () => ({ type: 'media', cmd });
        render();
        actionBox.replaceChildren(tiles);
        break;
      }
      case 'power': {
        const seg = segmented(POWER_CMDS.map((m) => [m, POWER_LABELS[m]]), POWER_CMDS.includes(a.cmd) ? a.cmd : 'lock', onAny);
        readAction = () => ({ type: 'power', cmd: seg.value });
        actionBox.replaceChildren(seg.element, h('p', { class: 'hint' }, 'Siempre se pide confirmación antes de ejecutarlo.'));
        break;
      }
      case 'script': {
        const n = h('input', { type: 'text', value: a.name ?? '', placeholder: 'respaldo', autocapitalize: 'off', spellcheck: 'false' });
        readAction = () => ({ type: 'script', name: n.value.trim() });
        n.addEventListener('input', onAny);
        actionBox.replaceChildren(field('Nombre del script', n, 'Sin extensión. Debe estar en la carpeta de scripts de la computadora y los scripts deben estar permitidos en su panel.'));
        break;
      }
      case 'clipboard': {
        const named = agents.filter((x) => x.id);
        const from = segmented([['focus', 'Donde trabajo', 'focus'], ...named.map((x) => [x.id, x.name, 'pin'])], a.from ?? 'focus', onAny);
        const to = segmented([['others', 'Las demás', 'all'], ...named.map((x) => [x.id, x.name, 'pin'])], a.to ?? 'others', onAny);
        const paste = segmented([['no', 'Solo copiar'], ['yes', 'Copiar y pegar']], a.paste ? 'yes' : 'no', onAny);
        readAction = () => ({ type: 'clipboard', from: from.value, to: to.value, paste: paste.value === 'yes' });
        actionBox.replaceChildren(field('Desde', from.element), field('Hacia', to.element), field('Al llegar', paste.element,
          'Pasa el texto copiado. “Copiar y pegar” además lo pega donde esté el cursor en la otra computadora.'));
        break;
      }
      case 'wake': {
        const named = agents.filter((x) => x.id && !x.home);
        if (named.length === 0) {
          readAction = () => ({ type: 'wake', agent: '' });
          actionBox.replaceChildren(h('p', { class: 'hint' }, 'Primero agrega y conecta otra computadora en Ajustes. Después podrás encenderla desde aquí cuando esté dormida.'));
          break;
        }
        const pick = segmented(named.map((x) => [x.id, x.name, x.os === 'win' ? 'desktop' : 'laptop']), named.some((x) => x.id === a.agent) ? a.agent : named[0].id, onAny);
        readAction = () => ({ type: 'wake', agent: pick.value });
        actionBox.replaceChildren(field('Computadora', pick.element,
          'Funciona si esa computadora tiene Wake-on-LAN activado, está conectada a la corriente y otra computadora sigue encendida en la misma red.'));
        break;
      }
      case 'cycle': {
        const list = h('div', { class: 'steps' });
        const KINDS = [['hotkey', 'Atajo'], ['text', 'Texto'], ['open', 'Abrir'], ['media', 'Multimedia']];
        const placeholders = { hotkey: 'mod+shift+m', text: 'Hola', open: 'https://…', media: 'mute' };
        const valueOf = (act) => act?.keys ?? act?.text ?? act?.target ?? act?.cmd ?? '';
        const renumber = () => [...list.children].forEach((r, i) => { r.querySelector('.num').textContent = String(i + 1); });
        const addStep = (s = { action: { type: 'hotkey' } }) => {
          if (list.children.length >= CYCLE_MAX) return;
          const name = h('input', { type: 'text', value: s.label ?? '', placeholder: 'Nombre del estado', maxlength: '40' });
          const kind = select(KINDS, s.action?.type ?? 'hotkey');
          const val = h('input', { type: 'text', value: valueOf(s.action), placeholder: placeholders[kind.value] });
          kind.addEventListener('change', () => { val.placeholder = placeholders[kind.value]; onAny(); });
          for (const el of [name, val]) el.addEventListener('input', onAny);
          const row = h('div', { class: 'step' }, h('span', { class: 'num' }), name, kind, val,
            h('button', { class: 'icon-close', type: 'button', 'aria-label': 'Quitar estado', onclick: () => { row.remove(); renumber(); onAny(); } }, icon('close', { size: 16 })));
          row.read = () => {
            const v = val.value.trim();
            const action = kind.value === 'hotkey' ? { type: 'hotkey', keys: v } : kind.value === 'text' ? { type: 'text', text: val.value } : kind.value === 'open' ? { type: 'open', target: v } : { type: 'media', cmd: v };
            return name.value.trim() ? { label: name.value.trim(), action } : { action };
          };
          list.append(row);
          renumber();
        };
        for (const s of a.steps ?? [{ label: 'Encender', action: { type: 'hotkey' } }, { label: 'Apagar', action: { type: 'hotkey' } }]) addStep(s);
        readAction = () => ({ type: 'cycle', steps: [...list.children].map((r) => r.read()) });
        actionBox.replaceChildren(
          h('p', { class: 'hint' }, 'Cada toque ejecuta el siguiente estado y la tecla muestra en cuál va. Útil para cosas que se prenden y apagan con acciones distintas.'),
          list,
          h('button', { class: 'btn small', type: 'button', onclick: () => { addStep(); onAny(); } }, icon('plus', { size: 16 }), 'Agregar estado'));
        break;
      }
      case 'stat': {
        const seg = segmented(STAT_METRICS.map((m) => [m, STAT_LABELS[m]]), STAT_METRICS.includes(a.metric) ? a.metric : 'cpu', onAny);
        readAction = () => ({ type: 'stat', metric: seg.value });
        actionBox.replaceChildren(field('Qué mostrar', seg.element, 'Se actualiza solo cada pocos segundos. La hora es la de esta tablet.'));
        break;
      }
      case 'volume':
        readAction = () => ({ type: 'volume' });
        actionBox.replaceChildren(h('p', { class: 'hint' }, 'La tecla muestra un deslizador con el volumen actual de la computadora. Muévelo para ajustarlo.'));
        break;
      case 'window': {
        const seg = segmented(WINDOW_OPS.map((o) => [o, WINDOW_OP_NAMES[o]]), WINDOW_OPS.includes(a.op) ? a.op : 'left', onAny);
        readAction = () => ({ type: 'window', op: seg.value });
        actionBox.replaceChildren(field('Qué hacer con la ventana activa', seg.element, 'Se aplica a la ventana que esté al frente en la computadora.'));
        break;
      }
      case 'windows':
        readAction = () => ({ type: 'windows' });
        actionBox.replaceChildren(h('p', { class: 'hint' }, 'Al tocarla se abre la lista de ventanas abiertas: toca una para traerla al frente o acomódala con sus botones. También está en la pestaña Ventanas de la barra de abajo.'));
        break;
      case 'touchpad': {
        const kbOn = h('input', { type: 'checkbox', class: 'switch', checked: a.keyboard === true });
        kbOn.addEventListener('change', onAny);
        readAction = () => (kbOn.checked ? { type: 'touchpad', keyboard: true } : { type: 'touchpad' });
        actionBox.replaceChildren(
          h('p', { class: 'hint' }, 'Al tocarla se abre un touchpad: un dedo mueve el cursor, tocar hace clic, dos dedos hacen clic derecho o desplazan. Con "Teclado" escribes en la computadora con el teclado de la tablet.'),
          h('label', { class: 'check-row' }, kbOn, 'Abrir con el teclado a la vista'));
        break;
      }
      case 'multi': {
        const list = h('div', { class: 'steps' });
        const STEP_TYPES = [['hotkey', 'Atajo'], ['text', 'Texto'], ['open', 'Abrir'], ['media', 'Multimedia'], ['delay', 'Pausa (ms)']];
        const renumber = () => [...list.children].forEach((r, i) => { r.querySelector('.num').textContent = String(i + 1); });
        const addStep = (s = { type: 'hotkey' }) => {
          const st = select(STEP_TYPES, s.type);
          const val = h('input', { type: 'text', value: s.keys ?? s.text ?? s.target ?? s.cmd ?? (s.ms !== undefined ? String(s.ms) : ''), placeholder: 'mod+c' });
          const placeholders = { hotkey: 'mod+c', text: 'Hola', open: 'https://…', media: 'playpause', delay: '300' };
          st.addEventListener('change', () => { val.placeholder = placeholders[st.value]; onAny(); });
          val.addEventListener('input', onAny);
          const row = h('div', { class: 'step' }, h('span', { class: 'num' }), st, val,
            h('button', { class: 'icon-close', type: 'button', 'aria-label': 'Quitar paso', onclick: () => { row.remove(); renumber(); onAny(); } }, icon('close', { size: 16 })));
          row.read = () => {
            const v = val.value.trim();
            switch (st.value) {
              case 'hotkey': return { type: 'hotkey', keys: v };
              case 'text': return { type: 'text', text: val.value };
              case 'open': return { type: 'open', target: v };
              case 'media': return { type: 'media', cmd: v };
              default: return { type: 'delay', ms: Number(v) };
            }
          };
          list.append(row);
          renumber();
        };
        for (const s of a.steps ?? [{ type: 'hotkey' }, { type: 'delay', ms: 300 }, { type: 'hotkey' }]) addStep(s);
        readAction = () => ({ type: 'multi', steps: [...list.children].map((r) => r.read()) });
        actionBox.replaceChildren(
          h('p', { class: 'hint' }, `Se ejecutan en orden. En Multimedia escribe: ${MEDIA_CMDS.join(', ')}.`),
          list,
          h('button', { class: 'btn small', type: 'button', onclick: () => { addStep(); onAny(); } }, icon('plus', { size: 16 }), 'Agregar paso'));
        break;
      }
    }
  }
  renderAction();
  syncTarget();
  refreshPreview();

  const m = openSheet([
    h('div', { class: 'editor-top' },
      previewBox,
      h('div', {}, field('Nombre', label), targetField)),
    h('div', { class: 'section-title' }, 'Qué hace'),
    typeTiles,
    h('div', { style: { marginTop: '14px' } }, actionBox),
    h('div', { class: 'section-title' }, 'Apariencia'),
    h('div', { class: 'row', style: { alignItems: 'flex-start' } },
      h('div', { class: 'field', style: { flex: '2', minWidth: '240px' } }, h('span', { class: 'label' }, 'Ícono'), emojiGrid),
      h('div', { class: 'field', style: { flex: '1', minWidth: '120px' } }, h('span', { class: 'label' }, 'Otro emoji'), customEmoji, imageBtns)),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Color'), swatchRow),
    err,
    h('div', { class: 'actions' },
      !isNew ? h('button', { class: 'btn danger', type: 'button', onclick: () => { m.close(); onDelete(); } }, icon('trash', { size: 18 }), 'Eliminar') : null,
      !isNew && onDuplicate ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { m.close(); onDuplicate(); } }, 'Duplicar') : null,
      !isNew && onMove ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { m.close(); onMove(); } }, icon('right', { size: 16 }), 'Mover a otra página') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', type: 'button', onclick: save }, icon('check', { size: 18 }), 'Guardar')),
  ], { title: isNew ? 'Nuevo botón' : 'Editar botón', onClose: () => stopRecording() });

  async function save() {
    const b = currentButton();
    const candidate = { id: b.id, label: (b.label ?? '').trim(), icon: b.icon || undefined, color: b.color, image: b.image || undefined, target: b.target ?? 'focus', action: b.action };
    try {
      if (!candidate.label) throw new Error('Ponle un nombre al botón');
      const valid = validateButton(candidate);
      await onSave(valid);
      m.close();
      toast('Guardado');
    } catch (e) {
      err.textContent = e.message;
    }
  }
}

export function openAddSheet({ osFor, onPick, onCustom, onEditDraft, suggest }) {
  let cat = PRESET_CATEGORIES[0].id;
  const grid = h('div', { class: 'tpl-grid' });
  const renderGrid = () => {
    const c = PRESET_CATEGORIES.find((x) => x.id === cat);
    grid.replaceChildren(...c.items.map((item) => {
      const b = { label: item.label, icon: item.icon, color: c.color, target: item.target ?? 'focus', action: item.action };
      const el = renderKey(b, { os: osFor(b.target) });
      el.addEventListener('click', async () => {
        el.classList.add('pressing');
        try { await onPick(b); } catch (e) { toast(e.message, true); }
        setTimeout(() => el.classList.remove('pressing'), 120);
      });
      return el;
    }));
  };
  const seg = segmented(PRESET_CATEGORIES.map((c) => [c.id, c.name]), cat, (v) => { cat = v; renderGrid(); });
  renderGrid();
  // Crear con IA: describe la tecla y el asistente la arma.
  let aiBox = null;
  if (suggest) {
    const ask = h('input', { type: 'text', placeholder: 'Ej. silenciar el micrófono en Teams', maxlength: '300', enterkeyhint: 'go' });
    const result = h('div', { class: 'ai-result' });
    const go = async () => {
      const prompt = ask.value.trim();
      if (!prompt) return ask.focus();
      goBtn.disabled = true;
      result.replaceChildren(h('div', { class: 'ai-thinking' }, h('div', { class: 'skeleton ai-skel' }),
        h('p', { class: 'hint' }, 'Pensando… La primera vez del día puede tardar hasta un minuto mientras el modelo se carga.')));
      try {
        const b = await suggest(prompt);
        const preview = renderKey(b, { os: osFor('focus'), as: 'div' });
        result.replaceChildren(h('div', { class: 'ai-found' }, preview,
          h('div', { class: 'ai-actions' },
            h('button', { class: 'btn primary', onclick: async () => { try { await onPick(b); result.replaceChildren(h('p', { class: 'hint' }, `“${b.label}” agregado. Describe otra si quieres.`)); ask.value = ''; } catch (e) { toast(e.message, true); } } }, icon('plus', { size: 16 }), 'Agregar'),
            h('button', { class: 'btn', onclick: () => { m.close(); onEditDraft(b); } }, 'Editar antes'),
            h('button', { class: 'btn ghost', onclick: go }, 'Otra vez'))));
      } catch (e) {
        result.replaceChildren(h('p', { class: 'form-error' }, e.message));
      } finally {
        goBtn.disabled = false;
      }
    };
    const goBtn = h('button', { class: 'btn accent', type: 'button', onclick: go }, icon('sparkle', { size: 16 }), 'Crear');
    ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    aiBox = h('div', { class: 'ai-box' },
      h('div', { class: 'section-title', style: { marginTop: '4px' } }, 'Crear con IA'),
      h('div', { class: 'row' }, h('div', { class: 'field' }, ask), h('div', { class: 'field', style: { flex: '0 0 auto', minWidth: '0' } }, goBtn)),
      result,
      h('div', { class: 'section-title' }, 'Plantillas'));
  }

  const m = openSheet([
    aiBox,
    h('p', { class: 'lead' }, 'Toca una plantilla para agregarla. Puedes agregar varias seguidas y cambiarlas después.'),
    h('div', { class: 'tpl-cats', style: { marginTop: '14px' } }, seg.element),
    grid,
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Listo'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); onCustom(); } }, icon('sparkle', { size: 18 }), 'Crear desde cero')),
  ], { title: 'Agregar botón' });
}

export function openPageEditor({ page, isNew, canDelete, currentApp, onSave, onDelete, onMove }) {
  const name = h('input', { type: 'text', value: page.name ?? '', maxlength: String(LIMITS.label), placeholder: 'Ej. Edición de video' });
  const err = h('div', { class: 'form-error', role: 'alert' });
  const apps = [...(page.apps ?? [])];
  const appInput = h('input', { type: 'text', maxlength: '60', placeholder: 'Ej. Excel', autocapitalize: 'off', spellcheck: 'false' });
  const chips = h('div', { class: 'combo' });
  const addApp = (v) => {
    const clean = String(v ?? '').trim();
    if (!clean || apps.some((a) => a.toLowerCase() === clean.toLowerCase())) return;
    if (apps.length >= 10) { err.textContent = 'Máximo 10 apps por página'; return; }
    apps.push(clean);
    renderChips();
  };
  const renderChips = () => chips.replaceChildren(...(apps.length
    ? apps.map((a, i) => h('button', { type: 'button', class: 'mod', 'aria-pressed': 'true', 'aria-label': `Quitar ${a}`, onclick: () => { apps.splice(i, 1); renderChips(); } }, a, ' ✕'))
    : [h('span', { class: 'hint' }, 'Ninguna: esta página no se abre sola.')]));
  renderChips();
  appInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addApp(appInput.value); appInput.value = ''; } });

  const save = async () => {
    if (!name.value.trim()) { err.textContent = 'Escribe un nombre'; return; }
    if (appInput.value.trim()) { addApp(appInput.value); appInput.value = ''; }
    try { await onSave(name.value.trim(), apps); m.close(); } catch (e) { err.textContent = e.message; }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const m = openSheet([
    field('Nombre de la página', name),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Abrir sola cuando esté al frente'), chips,
      h('div', { class: 'row' }, h('div', { class: 'field' }, appInput),
        h('div', { class: 'field', style: { flex: '0 0 auto', minWidth: '0' } }, h('button', { type: 'button', class: 'btn', onclick: () => { addApp(appInput.value); appInput.value = ''; } }, 'Agregar'))),
      currentApp ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => addApp(currentApp) }, icon('plus', { size: 14 }), `Usar la app al frente: ${currentApp}`) : null,
      h('div', { class: 'hint' }, 'Basta con parte del nombre: “Excel” funciona para “Microsoft Excel”.')),
    err,
    h('div', { class: 'actions' },
      !isNew && canDelete ? h('button', { class: 'btn danger', onclick: () => { m.close(); onDelete(); } }, icon('trash', { size: 18 }), 'Eliminar') : null,
      !isNew ? h('button', { class: 'btn ghost', 'aria-label': 'Mover a la izquierda', onclick: () => { m.close(); onMove(-1); } }, icon('left', { size: 18 }), 'Antes') : null,
      !isNew ? h('button', { class: 'btn ghost', 'aria-label': 'Mover a la derecha', onclick: () => { m.close(); onMove(1); } }, 'Después', icon('right', { size: 18 })) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: save }, 'Guardar')),
  ], { title: isNew ? 'Nueva página' : 'Editar página' });
  setTimeout(() => name.focus(), 50);
}


// --- Automatizaciones ------------------------------------------------------------------------

const DAYS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']];
const AUTO_KINDS = [['hotkey', 'Atajo'], ['text', 'Texto'], ['open', 'Abrir'], ['media', 'Multimedia']];

export function describeAutomation(a) {
  if (a.when.type === 'app') return `Cuando ${a.when.app} pase al frente`;
  const days = a.when.days.length === 7 ? 'todos los días' : a.when.days.join(',') === '1,2,3,4,5' ? 'de lunes a viernes' : a.when.days.map((d) => DAYS[d - 1][1]).join(' ');
  return `A las ${a.when.at}, ${days}`;
}

export function openAutomationEditor({ automation, isNew, currentApp, onSave, onDelete }) {
  const a = structuredClone(automation);
  const err = h('div', { class: 'form-error', role: 'alert' });
  const name = h('input', { type: 'text', value: a.name ?? '', maxlength: '40', placeholder: 'Ej. Abrir correo al empezar el día' });

  const whenBox = h('div');
  const appInput = h('input', { type: 'text', value: a.when?.type === 'app' ? a.when.app : '', placeholder: 'Ej. zoom', autocapitalize: 'off', spellcheck: 'false' });
  const timeInput = h('input', { type: 'time', value: a.when?.type === 'time' ? a.when.at : '09:00', class: 'input' });
  const days = new Set(a.when?.type === 'time' ? a.when.days : [1, 2, 3, 4, 5]);
  const dayRow = h('div', { class: 'combo' });
  const renderDays = () => dayRow.replaceChildren(...DAYS.map(([d, l]) => h('button', { type: 'button', class: 'mod', 'aria-pressed': String(days.has(d)), 'aria-label': ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][d - 1], onclick: () => { days.has(d) ? days.delete(d) : days.add(d); renderDays(); } }, l)));
  renderDays();
  const whenSeg = segmented([['app', 'Cuando una app pase al frente'], ['time', 'A una hora']], a.when?.type ?? 'app', () => renderWhen());
  function renderWhen() {
    whenBox.replaceChildren(...(whenSeg.value === 'app'
      ? [field('App', appInput, 'Basta con parte del nombre: "zoom" funciona para "zoom.us".'),
        currentApp ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { appInput.value = currentApp; } }, icon('plus', { size: 14 }), `Usar la app al frente: ${currentApp}`) : null]
      : [field('Hora', timeInput), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Días'), dayRow)]).filter(Boolean));
  }
  renderWhen();

  const act = a.action ?? { type: 'hotkey' };
  const kind = select(AUTO_KINDS, AUTO_KINDS.some(([k]) => k === act.type) ? act.type : 'hotkey');
  const val = h('input', { type: 'text', value: act.keys ?? act.text ?? act.target ?? act.cmd ?? '', autocapitalize: 'off', spellcheck: 'false' });
  const placeholders = { hotkey: 'mod+shift+m', text: 'Buenos días', open: 'https://mail.google.com', media: 'mute' };
  const syncPh = () => { val.placeholder = placeholders[kind.value]; };
  kind.addEventListener('change', syncPh);
  syncPh();

  const m = openSheet([
    field('Nombre', name),
    field('Cuándo', whenSeg.element),
    whenBox,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Qué hace'), h('div', { class: 'step' }, kind, val)),
    h('p', { class: 'hint' }, 'Por seguridad, una automatización no puede apagar, suspender ni ejecutar scripts.'),
    err,
    h('div', { class: 'actions' },
      !isNew ? h('button', { class: 'btn danger', onclick: () => { m.close(); onDelete(); } }, icon('trash', { size: 18 }), 'Eliminar') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: async () => {
        const v = val.value.trim();
        const action = kind.value === 'hotkey' ? { type: 'hotkey', keys: v } : kind.value === 'text' ? { type: 'text', text: val.value } : kind.value === 'open' ? { type: 'open', target: v } : { type: 'media', cmd: v };
        const when = whenSeg.value === 'app' ? { type: 'app', app: appInput.value.trim() } : { type: 'time', at: timeInput.value, days: [...days] };
        try { await onSave({ id: a.id, name: name.value.trim(), enabled: a.enabled !== false, when, action }); m.close(); } catch (e) { err.textContent = e.message; }
      } }, 'Guardar')),
  ], { title: isNew ? 'Nueva automatización' : 'Editar automatización' });
}
