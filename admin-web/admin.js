// Panel de administración. Solo funciona en esta computadora y con el token que imprime el agente.

import { supportLinks, SUPPORT_TIERS } from '/project.js';

const TOKEN_KEY = 'controldeck.adminToken';
const fromHash = new URLSearchParams(location.hash.slice(1)).get('t');
if (fromHash) {
  sessionStorage.setItem(TOKEN_KEY, fromHash);
  history.replaceState(null, '', location.pathname);
}
const token = sessionStorage.getItem(TOKEN_KEY);
const app = document.getElementById('app');

const TYPE_LABELS = { hotkey: 'Atajos de teclado', text: 'Escribir texto', open: 'Abrir apps y páginas', media: 'Multimedia', power: 'Energía (bloquear, suspender, apagar)', script: 'Scripts de la carpeta de scripts', clipboard: 'Enviar y recibir lo copiado', wake: 'Encender otras computadoras', mouse: 'Mover el mouse (touchpad)', automations: 'Automatizaciones (por app o por hora)', window: 'Ver y acomodar ventanas', notifications: 'Mostrar en la tablet las notificaciones de esta computadora' };

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, body) {
  const res = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Admin-Token': token ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

let state = null;
let lastJson = '';
let diag = null;
let diagJson = '';
let editingName = false;
const openOptional = new Set();
const closedOptional = new Set();

function render() {
  if (!token) {
    app.replaceChildren(h('div', { class: 'error-banner' }, 'Abre el panel con el enlace que muestra el agente al arrancar (incluye un código de acceso).'));
    return;
  }
  if (!state) return;
  const s = state;
  // Una vez abierta, la configuración guiada sigue hasta terminarla (aunque ya haya tablets).
  if (!s.setupDone) wizard.open = true;
  if (wizard.open) return renderWizard(s);
  const osName = s.agent.os === 'mac' ? 'macOS' : 'Windows';

  const nameInput = h('input', { type: 'text', value: s.agent.name, maxlength: '40' });
  const header = h('div', { class: 'hero' },
    h('div', { class: 'logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
    h('div', { class: 'grow' },
      editingName
        ? h('div', { class: 'row' }, nameInput,
          h('button', { class: 'primary', onclick: async () => { await api('/rename', { name: nameInput.value }); editingName = false; lastJson = ''; refresh(); } }, 'Guardar'),
          h('button', { onclick: () => { editingName = false; render(); } }, 'Cancelar'))
        : h('div', { class: 'row' }, h('h1', {}, s.agent.name), h('button', { onclick: () => { editingName = true; render(); } }, 'Renombrar')),
      h('div', { class: 'muted' }, `ControlDeck en ${osName} · huella ${s.agent.fingerprint}`)),
    h('span', { class: 'pill' }, h('span', { class: 'dot' }), s.connected === 1 ? '1 tablet conectada' : `${s.connected} tablets conectadas`));

  const pending = s.pending.length === 0 ? null : h('section', { class: 'card' },
    h('h2', {}, 'Una tablet quiere conectarse'),
    pendingList(s));

  const connect = h('section', { class: 'card' },
    h('h2', {}, 'Conectar una tablet'),
    h('div', { class: 'grid2' },
      s.qr ? h('img', { class: 'qr', src: s.qr, alt: 'Código QR con la dirección para la tablet' }) : h('div'),
      h('div', {},
        h('p', { class: 'first' }, 'Escanea el código con la cámara de la tablet o escribe esta dirección en su navegador. Deben estar en la misma red WiFi.'),
        s.urls.length ? s.urls.map((u) => h('div', {}, h('code', {}, u))) : h('p', { class: 'err' }, 'No se encontró una red local.'),
        h('p', { class: 'note' }, 'Después aparecerá arriba una solicitud con un código de 6 dígitos para aprobar.'))));

  const devices = h('section', { class: 'card' },
    h('h2', {}, 'Tablets con acceso'),
    s.devices.length === 0
      ? h('p', { class: 'muted' }, 'Ninguna todavía.')
      : h('ul', { class: 'list' }, s.devices.map((d) => h('li', {},
        h('div', {}, h('div', { class: 't' }, d.name), h('div', { class: 's' }, d.connections ? `Conectada ahora${d.connections > 1 ? ` · abierta en ${d.connections} lugares (por ejemplo, la app y pestañas de Safari)` : ''} · emparejada ${fmt(d.pairedAt)}` : `Emparejada ${fmt(d.pairedAt)} · última conexión ${d.lastSeen ? fmt(d.lastSeen) : 'nunca'}`)),
        h('button', { class: 'danger', onclick: () => revoke(d) }, 'Quitar acceso')))));

  const policyForm = h('section', { class: 'card' },
    h('h2', {}, 'Qué pueden hacer las tablets aquí'),
    Object.entries(TYPE_LABELS).map(([k, label]) => h('div', { class: 'policy-row' },
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.policy.allow[k], onchange: (e) => savePolicy({ allow: { [k]: e.target.checked } }) }), label),
      k in s.policy.confirm
        ? h('label', { class: 'toggle small' }, h('input', { type: 'checkbox', checked: s.policy.confirm[k], onchange: (e) => savePolicy({ confirm: { [k]: e.target.checked } }) }), 'Pedir confirmación')
        : null)),
    h('p', { class: 'note' }, 'Los scripts solo pueden ejecutar archivos de esta carpeta: ', h('code', {}, s.scriptsDir)),
    h('p', { class: 'note' }, 'Una tablet con acceso puede escribir y usar atajos como si fuera tu teclado. Da acceso solo a tablets tuyas.'));

  const problems = (diag ?? []).filter((c) => !c.ok);
  const checks = !diag ? null : h('section', { class: problems.length ? 'card attention' : 'card' },
    h('h2', {}, problems.length ? 'Antes de conectar la tablet' : 'Todo listo'),
    checkList());

  const ts = s.tailscale;
  let tsBody = null;
  if (ts && !ts.installed) tsBody = h('p', { class: 'muted' }, 'Instala Tailscale en esta computadora y en la tablet para usar ControlDeck desde cualquier lugar, con conexión cifrada y HTTPS.');
  else if (ts && !ts.running) tsBody = h('p', { class: 'muted' }, 'Tailscale está instalado pero desconectado. Ábrelo e inicia sesión.');
  else if (ts && !ts.https) tsBody = h('p', { class: 'muted' }, 'Activa los certificados HTTPS de tu tailnet en la consola de Tailscale (DNS → HTTPS Certificates) y vuelve aquí.');
  else if (ts && !ts.serving) tsBody = h('div', {},
    h('p', { class: 'first' }, `Publica ControlDeck en tu red de Tailscale como ${ts.dnsName}. Solo tus dispositivos de Tailscale pueden abrirlo; no queda en internet.`),
    h('button', { class: 'primary', onclick: (e) => toggleTailscale(e.currentTarget, true) }, 'Activar acceso por Tailscale'));
  else if (ts) tsBody = h('div', { class: 'grid2' },
    h('img', { class: 'qr', src: ts.qr, alt: 'Código QR con la dirección de Tailscale' }),
    h('div', {},
      h('p', { class: 'first' }, 'Desde la tablet con Tailscale encendido, en casa o fuera, abre:'),
      h('div', {}, h('code', {}, ts.url)),
      h('p', { class: 'note' }, 'Carga por HTTPS con certificado válido y viaja cifrada por Tailscale. Solo la ven tus dispositivos de Tailscale.'),
      h('button', { class: 'danger', onclick: (e) => toggleTailscale(e.currentTarget, false) }, 'Desactivar')));
  const aiUrl = h('input', { type: 'text', value: s.ai?.url ?? '', placeholder: 'http://localhost:11434', spellcheck: 'false' });
  const aiModel = h('select', {}, h('option', { value: s.ai?.model ?? '' }, s.ai?.model || 'Elige un modelo…'));
  const aiMsg = h('p', { class: 'note' });
  const aiCard = h('div', {},
    h('p', { class: 'muted' }, 'Desde la tablet describes una tecla ("silenciar el micrófono en Teams") y el asistente la arma. Usa un servidor Ollama de tu red o de Tailscale: nada sale a internet.'),
    h('div', { class: 'row' }, aiUrl,
      h('button', { onclick: async () => {
        aiMsg.textContent = 'Buscando modelos…';
        try {
          const r = await api('/ai/models', { url: aiUrl.value });
          aiModel.replaceChildren(...r.models.map((m) => h('option', { value: m, selected: m === s.ai?.model }, m)));
          aiMsg.textContent = r.models.length ? `${r.models.length} modelos encontrados.` : 'El servidor no tiene modelos de texto.';
        } catch (e) { aiMsg.textContent = `No se pudo conectar: ${e.message}`; }
      } }, 'Buscar modelos'),
      aiModel,
      h('button', { class: 'primary', onclick: async () => {
        try { await api('/ai', { url: aiUrl.value, model: aiModel.value }); aiMsg.textContent = 'Guardado. Las tablets lo verán al reconectarse.'; lastJson = ''; refresh(); } catch (e) { aiMsg.textContent = e.message; }
      } }, 'Guardar')),
    aiMsg);

  // Tailscale y la IA son opcionales: ControlDeck funciona sin ellas en la red local. Se muestran
  // cerradas, salvo que ya estén configuradas.
  const optionalBox = (id, title, summary, configured, body) => {
    const d = h('details', { class: 'optional', open: openOptional.has(id) || (configured && !closedOptional.has(id)) },
      h('summary', {}, h('span', { class: 't' }, title), h('span', { class: 's' }, configured ? 'Configurado' : summary)), body);
    d.addEventListener('toggle', () => {
      if (d.open) { openOptional.add(id); closedOptional.delete(id); } else { openOptional.delete(id); closedOptional.add(id); }
    });
    return d;
  };
  const optional = h('section', { class: 'card' },
    h('h2', {}, 'Opcional'),
    h('p', { class: 'note first' }, 'ControlDeck funciona sin esto en tu red local. Actívalo solo si lo necesitas.'),
    tsBody ? optionalBox('tailscale', 'Usar fuera de casa con Tailscale', 'Conecta la tablet desde cualquier lugar, cifrado y con HTTPS', Boolean(ts?.serving), tsBody) : null,
    optionalBox('ai', 'Asistente de IA con Ollama', 'Describe una tecla con palabras y la arma un modelo de tu red', Boolean(s.ai?.url && s.ai?.model), aiCard));

  const links = supportLinks();
  const support = links.length ? h('section', { class: 'card support' },
    h('h2', {}, 'Apoya ControlDeck'),
    h('p', { class: 'first muted' }, 'ControlDeck es libre y gratis. Si te sirve, puedes invitar un café:'),
    h('div', { class: 'tiers' }, SUPPORT_TIERS.map((t) => h('span', { class: 'tier' }, h('b', {}, `${t.icon} ${t.name}`), ` ${t.amount} USD`))),
    h('div', { class: 'row' }, links.map((l) => h('a', { class: 'button', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name)))) : null;

  const options = h('section', { class: 'card' },
    h('h2', {}, 'Esta computadora'),
    s.autostart !== null ? h('div', { class: 'policy-row' },
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.autostart, onchange: async (e) => {
        try { await api('/autostart', { on: e.target.checked }); } catch (err) { alert(err.message); }
        lastJson = ''; refresh();
      } }), 'Abrir ControlDeck al iniciar sesión')) : null,
    h('div', { class: 'row spaced' }, h('button', { onclick: () => { wizard.open = true; wizard.step = 0; wizard.startDevices = null; render(); } }, 'Ver la configuración guiada')),
    s.canQuit ? h('div', { class: 'row spaced' }, h('button', { class: 'danger', onclick: async () => {
      if (!confirm('¿Cerrar ControlDeck? Las tablets se desconectarán hasta que lo vuelvas a abrir.')) return;
      await api('/quit', {}).catch(() => {});
      app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'ControlDeck se cerró'), h('p', { class: 'muted' }, 'Puedes cerrar esta pestaña. Para volver a usarlo, abre la app ControlDeck.')));
      stopped = true;
    } }, 'Cerrar ControlDeck')) : null);

  const peers = s.peers.length === 0 ? null : h('section', { class: 'card' },
    h('h2', {}, 'Otras computadoras con ControlDeck'),
    h('ul', { class: 'list' }, s.peers.map((p) => h('li', {}, h('div', {}, h('div', { class: 't' }, p.name), h('div', { class: 's' }, `${p.os === 'mac' ? 'macOS' : 'Windows'} · ${p.url}`))))));

  const log = h('section', { class: 'card' },
    h('h2', {}, 'Actividad reciente'),
    s.log.length === 0 ? h('p', { class: 'muted' }, 'Sin acciones todavía.')
      : h('table', {}, h('tbody', {}, s.log.map((e) => h('tr', {},
        h('td', { class: 'muted' }, new Date(e.ts).toLocaleTimeString()),
        h('td', {}, e.device),
        h('td', {}, e.summary),
        h('td', { class: e.ok ? 'ok' : 'err' }, e.ok ? 'Hecho' : e.error))))));

  app.replaceChildren(...[header, pending, checks, connect, devices, policyForm, optional, options, peers, log, support].filter(Boolean));
}

