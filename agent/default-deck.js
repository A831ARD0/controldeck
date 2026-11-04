// Deck inicial: atajos que funcionan igual en Windows y en Mac gracias a "mod".

export function defaultDeck() {
  return {
    version: 1,
    pages: [
      {
        id: 'general',
        name: 'General',
        buttons: [
          { id: 'copiar', label: 'Copiar', icon: '📋', color: '#2f6feb', target: 'focus', action: { type: 'hotkey', keys: 'mod+c' } },
          { id: 'pegar', label: 'Pegar', icon: '📥', color: '#2f6feb', target: 'focus', action: { type: 'hotkey', keys: 'mod+v' } },
          { id: 'cortar', label: 'Cortar', icon: '✂️', color: '#2f6feb', target: 'focus', action: { type: 'hotkey', keys: 'mod+x' } },
          { id: 'deshacer', label: 'Deshacer', icon: '↩️', color: '#6e7781', target: 'focus', action: { type: 'hotkey', keys: 'mod+z' } },
          { id: 'guardar', label: 'Guardar', icon: '💾', color: '#1a7f37', target: 'focus', action: { type: 'hotkey', keys: 'mod+s' } },
          { id: 'buscar', label: 'Buscar', icon: '🔎', color: '#6e7781', target: 'focus', action: { type: 'hotkey', keys: 'mod+f' } },
          { id: 'fecha', label: 'Escribir fecha', icon: '📅', color: '#8250df', target: 'focus', action: { type: 'text', text: '{fecha}' } },
          { id: 'navegador', label: 'Abrir web', icon: '🌐', color: '#8250df', target: 'focus', action: { type: 'open', target: 'https://www.google.com' } },
          { id: 'touchpad', label: 'Touchpad', icon: '🖱️', color: '#6e56cf', target: 'focus', action: { type: 'touchpad' } },
          { id: 'teclado', label: 'Teclado', icon: '⌨️', color: '#6e56cf', target: 'focus', action: { type: 'touchpad', keyboard: true } },
        ],
      },
      {
        id: 'multimedia',
        name: 'Multimedia',
        buttons: [
          { id: 'play', label: 'Reproducir / pausa', icon: '⏯️', color: '#bf3989', target: 'focus', action: { type: 'media', cmd: 'playpause' } },
          { id: 'anterior', label: 'Anterior', icon: '⏮️', color: '#bf3989', target: 'focus', action: { type: 'media', cmd: 'prev' } },
          { id: 'siguiente', label: 'Siguiente', icon: '⏭️', color: '#bf3989', target: 'focus', action: { type: 'media', cmd: 'next' } },
          { id: 'volmenos', label: 'Volumen −', icon: '🔉', color: '#6e7781', target: 'focus', action: { type: 'media', cmd: 'voldown' } },
          { id: 'volmas', label: 'Volumen +', icon: '🔊', color: '#6e7781', target: 'focus', action: { type: 'media', cmd: 'volup' } },
          { id: 'silencio', label: 'Silencio', icon: '🔇', color: '#6e7781', target: 'focus', action: { type: 'media', cmd: 'mute' } },
        ],
      },
      {
        id: 'sistema',
        name: 'Sistema',
        buttons: [
          { id: 'bloquear', label: 'Bloquear todas', icon: '🔒', color: '#cf222e', target: 'all', action: { type: 'power', cmd: 'lock' } },
          { id: 'suspender', label: 'Suspender', icon: '🌙', color: '#cf222e', target: 'focus', action: { type: 'power', cmd: 'sleep' } },
        ],
      },
    ],
  };
}
