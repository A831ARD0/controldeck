// Ventanas en vivo: mientras alguna tablet tiene abierta la pestaña Ventanas, el agente relee la
// lista en segundo plano y le manda solo los cambios. Así la tablet no espera cada vez que
// pregunta y ve al momento lo que pasa en la computadora (cambiar de pestaña, abrir, cerrar).

const GAP_MS = 1000;

export function createWindowsWatcher({ executor, gapMs = GAP_MS }) {
  const watchers = new Set();
  let last = null; // { json, windows }
  let running = false;
  let wake = null;
  let closed = false;

  async function loop() {
    if (running) return;
    running = true;
    try {
      while (watchers.size && !closed) {
        try {
          const windows = await executor.windowsSnapshot();
          const json = JSON.stringify(windows);
          if (json !== last?.json) {
            last = { json, windows };
            for (const s of watchers) s.send({ k: 'windows', windows });
          }
        } catch (err) {
          for (const s of watchers) s.send({ k: 'windows', error: String(err.message ?? err).slice(0, 300) });
          last = null;
        }
        await new Promise((resolve) => { wake = resolve; setTimeout(resolve, gapMs).unref?.(); });
        wake = null;
      }
    } finally {
      running = false;
    }
  }

  return {
    add(session) {
      watchers.add(session);
      if (last) session.send({ k: 'windows', windows: last.windows });
      loop();
    },
    remove(session) { watchers.delete(session); if (!watchers.size) last = null; },
    // Después de mover o mostrar una ventana: releer ya en lugar de esperar la pausa.
    kick() { wake?.(); },
    close() { closed = true; watchers.clear(); wake?.(); },
  };
}