// Solicitudes de tablets esperando aprobación (en el panel y en la configuración guiada).
function pendingList(s) {
  return s.pending.map((p) => h('div', { class: 'pending' },
    h('div', { class: 'row spread' },
      h('div', {},
        h('div', { class: 't' }, p.deviceName, h('span', { class: 'muted from' }, ` · desde ${p.ip}`)),
        h('div', { class: 'digits', 'aria-label': `Código ${p.sas}` }, [...p.sas.slice(0, 3)].map((c) => h('span', {}, c)), h('span', { class: 'gap' }), [...p.sas.slice(3)].map((c) => h('span', {}, c))),
        h('div', { class: 'muted' }, '¿Es el mismo código que muestra la tablet? Si no, recházalo.')),
      h('div', { class: 'row' },
        h('button', { class: 'danger', onclick: () => decide(p.id, 'reject') }, 'Rechazar'),
        h('button', { class: 'approve', onclick: () => decide(p.id, 'approve') }, 'Sí, aprobar')))));
}

// Revisión de permisos y red, con el botón para arreglar lo que se pueda.
function checkList() {
  return h('ul', { class: 'list' }, (diag ?? []).map((c) => h('li', {},
    h('div', { class: 'check' }, h('span', { class: c.ok ? 'mark ok-mark' : 'mark bad-mark', 'aria-hidden': 'true' }, c.ok ? '✓' : '!'),
      h('div', {}, h('div', { class: 't' }, c.title), h('div', { class: 's' }, c.detail))),
    c.fix ? h('button', { class: 'primary', onclick: async () => { await api('/fix', { id: c.fix }); setTimeout(loadDiag, 1500); } }, 'Dar permiso') : null)));
}

