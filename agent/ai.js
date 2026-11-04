// Asistente de IA: convierte "silenciar el micrófono en Teams" en una tecla lista para usar.
// Usa un servidor Ollama (en esta computadora o en otra de tu red o tailnet). Nada sale a
// internet. Lo que devuelve el modelo se valida igual que cualquier botón antes de mostrarse.

import { validateButton } from '../shared/actions.js';

const SYSTEM = `Eres el asistente de ControlDeck. Conviertes lo que pide la persona en UNA tecla, como JSON con: label (nombre corto en español, máximo 30 letras), icon (un emoji) y action.
Tipos de action:
- {"type":"hotkey","keys":"mod+shift+s","mac":"...opcional","win":"...opcional"}: "mod" es Cmd en Mac y Ctrl en Windows. Modificadores: mod, ctrl, shift, alt, win. Teclas: a-z, 0-9, f1-f24, enter, tab, space, escape, backspace, delete, up, down, left, right, home, end, pageup, pagedown, minus, equal, comma, period, slash.
- {"type":"text","text":"..."}: escribe texto; variables {fecha}, {hora}, {portapapeles}.
- {"type":"open","target":"https://... o nombre exacto de una app"}
- {"type":"media","cmd":"playpause|next|prev|volup|voldown|mute"}
- {"type":"multi","steps":[acciones..., {"type":"delay","ms":300}]} (máximo 10 pasos)
Usa los atajos reales de la app mencionada. Si en Mac es distinto, ponlo en "mac".
Ejemplos:
Pide: "silenciar el micrófono en Zoom" → {"label":"Micrófono Zoom","icon":"🎙️","action":{"type":"hotkey","keys":"alt+a","mac":"cmd+shift+a"}}
Pide: "abrir gmail" → {"label":"Gmail","icon":"📧","action":{"type":"open","target":"https://mail.google.com"}}
Pide: "copiar y pegar en otra ventana" → {"label":"Copiar y pegar","icon":"🔁","action":{"type":"multi","steps":[{"type":"hotkey","keys":"mod+c"},{"type":"hotkey","keys":"alt+tab","mac":"cmd+tab"},{"type":"delay","ms":300},{"type":"hotkey","keys":"mod+v"}]}}`;

const COLORS = { hotkey: '#3e63dd', text: '#6e56cf', open: '#12a594', media: '#d6409f', multi: '#f76b15' };
const MAX_PROMPT = 300;

export function createAssistant({ store, fetchImpl = globalThis.fetch, timeoutMs = 120_000 }) {
  let busy = Promise.resolve();
  const recent = new Map(); // dispositivo -> marcas de tiempo

  async function chat(messages) {
    const { url, model } = store.getAi();
    // Límite de tiempo que se cancela en cuanto hay respuesta y que no mantiene vivo el agente.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('El modelo tardó demasiado en responder')), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetchImpl(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, format: 'json', think: false, options: { temperature: 0 }, messages }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`El modelo respondió con error ${res.status}`);
      const j = await res.json();
      return String(j.message?.content ?? '');
    } finally {
      clearTimeout(timer);
    }
  }

  function toButton(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('La respuesta no es JSON'); }
    const action = parsed?.action;
    return validateButton({
      id: `ia${Date.now().toString(36)}`,
      label: String(parsed?.label ?? '').slice(0, 40) || 'Nueva tecla',
      icon: typeof parsed?.icon === 'string' ? parsed.icon : undefined,
      color: COLORS[action?.type] ?? '#3e63dd',
      target: 'focus',
      action,
    });
  }

  return {
    get configured() { const { url, model } = store.getAi(); return Boolean(url && model); },

    async suggest({ prompt, os, deviceId = 'local' }) {
      if (!this.configured) throw new Error('El asistente de IA no está configurado en esta computadora (panel → Asistente de IA)');
      const ask = String(prompt ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_PROMPT);
      if (!ask) throw new Error('Describe qué quieres que haga la tecla');
      const now = Date.now();
      const list = (recent.get(deviceId) ?? []).filter((t) => now - t < 60_000);
      if (list.length >= 8) throw new Error('Demasiadas peticiones seguidas; espera un momento');
      list.push(now);
      recent.set(deviceId, list);

      // Una petición a la vez: el modelo suele vivir en una sola tarjeta de video.
      const job = busy.then(async () => {
        const messages = [
          { role: 'system', content: SYSTEM + (os ? `\nLa computadora de destino es ${os === 'win' ? 'Windows' : 'Mac'}.` : '') },
          { role: 'user', content: ask },
        ];
        const first = await chat(messages);
        try {
          return toButton(first);
        } catch (err) {
          // Segundo intento diciéndole qué estuvo mal.
          messages.push({ role: 'assistant', content: first }, { role: 'user', content: `Eso no es válido: ${err.message}. Corrige y responde solo el JSON.` });
          return toButton(await chat(messages));
        }
      });
      busy = job.catch(() => {});
      return job;
    },

    // Para el panel: modelos disponibles en el servidor.
    async models(url = store.getAi().url) {
      if (!url) return [];
      const res = await fetchImpl(`${String(url).replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const j = await res.json();
      return (j.models ?? []).map((m) => m.name).filter((n) => !/embed/i.test(n));
    },
  };
}
