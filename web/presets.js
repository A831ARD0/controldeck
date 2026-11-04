// Plantillas para agregar botones comunes con un toque. Los atajos ya vienen con su versión para
// Mac y para Windows cuando son distintos.

const hk = (keys, extra = {}) => ({ type: 'hotkey', keys, ...extra });

export const PRESET_CATEGORIES = [
  {
    id: 'general', name: 'General', color: '#3e63dd',
    items: [
      { label: 'Copiar', icon: '📋', action: hk('mod+c') },
      { label: 'Pegar', icon: '📥', action: hk('mod+v') },
      { label: 'Cortar', icon: '✂️', action: hk('mod+x') },
      { label: 'Deshacer', icon: '↩️', action: hk('mod+z') },
      { label: 'Rehacer', icon: '↪️', action: hk('mod+y', { mac: 'cmd+shift+z' }) },
      { label: 'Guardar', icon: '💾', action: hk('mod+s') },
      { label: 'Buscar', icon: '🔎', action: hk('mod+f') },
      { label: 'Seleccionar todo', icon: '🔲', action: hk('mod+a') },
      { label: 'Captura de pantalla', icon: '📸', action: hk('win+shift+s', { mac: 'cmd+shift+4' }) },
      { label: 'Cambiar de app', icon: '🔀', action: hk('alt+tab', { mac: 'cmd+tab' }) },
    ],
  },
  {
    id: 'web', name: 'Navegador', color: '#12a594',
    items: [
      { label: 'Nueva pestaña', icon: '➕', action: hk('mod+t') },
      { label: 'Cerrar pestaña', icon: '✖️', action: hk('mod+w') },
      { label: 'Reabrir pestaña', icon: '♻️', action: hk('mod+shift+t') },
      { label: 'Recargar', icon: '🔄', action: hk('mod+r') },
      { label: 'Siguiente pestaña', icon: '⏩', action: hk('ctrl+tab') },
      { label: 'Barra de direcciones', icon: '🧭', action: hk('mod+l') },
      { label: 'Acercar', icon: '🔍', action: hk('mod+equal') },
      { label: 'Alejar', icon: '🔭', action: hk('mod+minus') },
    ],
  },
  {
    id: 'meet', name: 'Reuniones', color: '#e5484d',
    items: [
      { label: 'Zoom: micrófono', icon: '🎙️', action: hk('alt+a', { mac: 'cmd+shift+a' }) },
      { label: 'Zoom: cámara', icon: '📹', action: hk('alt+v', { mac: 'cmd+shift+v' }) },
      { label: 'Teams: micrófono', icon: '🎙️', action: hk('mod+shift+m') },
      { label: 'Teams: cámara', icon: '📹', action: hk('mod+shift+o') },
      { label: 'Teams: levantar mano', icon: '✋', action: hk('mod+shift+k') },
      { label: 'Meet: micrófono', icon: '🎙️', action: hk('mod+d') },
      { label: 'Meet: cámara', icon: '📹', action: hk('mod+e') },
    ],
  },
  {
    id: 'sheets', name: 'Excel', color: '#30a46c',
    items: [
      { label: 'Formato de celdas', icon: '🧮', action: hk('mod+1') },
      { label: 'Filtro', icon: '🔽', action: hk('mod+shift+l') },
      { label: 'Suma automática', icon: '∑', action: hk('alt+equal', { mac: 'cmd+shift+t' }) },
      { label: 'Fecha de hoy', icon: '📅', action: { type: 'text', text: '{fecha}' } },
      { label: 'Hora actual', icon: '🕒', action: { type: 'text', text: '{hora}' } },
    ],
  },
  {
    id: 'media', name: 'Multimedia', color: '#d6409f',
    items: [
      { label: 'Reproducir / pausa', icon: '⏯️', action: { type: 'media', cmd: 'playpause' } },
      { label: 'Anterior', icon: '⏮️', action: { type: 'media', cmd: 'prev' } },
      { label: 'Siguiente', icon: '⏭️', action: { type: 'media', cmd: 'next' } },
      { label: 'Bajar volumen', icon: '🔉', action: { type: 'media', cmd: 'voldown' } },
      { label: 'Subir volumen', icon: '🔊', action: { type: 'media', cmd: 'volup' } },
      { label: 'Silencio', icon: '🔇', action: { type: 'media', cmd: 'mute' } },
    ],
  },
  {
    id: 'system', name: 'Sistema', color: '#f76b15',
    items: [
      { label: 'Bloquear', icon: '🔒', action: { type: 'power', cmd: 'lock' } },
      { label: 'Bloquear todas', icon: '🔐', target: 'all', action: { type: 'power', cmd: 'lock' } },
      { label: 'Suspender', icon: '🌙', action: { type: 'power', cmd: 'sleep' } },
      { label: 'Pegar como texto', icon: '📝', action: { type: 'text', text: '{portapapeles}' } },
      { label: 'Pasar lo copiado', icon: '📤', action: { type: 'clipboard', from: 'focus', to: 'others', paste: false } },
      { label: 'Copiar y pegar en la otra', icon: '🔁', action: { type: 'clipboard', from: 'focus', to: 'others', paste: true } },
    ],
  },
];

