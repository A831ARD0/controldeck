// App de tablet: teclas, computadoras conectadas, páginas, gestos, edición y ajustes.

import { h, openSheet, confirmModal, toast, randomId, field, segmented, haptic } from './ui.js';
import { icon } from './icons.js';
import { createConnections } from './connections.js';
import { renderKey, flash } from './keyview.js';
import { openButtonEditor, openPageEditor, openAddSheet, openAutomationEditor, describeAutomation } from './editor.js';
import { openTouchpad } from './touchpad.js';
import { createWindowsPanel } from './windows.js';
import { matchVoice } from './voice.js';
import { createKeepAwake } from './awake.js';
import { createNotifCenter } from './notifs.js';
import { validateDeck, pageForApp } from '/shared/actions.js';
import { supportLinks, SUPPORT_TIERS } from '/shared/project.js';

const $ = (id) => document.getElementById(id);
const els = { voice: $('voice-btn'), dock: $('dock'), grid: $('grid'), stage: $('stage'), pagebar: $('pagebar'), edit: $('edit-toggle'), settings: $('settings-btn'), done: $('edit-done'), offline: $('offline') };
els.edit.append(icon('edit'));
els.settings.append(icon('sliders'));
els.voice.append(icon('mic'));

// --- Preferencias de esta tablet ----------------------------------------------

