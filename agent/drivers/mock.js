// Controlador de prueba: registra las acciones en lugar de ejecutarlas. Se usa en las pruebas
// automáticas y con `controldeck --dry-run` para probar la tablet sin tocar la computadora.

export function createMockDriver({ os = 'mac' } = {}) {
  const calls = [];
  let clipboard = 'texto del portapapeles';
  let front = 'Simulado';
  const rec = (name) => async (arg) => { calls.push({ name, arg }); };
  return {
    os,
    calls,
    hotkey: rec('hotkey'),
    text: rec('text'),
    open: rec('open'),
    media: async (cmd, value) => { calls.push({ name: 'media', arg: value === undefined ? cmd : { cmd, value } }); },
    power: rec('power'),
    runScript: rec('runScript'),
    frontmostApp: async () => front,
    setFrontmost(name) { front = name; },
    volume: async () => 50,
    nowPlaying: async () => 'Artista — Canción',
    battery: async () => ({ percent: 80, charging: true }),
    pointer: (ev) => { calls.push({ name: 'pointer', arg: ev }); },
    windows: [
      { id: '101:0', app: 'Safari', title: 'Correo — Bandeja de entrada', active: true, minimized: false, tabs: [
        { id: 't:101:7:0', title: 'Correo — Bandeja de entrada', host: 'mail.ejemplo.com', active: true },
        { id: 't:101:7:1', title: 'Calendario', host: 'calendario.ejemplo.com', active: false },
      ] },
      { id: '202:0', app: 'Notas', title: 'Ideas', active: false, minimized: true },
    ],
    async listWindows() { return this.windows; },
    windowDo: async (arg) => { calls.push({ name: 'window', arg }); },
    // Notificaciones: las pruebas agregan con pushNotification; --dry-run inventa una de vez en cuando.
    pending: [],
    badgeList: [{ app: 'Slack', count: '3' }],
    pushNotification(n) { this.pending.push(n); },
    async notifications(cursor) { const items = this.pending.splice(0); return { cursor: (cursor ?? 0) + items.length, items }; },
    async badges() { return this.badgeList; },
    idleMs: async () => 0,
    readClipboard: async () => clipboard,
    writeClipboard: async (t) => { calls.push({ name: 'writeClipboard', arg: t }); clipboard = t; },
    close() {},
  };
}