PRESET_CATEGORIES.splice(1, 0, {
  id: 'controls', name: 'Controles', color: '#6e56cf',
  items: [
    { label: 'Touchpad', icon: '🖱️', action: { type: 'touchpad' } },
    { label: 'Teclado', icon: '⌨️', action: { type: 'touchpad', keyboard: true } },
    { label: 'Volumen', icon: '🔊', action: { type: 'volume' } },
    { label: 'Procesador', icon: '⚙️', action: { type: 'stat', metric: 'cpu' } },
    { label: 'Memoria', icon: '🧠', action: { type: 'stat', metric: 'ram' } },
    { label: 'Batería', icon: '🔋', action: { type: 'stat', metric: 'battery' } },
    { label: 'App al frente', icon: '🪟', action: { type: 'stat', metric: 'app' } },
    { label: 'Hora', icon: '🕒', action: { type: 'stat', metric: 'clock' } },
    { label: 'Sonando', icon: '🎵', action: { type: 'stat', metric: 'music' } },
    { label: 'Presentación', icon: '📽️', action: { type: 'cycle', steps: [
      { label: 'Iniciar', action: { type: 'hotkey', keys: 'f5', mac: 'cmd+shift+enter' } },
      { label: 'Terminar', action: { type: 'hotkey', keys: 'escape' } },
    ] } },
  ],
});

PRESET_CATEGORIES.splice(2, 0, {
  id: 'windows', name: 'Ventanas', color: '#0090ff',
  items: [
    { label: 'Ventanas abiertas', icon: '🗂️', action: { type: 'windows' } },
    { label: 'A la izquierda', icon: '⬅️', action: { type: 'window', op: 'left' } },
    { label: 'A la derecha', icon: '➡️', action: { type: 'window', op: 'right' } },
    { label: 'Al centro', icon: '🎯', action: { type: 'window', op: 'center' } },
    { label: 'Maximizar', icon: '⬜', action: { type: 'window', op: 'maximize' } },
    { label: 'Minimizar', icon: '➖', action: { type: 'window', op: 'minimize' } },
    { label: 'Arriba', icon: '⬆️', action: { type: 'window', op: 'top' } },
    { label: 'Abajo', icon: '⬇️', action: { type: 'window', op: 'bottom' } },
  ],
});

export const SWATCHES = ['#3e63dd', '#0090ff', '#12a594', '#30a46c', '#ffb224', '#f76b15', '#e5484d', '#d6409f', '#6e56cf', '#8d8d86'];

export const EMOJIS = ['📋', '📥', '✂️', '↩️', '💾', '🔎', '📸', '🖥️', '💻', '🌐', '📧', '📅', '🕒', '📝', '📎', '📁',
  '🎙️', '📹', '🔇', '🔊', '⏯️', '⏭️', '⏮️', '🎵', '🎬', '🎨', '🧮', '📊', '📈', '🗂️', '🔒', '🌙',
  '⚡', '🚀', '⭐', '❤️', '✅', '❌', '⚙️', '🔧', '🧪', '💡', '🔥', '🎯', '👋', '✋', '👍', '🙂'];
