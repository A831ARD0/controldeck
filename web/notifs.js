// Notificaciones de las computadoras en la tablet, sin estorbar: una campana con contador, un
// aviso pequeño arriba que se va solo (sin sonido) y una lista al tocar la campana. Tocar una
// notificación trae al frente esa app en la computadora.

import { h, openSheet, toast, haptic } from './ui.js';
import { icon } from './icons.js';

const MAX = 50;
const BANNER_MS = 4500;

const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString();
};

export function createNotifCenter({ conns, button, mode = () => 'banner' }) {
  let items = []; // { key, agentKey, agentName, id, app, title, body, at, unread }
  const badges = new Map(); // agentKey -> [{ app, count }]
  let sheet = null;
  let bannerTimer = null;
  let bannerQueue = [];

  const count = h('span', { class: 'bell-count', hidden: true });
  button.append(icon('bell'), count);
  button.addEventListener('click', openPanel);

  const banner = h('button', { class: 'notif-banner', hidden: true, 'aria-live': 'polite', onclick: () => { hideBanner(); openPanel(); } });
  document.body.append(banner);

  const agentName = (key) => conns.list().find((a) => a.key === key)?.name ?? 'Computadora';
  const multi = () => conns.list().filter((a) => a.live.status === 'ready').length > 1;

  function refreshCount() {
    const n = items.filter((i) => i.unread).length;
    count.hidden = n === 0 || mode() === 'off';
    count.textContent = n > 99 ? '99+' : String(n);
    button.setAttribute('aria-label', n ? `Notificaciones, ${n} sin ver` : 'Notificaciones');
    button.hidden = mode() === 'off';
  }

  function hideBanner() { banner.hidden = true; clearTimeout(bannerTimer); bannerQueue = []; }

  function showBanner(fresh) {
    if (mode() !== 'banner' || document.querySelector('.scrim') || document.visibilityState !== 'visible') return;
    bannerQueue.push(...fresh);
    const last = bannerQueue[bannerQueue.length - 1];
    const more = bannerQueue.length - 1;
    banner.replaceChildren(
      h('span', { class: 'nb-app' }, last.app || 'Notificación'),
      h('span', { class: 'nb-text' }, [last.title, last.body].filter(Boolean).join(' — ')),
      ...(more > 0 ? [h('span', { class: 'nb-more' }, `+${more}`)] : []));
    banner.hidden = false;
    banner.classList.remove('in'); void banner.offsetWidth; banner.classList.add('in');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, BANNER_MS);
  }

  // Lo llama connections.js: initial = lo que la computadora ya tenía al conectar (no se avisa).
  function receive(agentKey, list, badgeList, initial = false) {
    if (Array.isArray(badgeList)) { badges.set(agentKey, badgeList); if (sheet && !sheet.closed) renderPanel(); }
    if (!Array.isArray(list) || list.length === 0) return refreshCount();
    const fresh = [];
    for (const n of list) {
      const key = `${agentKey}|${n.id}`;
      if (items.some((i) => i.key === key)) continue;
      const item = { ...n, key, agentKey, agentName: agentName(agentKey), unread: !initial };
      fresh.push(item);
    }
    if (!fresh.length) return refreshCount();
    items = [...fresh, ...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX);
    refreshCount();
    if (sheet && !sheet.closed) { for (const i of items) i.unread = false; refreshCount(); renderPanel(); return; }
    if (!initial) showBanner(fresh);
  }

  // Trae al frente lo que mandó la notificación. Las de un sitio (WhatsApp Web, Gmail…) llegan a
  // nombre del navegador: primero se busca la app web instalada o la pestaña de ese sitio, y
  // nunca se abre una ventana nueva del navegador.
  async function reveal(agentKey, app, n = {}) {
    if (!app && !n.title) return toast('Esta notificación llegó sin el nombre de la app', true);
    haptic(8);
    const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f\u200e\u200f]/g, '').toLowerCase().trim();
    const want = norm(app);
    const text = norm(`${n.title ?? ''} ${n.body ?? ''}`);
    const domains = text.match(/[a-z0-9-]+(\.[a-z0-9-]+)+/g) ?? [];
    // "WhatsApp Web" → "whatsapp"; "Microsoft Edge" → "edge".
    const word = want.replace(/\b(web|app|desktop|microsoft|google)\b/g, '').trim().split(/\s+/)[0] ?? '';
    const isBrowser = /safari|chrome|edge|brave|firefox|opera|vivaldi|chromium/.test(want);
    const go = (id, title, label) => conns.requestTo(agentKey, { k: 'window.do', id, op: 'focus', title }).then(() => toast(`${label} al frente`));
    try {
      const { windows } = await conns.requestTo(agentKey, { k: 'windows.list' });
      const siteHit = (host) => host && domains.some((d) => host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`));
      const wordHit = (v) => word.length >= 3 && !isBrowser && norm(v).includes(word);
      // 1. App web instalada o pestaña del sitio que aparece en la notificación.
      for (const w of windows) if (siteHit(w.site)) return await go(w.id, w.title, w.app);
      for (const w of windows) for (const t of w.tabs ?? []) if (siteHit(t.host)) return await go(t.id, t.title, t.title || t.host);
      // 2. Ventana de esa app.
      const own = windows.find((x) => norm(x.app) === want) ?? windows.find((x) => wordHit(x.app));
      if (own) return await go(own.id, own.title, own.app);
      // 3. App web o pestaña cuyo nombre se parece al de la app ("WhatsApp Web" → web.whatsapp.com).
      for (const w of windows) if (wordHit(w.site) || (w.site && wordHit(w.title))) return await go(w.id, w.title, w.app);
      for (const w of windows) for (const t of w.tabs ?? []) if (wordHit(t.host) || wordHit(t.title)) return await go(t.id, t.title, t.title || t.host);
      // 4. Si es del navegador, cualquier ventana suya (sin abrir otra).
      if (isBrowser) {
        const b = windows.find((x) => norm(x.app).includes(want.split(' ').pop()));
        if (b) return await go(b.id, b.title, b.app);
        return toast('No encontré la ventana de esa notificación', true);
      }
      const os = conns.list().find((a) => a.key === agentKey)?.os;
      if (os === 'mac' && app) {
        const res = await conns.requestTo(agentKey, { k: 'action.run', action: { type: 'open', target: app } });
        if (res.ok === false) throw new Error(res.error);
        return toast(`Abriendo ${app}`);
      }
      toast(`${app || 'Esa app'} no tiene ventanas abiertas`, true);
    } catch (e) { toast(e.message, true); }
  }

  let list = null;
  function renderPanel() {
    if (!list) return;
    const chips = [...badges].flatMap(([key, bs]) => bs.map((b) => ({ key, ...b })));
    const showHost = multi();
    list.replaceChildren(...[
      chips.length ? h('div', { class: 'notif-badges' },
        h('div', { class: 'section-title' }, 'Pendientes en tus apps'),
        h('div', { class: 'chips' }, ...chips.map((c) => h('button', { class: 'chip', onclick: () => reveal(c.key, c.app) },
          c.app, h('b', {}, c.count), showHost ? h('small', {}, agentName(c.key)) : null)))) : null,
      items.length
        ? h('div', { class: 'notif-list' }, ...items.map((n) => h('button', { class: 'notif-row', onclick: () => reveal(n.agentKey, n.app, n) },
          h('div', { class: 'nr-head' }, h('span', { class: 'nr-app' }, n.app || 'Notificación'), h('span', { class: 'nr-time' }, `${showHost ? `${n.agentName} · ` : ''}${ago(n.at)}`)),
          n.title ? h('div', { class: 'nr-title' }, n.title) : null,
          n.body ? h('div', { class: 'nr-body' }, n.body) : null)))
        : h('p', { class: 'hint win-empty' }, 'Sin notificaciones nuevas. Aquí aparecen las que lleguen a tus computadoras mientras ControlDeck esté conectado.'),
    ].filter(Boolean));
  }

  function openPanel() {
    hideBanner();
    if (sheet && !sheet.closed) return;
    for (const i of items) i.unread = false;
    refreshCount();
    list = h('div', { class: 'notif-panel' });
    renderPanel();
    sheet = openSheet([
      list,
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => { items = []; refreshCount(); renderPanel(); } }, icon('trash', { size: 16 }), 'Limpiar')),
    ], { title: 'Notificaciones', onClose: () => { list = null; } });
  }

  refreshCount();
  return { receive, refresh: refreshCount, hideBanner };
}
