// Notificaciones de la computadora en la tablet. Mientras hay tablets conectadas, revisa cada
// pocos segundos las notificaciones nuevas (en Mac, los avisos en pantalla; en Windows, el
// historial del sistema) y los contadores de las apps (Mac). Solo se envían a tablets emparejadas,
// por el canal cifrado, y se pueden apagar en el panel.

const POLL_MS = 2500;
const BADGE_EVERY = 4; // cada 10 s
const KEEP = 30;

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function createNotifier({ driver, hub, store, intervalMs = POLL_MS }) {
  const supported = typeof driver.notifications === 'function';
  const recent = [];
  const seen = new Map();
  let badges = [];
  let cursor = null;
  let timer = null;
  let ticks = 0;
  let busy = false;
  let closed = false;

  const allowed = () => store.getPolicy().allow.notifications !== false;

  async function readBadges() {
    if (!driver.badges) return badges;
    const list = await driver.badges().catch(() => null);
    if (!Array.isArray(list)) return badges;
    return list.filter((b) => b && b.app && b.count).slice(0, 40).map((b) => ({ app: clip(b.app, 60), count: clip(b.count, 8) }));
  }

  function setBadges(next) {
    const before = JSON.stringify(badges);
    const prev = badges;
    badges = next;
    if (JSON.stringify(next) !== before) hub.broadcast({ k: 'badges', badges });
    return prev;
  }

  async function poll() {
    if (busy || !allowed()) return;
    busy = true;
    try {
      ticks += 1;
      const r = await driver.notifications(cursor).catch(() => null);
      if (r) cursor = r.cursor ?? cursor;
      const now = Date.now();
      for (const [k, t] of seen) if (now - t > 15 * 60_000) seen.delete(k);
      const fresh = [];
      for (const n of r?.items ?? []) {
        const key = clip(n.key, 80);
        if (!key || seen.has(key)) continue;
        seen.set(key, now);
        const item = { id: key, app: clip(n.app, 60), title: clip(n.title, 120), body: clip(n.body, 300), at: new Date().toISOString() };
        if (!item.title && !item.body) continue;
        fresh.push(item);
      }
      if (fresh.length || ticks % BADGE_EVERY === 1) {
        const prev = setBadges(await readBadges());
        // En Mac el aviso no dice de qué app es: si justo subió el contador de una sola app, es esa.
        const missing = fresh.filter((n) => !n.app);
        if (missing.length) {
          const up = badges.filter((b) => { const p = prev.find((x) => x.app === b.app); return !p || Number(b.count) > Number(p.count) || (isNaN(Number(b.count)) && b.count !== p.count); });
          if (up.length === 1) for (const n of missing) n.app = up[0].app;
        }
      }
      if (fresh.length) {
        recent.unshift(...fresh.reverse());
        recent.length = Math.min(recent.length, KEEP);
        hub.broadcast({ k: 'notifs', items: fresh });
      }
    } finally {
      busy = false;
    }
  }

  return {
    supported,
    update(hasClients) {
      const want = supported && !closed && hasClients;
      if (want && !timer) { timer = setInterval(poll, intervalMs); timer.unref?.(); poll(); }
      if (!want && timer) { clearInterval(timer); timer = null; }
    },
    snapshot: () => (allowed() ? { items: recent.slice(), badges: badges.slice() } : { items: [], badges: [], off: true }),
    clear() { recent.length = 0; },
    poll,
    close() { closed = true; if (timer) clearInterval(timer); timer = null; },
  };
}

// Nombre legible a partir del identificador de app de Windows (AUMID).
// "CartasecPte.Ltd.CanaryMailApp_1h5es61sgwc0a!App" → "Canary Mail"; "...\\chrome.exe" → "chrome".
export function appFromAumid(id) {
  let s = String(id ?? '').split('!')[0];
  s = s.split(/[\\/]/).pop();
  s = s.replace(/_[a-z0-9]{13}$/i, '');
  s = s.replace(/\.exe(\.\d+)?$/i, '');
  const known = { chrome: 'Google Chrome', msedge: 'Microsoft Edge', brave: 'Brave', firefox: 'Firefox', outlook: 'Outlook', teams: 'Teams', microsoftteams: 'Teams', msteams: 'Teams', canarymail: 'Canary Mail', slack: 'Slack', whatsapp: 'WhatsApp', windows: 'Windows' };
  const parts = s.split('.').filter((p) => p && !/^(microsoft|com|ltd|inc|pte|app|desktop|exe|\d+|\{.*\})$/i.test(p));
  let name = parts.pop() ?? s;
  if (known[name.toLowerCase()]) return known[name.toLowerCase()];
  name = name.replace(/(App|Desktop)$/, '') || name;
  return known[name.toLowerCase()] ?? name;
}

// Textos de un aviso de Windows (XML del "toast"): el primero es el título, el resto el cuerpo.
export function parseToast(xml) {
  const texts = [...String(xml ?? '').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
    .trim()).filter(Boolean);
  return { title: texts[0] ?? '', body: texts.slice(1).join(' · ') };
}
