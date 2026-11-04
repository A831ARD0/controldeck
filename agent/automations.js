// Motor de automatizaciones: ejecuta acciones solas cuando una app pasa al frente o a una hora.
// Pasan por el mismo ejecutor que la tablet (política, límites y registro) con el dispositivo
// "Automatización", así que el panel muestra todo lo que hicieron.

const APP_COOLDOWN_MS = 5_000;
const TICK_MS = 15_000;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function createAutomations({ store, executor, now = () => new Date(), onNeedActivity = () => {} }) {
  const lastRun = new Map();
  let lastApp = null;

  const enabled = () => store.getAutomations().filter((a) => a.enabled);
  const allowed = () => store.getPolicy().allow.automations !== false;

  async function fire(a, why) {
    lastRun.set(a.id, { at: Date.now(), why });
    await executor.run({ action: a.action, confirmed: false, device: { id: 'automatizacion', name: `Automatización: ${a.name}` } });
  }

  // La actividad solo se consulta con tablets conectadas; si hay automatizaciones por app,
  // también hace falta sin tablets.
  function refreshNeeds() {
    onNeedActivity(enabled().some((a) => a.when.type === 'app'));
  }

  function checkTime() {
    if (!allowed()) return;
    const d = now();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const day = d.getDay() === 0 ? 7 : d.getDay(); // 1 = lunes … 7 = domingo
    const key = `${d.toDateString()} ${hhmm}`;
    for (const a of enabled()) {
      if (a.when.type !== 'time' || a.when.at !== hhmm || !a.when.days.includes(day)) continue;
      if (lastRun.get(a.id)?.why === key) continue;
      fire(a, key);
    }
  }
  const timer = setInterval(checkTime, TICK_MS);
  timer.unref?.();

  refreshNeeds();

  return {
    // Lo llama el monitor de actividad cada vez que lee la app al frente.
    onApp(app) {
      if (!app || app === lastApp) return;
      lastApp = app;
      if (!allowed()) return;
      const current = norm(app);
      for (const a of enabled()) {
        if (a.when.type !== 'app') continue;
        const want = norm(a.when.app);
        if (!want || !(current === want || current.includes(want))) continue;
        const prev = lastRun.get(a.id);
        if (prev && Date.now() - prev.at < APP_COOLDOWN_MS) continue;
        fire(a, `app:${app}`);
      }
    },
    changed: refreshNeeds,
    status: () => Object.fromEntries([...lastRun].map(([id, r]) => [id, new Date(r.at).toISOString()])),
    checkTime,
    close() { clearInterval(timer); },
  };
}