// --- Configuración guiada --------------------------------------------------------------
// Aparece la primera vez (sin tablets emparejadas): nombre, permisos, conectar la tablet y
// arranque automático. Se puede saltar y volver a ver desde "Esta computadora".

const wizard = { open: false, step: 0, startDevices: null };
const STEPS = ['Bienvenida', 'Permisos', 'Tablet', 'Listo'];

async function finishWizard() {
  try { await api('/setup', { done: true }); } catch (e) { alert(e.message); return; }
  wizard.open = false;
  wizard.step = 0;
  lastJson = '';
  refresh();
}

function renderWizard(s) {
  const isMac = s.agent.os === 'mac';
  const go = (n) => { wizard.step = n; render(); window.scrollTo(0, 0); };
  if (wizard.startDevices === null) wizard.startDevices = s.devices.length;
  const steps = h('ol', { class: 'steps', 'aria-label': 'Pasos' }, STEPS.map((name, i) => h('li', {
    class: i === wizard.step ? 'now' : i < wizard.step ? 'done' : '', 'aria-current': i === wizard.step ? 'step' : false,
  }, h('span', { class: 'n' }, i < wizard.step ? '✓' : String(i + 1)), h('span', { class: 'l' }, name))));
  const skip = h('button', { class: 'link', onclick: () => { if (confirm('¿Saltar la configuración guiada? Puedes volver a verla desde "Esta computadora".')) finishWizard(); } }, 'Saltar');
  const nav = (...buttons) => h('div', { class: 'wiz-nav' }, wizard.step > 0 ? h('button', { onclick: () => go(wizard.step - 1) }, 'Atrás') : h('span'), h('div', { class: 'row' }, ...buttons));
  let body;

  if (wizard.step === 0) {
    const name = h('input', { type: 'text', value: s.agent.name, maxlength: '40', 'aria-label': 'Nombre de esta computadora' });
    body = [
      h('h1', {}, 'Bienvenido a ControlDeck'),
      h('p', { class: 'lead' }, 'Tu tablet se convierte en un panel de botones para esta computadora: atajos, apps, multimedia, ventanas y más. Lo dejamos listo en tres pasos.'),
      h('label', { class: 'field' }, h('span', { class: 't' }, '¿Cómo se llama esta computadora?'), name,
        h('span', { class: 's' }, 'Así la verás en la tablet. Por ejemplo: "Mac de la oficina" o "PC de juegos".')),
      nav(h('button', { class: 'primary', onclick: async () => {
        const v = name.value.trim();
        if (v && v !== s.agent.name) { try { await api('/rename', { name: v }); s.agent.name = v; lastJson = ''; } catch (e) { return alert(e.message); } }
        go(1);
      } }, 'Empezar')),
    ];
  } else if (wizard.step === 1) {
    const problems = (diag ?? []).filter((c) => !c.ok);
    body = [
      h('h1', {}, problems.length ? 'Faltan unos permisos' : 'Los permisos están listos'),
      h('p', { class: 'lead' }, !problems.length && diag
        ? 'ControlDeck ya puede usar el teclado y el mouse cuando tocas un botón en la tablet.'
        : isMac
        ? 'macOS pide permiso para que ControlDeck pueda usar el teclado y el mouse cuando tocas un botón en la tablet. Toca "Dar permiso", activa ControlDeck en la lista que se abre y vuelve aquí.'
        : 'Windows puede preguntar si ControlDeck puede recibir conexiones de tu red. Acepta para redes privadas (la de tu casa u oficina).'),
      diag ? checkList() : h('p', { class: 'muted' }, 'Revisando…'),
      h('p', { class: 'note' }, 'Esta lista se actualiza sola cada pocos segundos.'),
      nav(h('button', { class: 'primary', onclick: () => go(2) }, problems.length ? 'Continuar de todos modos' : 'Continuar')),
    ];
  } else if (wizard.step === 2) {
    const added = s.devices.length > wizard.startDevices ? s.devices[s.devices.length - 1] : null;
    const ts = s.tailscale;
    body = [
      h('h1', {}, added ? `¡${added.name} está conectada!` : 'Conecta tu tablet'),
      added
        ? h('p', { class: 'lead' }, 'Ya puedes usarla. En la tablet toca "Agregar a pantalla de inicio" (en Safari, desde el botón Compartir) para abrir ControlDeck como una app.')
        : [
          h('div', { class: 'grid2' },
            s.qr ? h('img', { class: 'qr', src: s.qr, alt: 'Código QR con la dirección para la tablet' }) : h('div'),
            h('div', {},
              h('ol', { class: 'howto' },
                h('li', {}, 'Conecta la tablet a la misma red WiFi que esta computadora.'),
                h('li', {}, 'Escanea el código con la cámara de la tablet, o escribe en su navegador:'),
                s.urls.length ? s.urls.slice(0, 2).map((u) => h('div', {}, h('code', {}, u))) : h('p', { class: 'err' }, 'No se encontró una red local.'),
                h('li', {}, 'En la tablet aparecerá un código de 6 dígitos. Compáralo con el de aquí abajo y aprueba.')))),
          s.pending.length ? pendingList(s) : h('div', { class: 'waiting' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Esperando a la tablet…'),
          ts?.serving ? h('p', { class: 'note' }, `¿Fuera de casa? Con Tailscale en la tablet abre ${ts.url}`) : null,
        ],
      nav(added
        ? h('button', { class: 'primary', onclick: () => go(3) }, 'Continuar')
        : h('button', { onclick: () => go(3) }, 'Lo hago después')),
    ];
  } else {
    const auto = s.autostart !== null ? h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.autostart, onchange: async (e) => {
      try { await api('/autostart', { on: e.target.checked }); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
      lastJson = '';
    } }), 'Abrir ControlDeck al iniciar sesión (recomendado)') : null;
    body = [
      h('h1', {}, 'Todo listo'),
      auto,
      h('ul', { class: 'tips' },
        h('li', {}, h('b', {}, 'Agregar botones: '), 'en la tablet toca "Editar" y luego "+". Puedes elegir atajos, apps, páginas web, multimedia y más.'),
        h('li', {}, h('b', {}, 'Varias computadoras: '), 'instala ControlDeck en cada una y conecta la misma tablet. Cada botón puede ir a la computadora que estés usando.'),
        h('li', {}, h('b', {}, 'Volver a este panel: '), isMac ? 'abre la app ControlDeck otra vez (desde Spotlight o Aplicaciones).' : 'menú Inicio → ControlDeck.')),
      nav(h('button', { class: 'primary', onclick: finishWizard }, 'Ir al panel')),
    ];
  }

  app.replaceChildren(h('div', { class: 'wizard' },
    h('div', { class: 'wiz-top' }, h('div', { class: 'logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), steps, skip),
    h('section', { class: 'card wiz-card' }, ...body.flat().filter(Boolean))));
}

const fmt = (iso) => new Date(iso).toLocaleString();

async function decide(id, what) {
  try { await api(`/pair/${id}/${what}`, {}); } catch (e) { alert(e.message); }
  refresh();
}
async function revoke(d) {
  if (!confirm(`¿Quitar el acceso de "${d.name}"? Tendrá que emparejarse de nuevo.`)) return;
  try { await api(`/device/${d.id}/revoke`, {}); } catch (e) { alert(e.message); }
  refresh();
}
async function savePolicy(patch) {
  const next = { allow: { ...state.policy.allow, ...(patch.allow ?? {}) }, confirm: { ...state.policy.confirm, ...(patch.confirm ?? {}) } };
  try { await api('/policy', { policy: next }); } catch (e) { alert(e.message); }
  refresh();
}

let failures = 0;
let stopped = false;

async function toggleTailscale(btn, on) {
  btn.disabled = true;
  btn.textContent = on ? 'Activando…' : 'Desactivando…';
  try { await api('/tailscale', { on }); } catch (e) { alert(e.message); }
  lastJson = '';
  refresh();
}

async function loadDiag() {
  if (!token || stopped) return;
  try {
    const r = await api('/diagnostics');
    const j = JSON.stringify(r.checks);
    if (j !== diagJson) { diagJson = j; diag = r.checks; if (state) render(); }
  } catch {}
}

async function refresh() {
  if (!token || stopped) return token ? undefined : render();
  if (document.hidden && state) return;
  try {
    const next = await api('/state');
    failures = 0;
    // Solo redibujar si algo cambió (y nunca mientras se edita el nombre), para no perder clics ni texto.
    const json = JSON.stringify(next);
    if (json === lastJson && app.firstElementChild?.className !== 'error-banner') return;
    // No redibujar mientras se escribe o se elige algo, para no perderlo.
    if (document.activeElement?.matches('input[type=text], select')) return;
    lastJson = json;
    state = next;
    render();
  } catch (e) {
    if (++failures >= 2) app.replaceChildren(h('div', { class: 'error-banner' }, e.message === 'Token inválido' ? 'El código de acceso ya no es válido. Abre el enlace nuevo que muestra el agente.' : 'No hay conexión con el agente. ¿Está abierto?'));
  }
}

refresh();
loadDiag();
setInterval(loadDiag, 10_000);
setInterval(refresh, 1500);

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