const PREFS_KEY = 'cd.prefs';
const prefs = { theme: 'auto', density: 'm', hints: true, autoPages: true, keepAwake: true, notifs: 'banner' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')); } catch {}
function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  root.dataset.density = prefs.density;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
applyPrefs();

// --- Estado ----------------------------------------------------------------------

let deck = null;
let pageId = localStorage.getItem('cd.page');
// Pestaña fija "Ventanas" al final de la barra de páginas; no es una página de botones.
let onWindows = localStorage.getItem('cd.view') === 'windows';
let winPanel = null;
let winShown = false;
let editing = false;
let suppressClickUntil = 0;
let pairSheets = new Map();
let settingsAgents = null;
const startedAt = Date.now();

const conns = createConnections({
  onChange: () => { winPanel?.sync(); renderDock(); syncPairing(); renderSettingsAgents(); renderOffline(); refreshHints(); followApp(); updateLive(); },
  onDeck: (d) => { const first = !deck; deck = d; render(); if (first) followApp(); conns.setWants({ music: d.pages.some((p) => p.buttons.some((b) => b.action?.type === 'stat' && b.action.metric === 'music')) }); },
  onToast: toast,
  onNotifs: (key, items, badges, initial) => notifCenter?.receive(key, items, badges, initial),
  onWindows: (key, p) => winPanel?.receive(key, p),
});
let notifCenter = null;

const currentPage = () => deck ? (deck.pages.find((p) => p.id === pageId) ?? deck.pages[0]) : null;

winPanel = createWindowsPanel({ conns });
notifCenter = createNotifCenter({ conns, button: $('notif-btn'), mode: () => prefs.notifs });
els.stage.append(winPanel.element);

function showView(windows, direction) {
  if (windows && editing) return;
  const changed = windows !== onWindows;
  onWindows = windows;
  try { localStorage.setItem('cd.view', windows ? 'windows' : 'keys'); } catch {}
  els.grid.hidden = windows;
  winPanel.element.hidden = !windows;
  if (windows && !winShown) winPanel.show(); else if (!windows && winShown) winPanel.hide();
  winShown = windows;
  if (changed && direction) {
    const el = windows ? winPanel.element : els.grid;
    el.classList.remove('slide-left', 'slide-right');
    void el.offsetWidth;
    el.classList.add(direction > 0 ? 'slide-left' : 'slide-right');
  }
}

function render() {
  showView(onWindows && !editing);
  renderPagebar();
  renderGrid();
  renderDock();
  renderOffline();
}

// --- Computadoras -----------------------------------------------------------------

const STATUS = { connecting: 'Conectando…', pairing: 'Emparejando…', sas: 'Esperando aprobación', authenticating: 'Verificando…', ready: 'Conectada', closed: 'Sin conexión', error: 'Requiere atención' };
const dotClass = (s) => (s === 'ready' ? 'dot ready' : s === 'error' ? 'dot err' : s === 'closed' ? 'dot' : 'dot wait');

function renderDock() {
  const list = conns.list();
  const focus = conns.focusAgent();
  els.dock.replaceChildren(...list.map((a) => {
    const isFocus = focus?.key === a.key && list.filter((x) => x.live.status === 'ready').length > 1;
    const sub = a.live.status === 'ready' ? (a.live.state?.app ? `${isFocus ? 'En uso · ' : ''}${a.live.state.app}` : 'Conectada')
      : a.live.error?.code === 'pair-closed' ? 'Abre el panel en esa computadora' : STATUS[a.live.status] ?? '';
    return h('button', {
      class: `machine${isFocus ? ' focus' : ''}`,
      'aria-label': `${a.name ?? 'Computadora'}: ${sub}`,
      onclick: () => openAgentDetail(a.key),
    },
    h('span', { class: 'os' }, icon(a.os === 'win' ? 'desktop' : 'laptop', { size: 18 }), h('span', { class: dotClass(a.live.status) })),
    h('span', { class: 'meta' }, h('span', { class: 'name' }, a.name ?? 'Computadora'), h('span', { class: 'sub' }, sub)));
  }));
}

function renderOffline() {
  const list = conns.list();
  const anyReady = list.some((a) => a.live.status === 'ready');
  const busy = list.some((a) => ['sas', 'pairing'].includes(a.live.status));
  const show = !anyReady && !busy && Date.now() - startedAt > 2500;
  els.offline.classList.toggle('show', show);
  if (show) els.offline.replaceChildren(icon('offline', { size: 18 }), h('span', {}, 'Sin conexión con tus computadoras. Revisa que el agente esté abierto y que estén en la misma red; se reconecta solo.'));
}
setTimeout(renderOffline, 2600);

// Sistema del que se muestran los atajos: el de la computadora donde trabajas.
function osFor(target) {
  const list = conns.list();
  if (target && target !== 'focus' && target !== 'all') {
    const a = list.find((x) => x.id === target);
    if (a?.os) return a.os;
  }
  return conns.focusAgent()?.os ?? list.find((a) => a.home)?.os ?? 'mac';
}

// Páginas automáticas: cuando cambia la app al frente de la computadora en uso, abre la página
// asociada a esa app. Solo reacciona a cambios de app, así que navegar a mano no se pelea con esto.
let lastFocusApp = null;
function followApp() {
  const f = conns.focusAgent();
  const app = f ? conns.list().find((a) => a.key === f.key)?.live?.state?.app ?? null : null;
  if (!app || app === lastFocusApp || !deck) return;
  lastFocusApp = app;
  if (!prefs.autoPages || editing || onWindows || document.querySelector('.scrim')) return;
  const page = pageForApp(deck, app);
  const current = currentPage();
  if (page && page.id !== current?.id) {
    goToPage(page.id, deck.pages.indexOf(page) > deck.pages.indexOf(current) ? 1 : -1);
    toast(`${page.name} · ${app} está al frente`);
  }
}

let lastHintOs = null;
function refreshHints() {
  const os = osFor('focus');
  if (os !== lastHintOs) { lastHintOs = os; renderGrid(); }
}

// --- Teclas -------------------------------------------------------------------------

function tagFor(target) {
  if (target === 'all') return { icon: 'all', text: 'Todas' };
  if (target === 'focus' || !target) return null;
  const a = conns.list().find((x) => x.id === target);
  return { icon: 'pin', text: a?.name ?? 'Otra' };
}

function renderGrid(direction) {
  document.body.classList.toggle('editing-mode', editing);
  const page = currentPage();
  if (!page) {
    els.grid.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'skeleton', 'aria-hidden': 'true' })));
    return;
  }
  liveKeys = [];
  const keys = page.buttons.map((b) => {
    const type = b.action?.type;
    const el = renderKey(b, {
      os: osFor(b.target), tag: tagFor(b.target), showHints: prefs.hints,
      as: type === 'volume' ? 'div' : 'button',
      live: type === 'stat' ? statText(b) : type === 'volume' ? conns.stateFor(b.target)?.state?.volume : null,
      cycleIndex: type === 'cycle' ? conns.cycleIndex(b) : 0,
    });
    if (type === 'volume') { el.setAttribute('role', 'group'); wireVolume(el, b); }
    if (type === 'stat' || type === 'volume') liveKeys.push({ b, el });
    wireKey(el, page, b);
    return el;
  });
  if (editing) {
    keys.push(h('button', { class: 'add-key', type: 'button', onclick: () => addButton(page) }, icon('plus'), 'Agregar'));
  } else if (keys.length === 0) {
    keys.push(h('div', { class: 'empty' },
      h('div', { class: 'big' }, icon('grid', { size: 28 })),
      h('h3', {}, 'Página vacía'),
      h('p', {}, 'Agrega tus atajos favoritos desde las plantillas o crea uno desde cero.'),
      h('button', { class: 'btn primary', onclick: () => { setEditing(true); addButton(page); } }, icon('plus', { size: 18 }), 'Agregar botón')));
  }
  els.grid.replaceChildren(...keys);
  if (direction) {
    els.grid.classList.remove('slide-left', 'slide-right');
    void els.grid.offsetWidth;
    els.grid.classList.add(direction > 0 ? 'slide-left' : 'slide-right');
  }
}

