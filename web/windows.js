// Pestaña de ventanas: lista lo que está abierto en una computadora; tocar una ventana la trae al
// frente, y los botones la acomodan (mitades, centro, maximizar, minimizar).

import { h, toast, segmented, haptic } from './ui.js';
import { icon } from './icons.js';

const OPS = [
  ['left', 'win-left', 'Mitad izquierda'],
  ['right', 'win-right', 'Mitad derecha'],
  ['center', 'win-center', 'Al centro'],
  ['maximize', 'win-max', 'Maximizar'],
  ['minimize', 'win-min', 'Minimizar'],
];

// Vista que vive dentro de la página principal. Mientras se ve, la computadora manda la lista en
// vivo ("windows.watch"); `sync()` se llama cada vez que cambian las conexiones. Lo que tocas se
// marca al instante, sin esperar a la computadora.
export function createWindowsPanel({ conns }) {
  let key = null;
  let windows = [];
  let query = '';
  let loading = false;
  let again = false;
  let visible = false;
  let readyKeys = null;
  let lastApp = null;
  let timer = null;
  let watched = null; // computadora que nos está mandando la lista en vivo
  let lastPush = 0;
  let optimistic = null; // { until, fn }: lo que se tocó, mientras la computadora lo confirma
  const cache = new Map(); // última lista de cada computadora, para mostrarla al instante
  const open = new Set(); // ventanas de navegador con las pestañas desplegadas

  const list = h('div', { class: 'win-list', role: 'list' });
  const activeBar = h('div', { class: 'win-active' });
  const pickWrap = h('div', { class: 'win-pick' });
  const search = h('input', { type: 'search', class: 'win-search', placeholder: 'Buscar ventana o app', 'aria-label': 'Buscar ventana o app', autocomplete: 'off' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  const refreshBtn = h('button', { class: 'btn small ghost', 'aria-label': 'Actualizar', onclick: () => load() }, icon('repeat', { size: 16 }), 'Actualizar');
  const content = h('div', { class: 'win-content' }, activeBar, h('div', { class: 'win-tools' }, search, refreshBtn), list);
  const empty = h('div', { class: 'empty win-none' },
    h('div', { class: 'big' }, icon('windows', { size: 28 })),
    h('h3', {}, 'Sin computadora conectada'),
    h('p', {}, 'Conecta una computadora para ver sus ventanas abiertas.'));
  const element = h('div', { class: 'win-panel', 'aria-label': 'Ventanas abiertas' },
    h('div', { class: 'win-head' }, h('h2', {}, 'Ventanas abiertas'), pickWrap),
    content, empty);

  const ready = () => conns.list().filter((a) => a.live.status === 'ready');
  const appOf = (k) => ready().find((a) => a.key === k)?.live?.state?.app ?? null;

  function watch(on) {
    const want = on && visible && key && document.visibilityState === 'visible' ? key : null;
    if (watched && watched !== want) conns.sendTo(watched, { k: 'windows.watch', on: false });
    if (want) conns.sendTo(want, { k: 'windows.watch', on: true });
    watched = want;
  }

  function apply(next) {
    let ws = next;
    if (optimistic && Date.now() < optimistic.until) ws = optimistic.fn(structuredClone(ws));
    cache.set(key, next);
    if (JSON.stringify(ws) === JSON.stringify(windows)) return;
    windows = ws;
    render();
  }

  function receive(k, p) {
    if (k !== key) { if (Array.isArray(p.windows)) cache.set(k, p.windows); return; }
    lastPush = Date.now();
    if (p.error) { windows = []; list.replaceChildren(h('p', { class: 'form-error' }, p.error)); return; }
    if (Array.isArray(p.windows)) apply(p.windows);
  }

  // Cómo queda la lista justo después de tocar algo.
  function predict(target, op) {
    return (ws) => {
      const tabOwner = target?.id?.startsWith('t:') ? ws.find((w) => w.tabs?.some((t) => t.id === target.id)) : null;
      const win = tabOwner ?? (target ? ws.find((w) => w.id === target.id) : ws.find((w) => w.active));
      if (!win) return ws;
      if (op === 'minimize') { win.minimized = true; win.active = false; return ws; }
      for (const w of ws) w.active = false;
      win.active = true;
      win.minimized = false;
      if (tabOwner) for (const t of tabOwner.tabs) t.active = t.id === target.id;
      return ws;
    };
  }

  async function load() {
    if (!visible || !key) return;
    if (loading) { again = true; return; }
    loading = true;
    refreshBtn.disabled = true;
    if (windows.length === 0) list.replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'win-row skeleton-row', 'aria-hidden': 'true' })));
    const asked = key;
    try {
      const r = await conns.requestTo(asked, { k: 'windows.list' });
      if (asked === key) apply(r.windows);
    } catch (e) {
      if (asked === key) list.replaceChildren(h('p', { class: 'form-error' }, e.message));
    } finally {
      loading = false;
      refreshBtn.disabled = false;
      if (again) { again = false; load(); }
    }
  }

  async function act(w, op) {
    haptic(8);
    const fn = predict(w, op);
    optimistic = { until: Date.now() + 2500, fn };
    windows = fn(structuredClone(windows));
    render();
    try {
      await conns.requestTo(key, { k: 'window.do', id: w ? w.id : 'front', op, title: w?.title ?? '' });
      if (!watched) setTimeout(load, 300);
    } catch (e) {
      optimistic = null;
      toast(e.message, true);
      load();
    }
  }

  function opButtons(w, small) {
    return h('div', { class: small ? 'win-ops small' : 'win-ops' }, ...OPS.map(([op, ic, label]) => h('button', {
      class: 'win-op', 'aria-label': `${label}${w ? `: ${w.title || w.app}` : ''}`, title: label,
      onclick: (e) => { e.stopPropagation(); act(w, op); },
    }, icon(ic, { size: small ? 18 : 22 }), small ? null : h('span', {}, label))));
  }

  function render() {
    const active = windows.find((w) => w.active);
    activeBar.replaceChildren(
      h('div', { class: 'win-active-head' },
        h('span', { class: 'label' }, 'Ventana activa'),
        h('span', { class: 'name' }, active ? `${active.app} · ${active.title || 'sin título'}` : 'La que esté al frente')),
      opButtons(null, false));

    const hit = (text) => text.toLowerCase().includes(query);
    const tabHit = (t) => hit(`${t.title} ${t.host ?? ''}`);
    const shown = windows.filter((w) => !query || hit(`${w.app} ${w.title}`) || w.tabs?.some(tabHit));
    if (shown.length === 0) {
      list.replaceChildren(h('p', { class: 'hint win-empty' }, windows.length ? 'Ninguna ventana coincide con la búsqueda.' : 'No hay ventanas abiertas, o la pantalla de esa computadora está bloqueada.'));
      return;
    }
    // Agrupadas por app, en el orden en que aparecen (la de arriba es la más reciente).
    const groups = new Map();
    for (const w of shown) { if (!groups.has(w.app)) groups.set(w.app, []); groups.get(w.app).push(w); }
    list.replaceChildren(...[...groups].map(([app, ws]) => h('section', { class: 'win-group' },
      h('h3', {}, app || 'App', h('span', { class: 'count' }, String(ws.length))),
      ...ws.map((w) => h('div', { class: `win-row${w.active ? ' active' : ''}${w.minimized ? ' min' : ''}`, role: 'listitem' },
        h('button', { class: 'win-main', onclick: () => act(w, 'focus'), 'aria-label': `Mostrar ${w.title || app}` },
          h('span', { class: 'win-title' }, w.title || 'Sin título'),
          h('span', { class: 'win-sub' }, w.active ? 'Al frente' : w.minimized ? 'Minimizada' : 'Toca para mostrarla')),
        opButtons(w, true),
        w.tabs ? tabList(w, query ? w.tabs.filter(tabHit) : w.tabs) : null)))));
  }

  function tabList(w, tabs) {
    const expanded = open.has(w.id) || (query && tabs.length > 0);
    const toggle = h('button', { class: 'win-tabs-toggle', 'aria-expanded': String(expanded),
      onclick: () => { if (open.has(w.id)) open.delete(w.id); else open.add(w.id); render(); } },
    icon('right', { size: 14 }), `${w.tabs.length} ${w.tabs.length === 1 ? 'pestaña' : 'pestañas'}`);
    return h('div', { class: 'win-tabs' }, toggle, expanded ? h('div', { class: 'win-tab-list' }, ...tabs.map((t) => h('button', {
      class: `win-tab-row${t.active ? ' active' : ''}`, onclick: () => act(t, 'focus'), 'aria-label': `Mostrar pestaña ${t.title}`,
    }, h('span', { class: 'win-title' }, t.title || 'Sin título'), t.host ? h('span', { class: 'win-sub' }, t.host) : null))) : null);
  }

  function switchTo(k) {
    key = k;
    windows = cache.get(k) ?? [];
    optimistic = null;
    lastApp = appOf(k);
    if (windows.length) render();
    watch(true);
    if (!windows.length) load();
  }

  function sync() {
    const r = ready();
    const keys = r.map((a) => `${a.key}:${a.name}`).join('|');
    if (keys !== readyKeys) {
      readyKeys = keys;
      if (!r.some((a) => a.key === key)) {
        const focus = conns.focusAgent();
        const next = r.some((a) => a.key === focus?.key) ? focus.key : r[0]?.key ?? null;
        watched = null;
        if (next) switchTo(next); else { key = null; windows = []; }
      } else if (visible) {
        // Se reconectó: hay que volver a pedir la lista en vivo.
        watched = null;
        watch(true);
      }
      pickWrap.replaceChildren(r.length > 1
        ? segmented(r.map((a) => [a.key, a.name ?? 'Computadora', a.os === 'win' ? 'desktop' : 'laptop']), key, switchTo).element
        : r.length === 1 ? h('span', { class: 'win-host' }, icon(r[0].os === 'win' ? 'desktop' : 'laptop', { size: 16 }), r[0].name ?? 'Computadora') : '');
      content.hidden = !key;
      empty.hidden = Boolean(key);
    }
    lastApp = key ? appOf(key) : null;
  }

  document.addEventListener('visibilitychange', () => { if (visible) watch(document.visibilityState === 'visible'); });

  return {
    element,
    receive,
    show() {
      visible = true;
      sync();
      if (key) { windows = windows.length ? windows : cache.get(key) ?? []; if (windows.length) render(); else load(); }
      watch(true);
      lastPush = Date.now();
      // Respaldo por si la computadora no manda la lista en vivo (versión anterior del agente).
      clearInterval(timer);
      timer = setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastPush > 6000) { lastPush = Date.now(); load(); } }, 2000);
    },
    hide() { visible = false; watch(false); clearInterval(timer); timer = null; },
    sync,
  };
}