function wireKey(el, page, button) {
  let longTimer = null;
  let start = null;
  let drag = null;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    if (editing) {
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      drag = { active: false, offX: e.clientX - r.left, offY: e.clientY - r.top };
      return;
    }
    el.classList.add('pressing');
    longTimer = setTimeout(() => {
      longTimer = null;
      el.classList.remove('pressing');
      suppressClickUntil = Date.now() + 500;
      haptic(25);
      editButton(page, button);
    }, 550);
  });

  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (!editing) {
      if (dist > 10) { clearTimeout(longTimer); longTimer = null; el.classList.remove('pressing'); }
      return;
    }
    if (!drag) return;
    if (!drag.active && dist > 8) { drag.active = true; el.classList.add('dragging'); haptic(8); }
    if (!drag.active) return;
    // ¿Sobre el nombre de otra página? Al soltar, la tecla pasa a esa página.
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const tab = under.find((n) => n.dataset?.page && n.dataset.page !== page.id) ?? null;
    if (tab !== drag.tab) { drag.tab?.classList.remove('drop'); tab?.classList.add('drop'); if (tab) haptic(6); drag.tab = tab; }
    // ¿Sobre qué tecla está el dedo? Mover esta tecla a ese lugar en el DOM.
    const over = under.find((n) => n !== el && n.classList?.contains('key') && n.parentElement === els.grid);
    if (over) {
      const items = [...els.grid.querySelectorAll(':scope > .key')];
      const from = items.indexOf(el);
      const to = items.indexOf(over);
      els.grid.insertBefore(el, from < to ? over.nextSibling : over);
    }
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - drag.offX - r.left}px, ${e.clientY - drag.offY - r.top}px)`;
  });

  const end = (e) => {
    clearTimeout(longTimer);
    longTimer = null;
    el.classList.remove('pressing');
    if (editing && drag) {
      const wasDrag = drag.active;
      const tab = drag.tab;
      drag = null;
      el.classList.remove('dragging');
      el.style.transform = '';
      tab?.classList.remove('drop');
      if (wasDrag && tab) {
        suppressClickUntil = Date.now() + 300;
        moveButton(page.id, button.id, tab.dataset.page);
      } else if (wasDrag) {
        suppressClickUntil = Date.now() + 300;
        const order = [...els.grid.querySelectorAll(':scope > .key')].map((k) => k.dataset.id);
        mutateDeck((d) => {
          const p = d.pages.find((x) => x.id === page.id);
          p.buttons.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        }).catch((err) => { toast(err.message, true); renderGrid(); });
      } else if (e.type === 'pointerup') {
        suppressClickUntil = Date.now() + 300;
        editButton(page, button);
      }
    }
    start = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', () => { if (!editing) { el.classList.remove('pressing'); clearTimeout(longTimer); longTimer = null; } });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('click', () => {
    if (Date.now() < suppressClickUntil || editing) return;
    press(el, button);
  });
}

// --- Datos en vivo y deslizadores -----------------------------------------------------------

let liveKeys = [];

function statText(b) {
  const metric = b.action.metric;
  if (metric === 'clock') return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
  const s = conns.stateFor(b.target)?.state;
  if (!s) return '—';
  if (metric === 'cpu') return s.cpu == null ? '—' : `${s.cpu} %`;
  if (metric === 'ram') return s.ram == null ? '—' : `${s.ram} %`;
  if (metric === 'battery') return s.battery ? `${s.battery.percent} %${s.battery.charging ? ' ⚡' : ''}` : 'Sin batería';
  if (metric === 'app') return s.app || '—';
  if (metric === 'music') return s.music || 'Nada sonando';
  return '—';
}

function updateLive() {
  for (const { b, el } of liveKeys) {
    if (b.action.type === 'stat') {
      const v = el.querySelector('.stat-value');
      const text = statText(b);
      if (v && v.textContent !== text) v.textContent = text;
    } else {
      const slider = el.querySelector('.vol');
      const vol = conns.stateFor(b.target)?.state?.volume;
      if (slider && vol != null && !slider.dataset.dragging) slider.value = String(vol);
    }
  }
}
setInterval(() => { if (liveKeys.some(({ b }) => b.action.metric === 'clock')) updateLive(); }, 15_000);

function wireVolume(el, button) {
  const slider = el.querySelector('.vol');
  let timer = null;
  // Que el deslizador no active los gestos de la tecla (tocar, mantener, deslizar de página).
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click']) slider.addEventListener(ev, (e) => e.stopPropagation());
  slider.addEventListener('pointerdown', () => { slider.dataset.dragging = '1'; });
  const release = () => { delete slider.dataset.dragging; };
  slider.addEventListener('pointerup', release);
  slider.addEventListener('pointercancel', release);
  slider.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      conns.setVolume(button, Number(slider.value)).then((rs) => { for (const r of rs) if (!r.ok) toast(`${r.agent.name}: ${r.error}`, true); }).catch((e) => toast(e.message, true));
    }, 120);
  });
}

async function press(el, button) {
  haptic(10);
  const type = button.action?.type;
  if (type === 'touchpad') return openTouchpad({ button, conns });
  if (type === 'windows') { showView(true, 1); renderPagebar(); return; }
  if (type === 'volume') return;
  if (type === 'stat') {
    const t = conns.stateFor(button.target);
    return toast(t ? `${button.label}: ${statText(button)} · ${t.agent.name}` : 'No hay ninguna computadora conectada', !t);
  }
  try {
    const results = await conns.run(button, { confirm: (msg) => confirmModal(msg, { title: button.label || 'Confirmar', okText: 'Sí, ejecutar', danger: true }) });
    if (results.length === 0) return;
    const failed = results.filter((r) => !r.ok);
    if (type === 'cycle' && failed.length === 0) { renderGrid(); el = els.grid.querySelector(`[data-id="${button.id}"]`) ?? el; }
    flash(el, failed.length === 0);
    if (failed.length) haptic([20, 40, 20]);
    for (const f of failed) toast(`${f.agent.name}: ${f.error}`, true);
  } catch (e) {
    flash(el, false);
    toast(e.message, true);
  }
}

// --- Páginas y deslizamiento ---------------------------------------------------------

function goToPage(id, direction) {
  if (!deck) return;
  if (onWindows) { showView(false, direction); if (id === currentPage()?.id) { renderPagebar(); renderGrid(direction); return; } }
  if (id === currentPage()?.id) return;
  pageId = id;
  try { localStorage.setItem('cd.page', pageId); } catch {}
  renderPagebar();
  renderGrid(direction);
}

function renderPagebar() {
  if (!deck) { els.pagebar.replaceChildren(); return; }
  const page = currentPage();
  const items = deck.pages.map((p, i) => h('button', {
    'aria-current': String(!onWindows && p.id === page.id),
    'data-page': p.id,
    onclick: () => {
      if (Date.now() < suppressClickUntil) return;
      if (editing && p.id === page.id) return editPage(p);
      goToPage(p.id, i > deck.pages.indexOf(page) ? 1 : -1);
    },
  }, p.apps?.length ? icon('sparkle', { size: 14 }) : null, p.name, editing && p.id === page.id ? icon('edit', { size: 14 }) : h('span', { class: 'count' }, String(p.buttons.length))));
  if (editing) { for (const b of items) wireTabDrag(b); items.push(h('button', { class: 'add', onclick: addPage, 'aria-label': 'Agregar página' }, icon('plus', { size: 16 }), 'Página')); }
  else items.push(h('button', { class: 'win-tab', 'aria-current': String(onWindows), onclick: () => { if (!onWindows) { showView(true, 1); renderPagebar(); } } }, icon('windows', { size: 16 }), 'Ventanas'));
  els.pagebar.replaceChildren(...items);
  els.pagebar.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

{
  let s = null;
  els.stage.addEventListener('pointerdown', (e) => { if (!editing && !e.target.closest('.vol')) s = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  els.stage.addEventListener('pointerup', (e) => {
    if (!s || !deck) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const quick = Date.now() - s.t < 700;
    s = null;
    if (quick && Math.abs(dx) > 70 && Math.abs(dy) < 60) {
      const i = onWindows ? deck.pages.length : deck.pages.indexOf(currentPage());
      const j = i + (dx < 0 ? 1 : -1);
      if (j >= 0 && j <= deck.pages.length) {
        suppressClickUntil = Date.now() + 350;
        haptic(6);
        if (j === deck.pages.length) { showView(true, 1); renderPagebar(); } else goToPage(deck.pages[j].id, dx < 0 ? 1 : -1);
      }
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (!deck || document.querySelector('.scrim') || e.target.closest?.('input, textarea, select')) return;
  const i = onWindows ? deck.pages.length : deck.pages.indexOf(currentPage());
  if (e.key === 'ArrowRight' && i === deck.pages.length - 1) { showView(true, 1); renderPagebar(); }
  else if (e.key === 'ArrowRight' && i < deck.pages.length - 1) goToPage(deck.pages[i + 1].id, 1);
  if (e.key === 'ArrowLeft' && i > 0) goToPage(deck.pages[i - 1].id, -1);
});

// --- Edición -----------------------------------------------------------------------------

function setEditing(v) {
  editing = v;
  els.edit.setAttribute('aria-pressed', String(editing));
  render();
}
els.edit.addEventListener('click', () => setEditing(!editing));
els.done.addEventListener('click', () => setEditing(false));

async function mutateDeck(fn) {
  const next = structuredClone(deck);
  fn(next);
  validateDeck(next);
  await conns.saveDeck(next);
}

const editorContext = () => ({ agents: conns.list(), osFor });

function addButton(page) {
  openAddSheet({
    ...editorContext(),
    onPick: (b) => mutateDeck((d) => d.pages.find((p) => p.id === page.id).buttons.push({ ...b, id: randomId('b') }))
      .then(() => toast(`“${b.label}” agregado`)),
    onCustom: () => openButtonEditor({
      ...editorContext(), isNew: true,
      button: { id: randomId('b'), label: '', target: 'focus', color: '#3e63dd', action: { type: 'hotkey', keys: '' } },
      onSave: (b) => mutateDeck((d) => d.pages.find((p) => p.id === page.id).buttons.push(b)),
    }),
    onEditDraft: (draft) => openButtonEditor({
      ...editorContext(), isNew: true,
      button: { ...draft, id: randomId('b') },
      onSave: (b) => mutateDeck((d) => d.pages.find((p) => p.id === page.id).buttons.push(b)),
    }),
    suggest: conns.aiAgent() ? (prompt) => conns.suggest(prompt) : null,
  });
}

// --- Automatizaciones (se guardan y corren en cada computadora) -------------------------------

async function openAutomations(initialKey) {
  const ready = conns.list().filter((a) => a.live.status === 'ready');
  if (ready.length === 0) return toast('Conecta una computadora primero', true);
  let key = ready.some((a) => a.key === initialKey) ? initialKey : ready[0].key;
  const list = h('ul', { class: 'list' });
  const body = h('div');
  let current = [];

  async function load() {
    list.replaceChildren(h('li', {}, h('span', { class: 'hint' }, 'Cargando…')));
    try {
      const r = await conns.requestTo(key, { k: 'automations.get' });
      current = r.automations;
      render(r.lastRun ?? {});
    } catch (e) { list.replaceChildren(h('li', {}, h('span', { class: 'form-error' }, e.message))); }
  }
  async function save(next) {
    const r = await conns.requestTo(key, { k: 'automations.save', automations: next });
    current = r.automations;
    render({});
  }
  function render(lastRun) {
    if (current.length === 0) {
      list.replaceChildren(h('li', {}, h('span', { class: 'hint' }, 'Todavía no hay automatizaciones en esta computadora.')));
      return;
    }
    list.replaceChildren(...current.map((a) => {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked: a.enabled, 'aria-label': `Activar ${a.name}` });
      sw.addEventListener('change', () => save(current.map((x) => (x.id === a.id ? { ...x, enabled: sw.checked } : x))).catch((e) => { toast(e.message, true); sw.checked = !sw.checked; }));
      return h('li', {},
        h('span', { class: 'grow' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, describeAutomation(a) + (lastRun[a.id] ? ` · última vez ${new Date(lastRun[a.id]).toLocaleString()}` : ''))),
        sw,
        h('button', { class: 'btn small', onclick: () => edit(a, false) }, 'Editar'));
    }));
  }
  function edit(a, isNew) {
    const agent = conns.list().find((x) => x.key === key);
    openAutomationEditor({
      automation: a, isNew, currentApp: agent?.live?.state?.app ?? null,
      onSave: (saved) => save(isNew ? [...current, saved] : current.map((x) => (x.id === saved.id ? saved : x))),
      onDelete: async () => {
        if (await confirmModal(`Se eliminará “${a.name}”.`, { title: 'Eliminar automatización', okText: 'Eliminar', danger: true })) save(current.filter((x) => x.id !== a.id)).catch((e) => toast(e.message, true));
      },
    });
  }

  const pick = segmented(ready.map((a) => [a.key, a.name ?? 'Computadora', a.os === 'win' ? 'desktop' : 'laptop']), key, (v) => { key = v; load(); });
  body.append(
    h('p', { class: 'lead' }, 'Acciones que la computadora hace sola, aunque la tablet esté apagada: al abrir una app o a cierta hora.'),
    ready.length > 1 ? field('Computadora', pick.element) : null,
    list,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => edit({ id: randomId('a'), name: '', enabled: true, when: { type: 'app', app: '' }, action: { type: 'hotkey' } }, true) }, icon('plus', { size: 18 }), 'Nueva automatización')));
  openSheet(body, { title: 'Automatizaciones' });
  load();
}

function editButton(page, button) {
  const withPage = (d, fn) => { const p = d.pages.find((x) => x.id === page.id); fn(p, p.buttons.findIndex((x) => x.id === button.id)); };
  openButtonEditor({
    ...editorContext(), button, isNew: false,
    onSave: (b) => mutateDeck((d) => withPage(d, (p, i) => { p.buttons[i] = b; })),
    onMove: deck.pages.length > 1 ? () => pickPageFor(page, button) : null,
    onDuplicate: () => mutateDeck((d) => withPage(d, (p, i) => p.buttons.splice(i + 1, 0, { ...structuredClone(button), id: randomId('b') })))
      .then(() => toast('Botón duplicado')).catch((e) => toast(e.message, true)),
    onDelete: async () => {
      if (await confirmModal(`Se eliminará “${button.label || 'sin nombre'}”.`, { title: 'Eliminar botón', okText: 'Eliminar', danger: true })) {
        mutateDeck((d) => withPage(d, (p, i) => p.buttons.splice(i, 1))).catch((e) => toast(e.message, true));
      }
    },
  });
}

// En modo edición, los nombres de la barra de abajo se arrastran para cambiar el orden.
function wireTabDrag(tab) {
  let start = null;
  let moved = false;
  tab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, id: e.pointerId };
    moved = false;
    try { tab.setPointerCapture(e.pointerId); } catch {}
  });
  tab.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!moved && Math.abs(e.clientX - start.x) < 10) return;
    if (!moved) { moved = true; tab.classList.add('dragging-tab'); haptic(8); }
    const over = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n !== tab && n.dataset?.page && n.parentElement === els.pagebar);
    if (over) {
      const tabs = [...els.pagebar.querySelectorAll('[data-page]')];
      els.pagebar.insertBefore(tab, tabs.indexOf(tab) < tabs.indexOf(over) ? over.nextSibling : over);
    }
  });
  const end = (e) => {
    if (!start) return;
    start = null;
    tab.classList.remove('dragging-tab');
    if (!moved) return;
    e.preventDefault();
    suppressClickUntil = Date.now() + 400;
    const order = [...els.pagebar.querySelectorAll('[data-page]')].map((b) => b.dataset.page);
    mutateDeck((d) => { d.pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); })
      .catch((err) => { toast(err.message, true); renderPagebar(); });
  };
  tab.addEventListener('pointerup', end);
  tab.addEventListener('pointercancel', end);
}

// Pasa una tecla a otra página (al final). La página actual no cambia.
function moveButton(fromId, buttonId, toId) {
  if (fromId === toId) return;
  const to = deck.pages.find((p) => p.id === toId);
  mutateDeck((d) => {
    const from = d.pages.find((p) => p.id === fromId);
    const i = from.buttons.findIndex((b) => b.id === buttonId);
    if (i < 0) return;
    const [b] = from.buttons.splice(i, 1);
    d.pages.find((p) => p.id === toId).buttons.push(b);
  }).then(() => toast(`Movido a “${to?.name ?? 'otra página'}”`)).catch((e) => { toast(e.message, true); renderGrid(); });
}

function pickPageFor(page, button) {
  const others = deck.pages.filter((p) => p.id !== page.id);
  const m = openSheet([
    h('p', { class: 'lead' }, `¿A qué página pasas “${button.label || 'este botón'}”?`),
    h('div', { class: 'page-pick' }, ...others.map((p) => h('button', { class: 'btn', onclick: () => { m.close(); moveButton(page.id, button.id, p.id); } },
      p.name, h('span', { class: 'count' }, String(p.buttons.length))))),
  ], { title: 'Mover a otra página' });
}

function addPage() {
  openPageEditor({
    page: { name: '' }, isNew: true, currentApp: lastFocusApp,
    onSave: async (name, apps) => {
      const id = randomId('p');
      await mutateDeck((d) => d.pages.push({ id, name, buttons: [], ...(apps.length ? { apps } : {}) }));
      goToPage(id, 1);
    },
  });
}

function editPage(page) {
  openPageEditor({
    page, isNew: false, canDelete: deck.pages.length > 1, currentApp: lastFocusApp,
    onSave: (name, apps) => mutateDeck((d) => {
      const p = d.pages.find((x) => x.id === page.id);
      p.name = name;
      if (apps.length) p.apps = apps; else delete p.apps;
    }),
    onDelete: async () => {
      if (await confirmModal(`Se eliminará la página “${page.name}” con sus ${page.buttons.length} botones.`, { title: 'Eliminar página', okText: 'Eliminar', danger: true })) {
        mutateDeck((d) => { d.pages = d.pages.filter((p) => p.id !== page.id); }).catch((e) => toast(e.message, true));
      }
    },
    onMove: (dir) => mutateDeck((d) => {
      const i = d.pages.findIndex((p) => p.id === page.id);
      const j = i + dir;
      if (j >= 0 && j < d.pages.length) [d.pages[i], d.pages[j]] = [d.pages[j], d.pages[i]];
    }).catch((e) => toast(e.message, true)),
  });
}

// --- Emparejamiento --------------------------------------------------------------------

function syncPairing() {
  for (const a of conns.list()) {
    const open = pairSheets.get(a.key);
    if (a.live.status === 'sas' && a.live.sas && !open) {
      const d = a.live.sas;
      const sheet = openSheet(h('div', { class: 'pair' },
        h('div', { class: 'ring' }, icon('shield', { size: 34 })),
        h('h2', {}, `Conectar con ${a.name ?? 'la computadora'}`),
        h('p', { class: 'lead' }, 'Por seguridad, confirma que es tu computadora.'),
        h('div', { class: 'digits', 'aria-label': `Código ${d}` }, [...d.slice(0, 3)].map((c) => h('span', {}, c)), h('span', { class: 'gap' }), [...d.slice(3)].map((c) => h('span', {}, c))),
        h('div', { class: 'steps-mini' },
          h('div', {}, h('b', {}, '1'), h('span', {}, 'En la computadora se abrió el panel de ControlDeck. Si no lo ves, ábrelo con el enlace que mostró el agente.')),
          h('div', {}, h('b', {}, '2'), h('span', {}, 'Revisa que muestre este mismo código.')),
          h('div', {}, h('b', {}, '3'), h('span', {}, 'Toca “Sí, aprobar”. Si el código es distinto, recházalo.')))),
      { center: true, title: undefined });
      pairSheets.set(a.key, sheet);
    } else if (open && a.live.status !== 'sas') {
      open.close();
      pairSheets.delete(a.key);
      if (a.live.status === 'ready' || a.live.status === 'authenticating') { haptic([10, 40, 10]); }
    }
  }
}

function openAgentDetail(key) {
  const a = conns.list().find((x) => x.key === key);
  if (!a) return;
  const err = a.live.error;
  const canRepair = ['identity-changed', 'not-paired', 'pair-rejected', 'pair-expired'].includes(err?.code);
  const m = openSheet([
    h('ul', { class: 'list' },
      h('li', {}, h('span', { class: 'grow' }, h('div', { class: 't' }, 'Estado'), h('div', { class: 's' }, STATUS[a.live.status] ?? a.live.status)), a.home ? h('span', { class: 'badge' }, 'Principal') : null),
      a.live.state?.app ? h('li', {}, h('span', { class: 'grow' }, h('div', { class: 't' }, 'App al frente'), h('div', { class: 's' }, a.live.state.app))) : null,
      h('li', {}, h('span', { class: 'grow' }, h('div', { class: 't' }, 'Sistema'), h('div', { class: 's' }, a.os === 'win' ? 'Windows' : a.os === 'mac' ? 'macOS' : 'Desconocido'))),
      a.fingerprint ? h('li', {}, h('span', { class: 'grow' }, h('div', { class: 't' }, 'Huella de seguridad'), h('div', { class: 's' }, a.fingerprint))) : null),
    a.home ? h('p', { class: 'hint' }, 'La computadora principal guarda tus botones.') : null,
    err ? h('p', { class: 'form-error' }, err.message) : null,
    h('div', { class: 'actions' },
      !a.home ? h('button', { class: 'btn danger', onclick: () => { conns.remove(key); m.close(); } }, icon('trash', { size: 18 }), 'Quitar') : null,
      h('span', { class: 'grow' }),
      canRepair ? h('button', { class: 'btn', onclick: () => { conns.repair(key); m.close(); } }, 'Volver a emparejar') : null,
      a.live.status !== 'ready' && a.macs?.length && !a.home ? h('button', { class: 'btn', onclick: async () => {
        try { await conns.wake(a.key); toast(`Señal enviada a ${a.name}. Puede tardar unos segundos en encender.`); m.close(); } catch (e) { toast(e.message, true); }
      } }, icon('power', { size: 18 }), 'Encender') : null,
      a.live.status !== 'ready' ? h('button', { class: 'btn primary', onclick: () => { conns.reconnect(key); m.close(); } }, 'Reintentar') : null),
  ], { title: a.name ?? 'Computadora' });
}

// --- Ajustes ------------------------------------------------------------------------------

function openSettings() {
  const nameInput = h('input', { type: 'text', value: conns.deviceName, maxlength: '40' });
  const addr = h('input', { type: 'text', placeholder: location.protocol === 'https:' ? 'mi-pc.tailnet.ts.net' : '192.168.1.20', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' });
  const found = h('div');
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr' });
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    try {
      if (f.size > 4 * 1024 * 1024) throw new Error('El archivo es demasiado grande');
      const next = validateDeck(JSON.parse(await f.text()));
      if (await confirmModal(`Se reemplazarán todos tus botones por los de “${f.name}” (${next.pages.length} páginas).`, { title: 'Importar botones', okText: 'Reemplazar', danger: true })) {
        await conns.saveDeck(next);
        toast('Botones importados');
      }
    } catch (e) { toast(`No se pudo importar: ${e.message}`, true); }
    importInput.value = '';
  });

  const theme = segmented([['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], prefs.theme, (v) => { prefs.theme = v; applyPrefs(); });
  const density = segmented([['s', 'Compacto'], ['m', 'Normal'], ['l', 'Grande']], prefs.density, (v) => { prefs.density = v; applyPrefs(); });
  const hints = segmented([['on', 'Mostrar'], ['off', 'Ocultar']], prefs.hints ? 'on' : 'off', (v) => { prefs.hints = v === 'on'; applyPrefs(); renderGrid(); });
  const auto = segmented([['on', 'Activado'], ['off', 'Desactivado']], prefs.autoPages ? 'on' : 'off', (v) => { prefs.autoPages = v === 'on'; applyPrefs(); });
  const awake = segmented([['on', 'Sí'], ['off', 'No']], prefs.keepAwake ? 'on' : 'off', (v) => { prefs.keepAwake = v === 'on'; applyPrefs(); syncWakeLock(); });
  const notifMode = segmented([['banner', 'Aviso discreto'], ['count', 'Solo contador'], ['off', 'Apagadas']], prefs.notifs, (v) => { prefs.notifs = v; applyPrefs(); notifCenter.refresh(); if (v !== 'banner') notifCenter.hideBanner(); });

  settingsAgents = h('ul', { class: 'list' });
  const sheet = openSheet([
    h('div', { class: 'section-title' }, 'Apariencia'),
    field('Tema', theme.element),
    field('Tamaño de las teclas', density.element),
    field('Atajos debajo del nombre', hints.element, 'Muestra las teclas reales (⌘ C en Mac, Ctrl C en Windows) según la computadora en uso.'),
    field('Mantener la pantalla encendida', awake.element, 'Mientras ControlDeck esté abierto y a la vista, la tablet no se apaga sola.'),
    field('Notificaciones de las computadoras', notifMode.element, 'Aviso discreto: una línea arriba que se va sola, sin sonido. Solo contador: únicamente el número en la campana.'),
    field('Cambiar de página según la app', auto.element, 'Si una página tiene apps asociadas (se editan tocando su nombre en modo edición), se abre sola cuando esa app pasa al frente.'),

    h('div', { class: 'section-title' }, 'Computadoras'),
    settingsAgents,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const peers = await conns.discover();
          found.replaceChildren(peers.length
            ? h('ul', { class: 'list' }, peers.map((p) => h('li', {},
              h('span', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, `${p.os === 'mac' ? 'macOS' : 'Windows'}${p.via === 'tailscale' ? ' · Tailscale' : ''}`)),
              h('button', { class: 'btn small accent', onclick: (ev) => { conns.add(p.url); ev.currentTarget.closest('li').remove(); } }, 'Conectar'))))
            : h('p', { class: 'hint' }, 'No encontré otras computadoras con ControlDeck abierto en esta red.'));
        } catch (err) { toast(err.message, true); }
        btn.disabled = false;
      } }, icon('search', { size: 18 }), 'Buscar en la red')),
    found,
    h('div', { class: 'row' }, field('O agrega por dirección', addr),
      h('div', { class: 'field', style: { flex: '0 0 auto', minWidth: '0' } }, h('button', { class: 'btn', onclick: () => {
        try { conns.add(conns.addressToUrl(addr.value)); addr.value = ''; } catch (e) { toast(e.message, true); }
      } }, 'Agregar'))),

    h('div', { class: 'section-title' }, 'Automatizaciones'),
    h('div', { class: 'actions', style: { justifyContent: 'flex-start', marginTop: '0' } },
      h('button', { class: 'btn', onclick: () => openAutomations(conns.focusAgent()?.key) }, icon('repeat', { size: 18 }), 'Administrar automatizaciones')),

    h('div', { class: 'section-title' }, 'Esta tablet'),
    h('div', { class: 'row' }, field('Nombre', nameInput),
      h('div', { class: 'field', style: { flex: '0 0 auto', minWidth: '0' } }, h('button', { class: 'btn', onclick: () => { conns.setDeviceName(nameInput.value); toast('Nombre guardado'); } }, 'Guardar'))),
    h('p', { class: 'hint' }, `Huella de seguridad: ${conns.deviceFingerprint}`),

    h('div', { class: 'section-title' }, 'Respaldo de botones'),
    h('div', { class: 'actions', style: { justifyContent: 'flex-start', marginTop: '0' } },
      h('button', { class: 'btn', onclick: () => {
        if (!deck) return;
        const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: 'controldeck-botones.json' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }, icon('download', { size: 18 }), 'Exportar'),
      h('button', { class: 'btn', onclick: () => importInput.click() }, icon('upload', { size: 18 }), 'Importar'),
      importInput),
    h('p', { class: 'hint' }, 'Consejo: en el navegador usa “Agregar a pantalla de inicio” para abrir ControlDeck como app a pantalla completa.'),
    supportSection(),
  ], { title: 'Ajustes', onClose: () => { settingsAgents = null; } });
  renderSettingsAgents();
  return sheet;
}

// "Invítame un café": solo aparece si el proyecto tiene enlaces para donar (shared/project.js).
function supportSection() {
  const links = supportLinks();
  if (!links.length) return null;
  return h('div', { class: 'support' },
    h('div', { class: 'section-title' }, 'Apoya ControlDeck'),
    h('p', { class: 'hint' }, 'ControlDeck es libre y gratis. Si te sirve, puedes invitar un café:'),
    h('div', { class: 'support-tiers' }, ...SUPPORT_TIERS.map((t) => h('span', { class: 'support-tier' }, h('b', {}, `${t.icon} ${t.name}`), ` ${t.amount} USD`))),
    h('div', { class: 'actions', style: { justifyContent: 'flex-start', marginTop: '0' } },
      ...links.map((l) => h('a', { class: 'btn', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name))));
}

function renderSettingsAgents() {
  if (!settingsAgents) return;
  settingsAgents.replaceChildren(...conns.list().map((a) => h('li', {},
    h('span', { class: 'machine', style: { boxShadow: 'none', background: 'transparent', padding: '0' } },
      h('span', { class: 'os' }, icon(a.os === 'win' ? 'desktop' : 'laptop', { size: 18 }), h('span', { class: dotClass(a.live.status) }))),
    h('span', { class: 'grow' }, h('div', { class: 't' }, a.name ?? a.url), h('div', { class: 's' }, STATUS[a.live.status] ?? a.live.status)),
    a.home ? h('span', { class: 'badge' }, 'Principal') : null,
    h('button', { class: 'btn small', onclick: () => openAgentDetail(a.key) }, 'Detalles'))));
}

let settingsSheet = null;
els.settings.addEventListener('click', () => { if (!settingsSheet || settingsSheet.closed) settingsSheet = openSettings(); });

// --- Funciones que necesitan HTTPS (por ejemplo, abriendo la app por Tailscale) ---------------

// Mantener la pantalla encendida mientras la app está abierta.
const keepAwake = createKeepAwake();
function syncWakeLock() { keepAwake.set(prefs.keepAwake); }
syncWakeLock();

// App instalable y que abre al instante.
if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Comandos de voz: decir el nombre de una tecla la ejecuta; "página Multimedia" cambia de página.
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
if (Recognition && window.isSecureContext) {
  els.voice.hidden = false;
  let listening = null;
  els.voice.addEventListener('click', () => {
    if (listening) { listening.stop(); return; }
    const rec = new Recognition();
    rec.lang = navigator.language?.toLowerCase().startsWith('es') ? navigator.language : 'es-MX';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    listening = rec;
    els.voice.setAttribute('aria-pressed', 'true');
    toast('Te escucho…');
    rec.onresult = (e) => {
      const alts = [...e.results[0]].map((r) => r.transcript);
      const hit = alts.map((a) => matchVoice(deck, a)).find(Boolean);
      if (!hit) return toast(`No encontré “${alts[0]}”`, true);
      if (hit.page && !hit.button) return goToPage(hit.page.id, 1);
      if (hit.page.id !== currentPage()?.id) goToPage(hit.page.id, 1);
      const el = els.grid.querySelector(`[data-id="${hit.button.id}"]`);
      toast(`${hit.button.label}`);
      press(el ?? document.createElement('div'), hit.button);
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('No pude usar el micrófono. Revisa el permiso en Safari.', true); };
    rec.onend = () => { listening = null; els.voice.setAttribute('aria-pressed', 'false'); };
    rec.start();
  });
}

render();
