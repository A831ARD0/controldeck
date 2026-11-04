// Íconos de trazo propios (24×24). Se crean como SVG en el DOM, sin HTML ni archivos externos.

const PATHS = {
  edit: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  sliders: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 4.5v5', 'M10 14.5v5'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  laptop: ['M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5z', 'M3 18h18'],
  desktop: ['M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15z', 'M9 20h6', 'M12 16.5V20'],
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  all: ['M4 8h10', 'M4 16h10', 'M14 5l3 3-3 3', 'M14 13l3 3-3 3', 'M20 5v14'],
  focus: ['M4 9V5h4', 'M16 5h4v4', 'M20 15v4h-4', 'M8 19H4v-4', 'M12 12h.01'],
  pin: ['M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z', 'M12 11h.01'],
  keyboard: ['M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M8 14h8'],
  type: ['M5 7V5h14v2', 'M12 5v14', 'M9 19h6'],
  open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10'],
  music: ['M9 18V6l11-2v12', 'M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', 'M20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z'],
  power: ['M12 3v8', 'M7.5 6.2a7.5 7.5 0 1 0 9 0'],
  code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4', 'M13.5 5l-3 14'],
  layers: ['M12 4l8 4-8 4-8-4z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'],
  trash: ['M5 7h14', 'M10 7V5h4v2', 'M7 7l1 12.5h8L17 7'],
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  offline: ['M3 3l18 18', 'M8.5 8.8A9 9 0 0 0 5 11', 'M2 8.5A13 13 0 0 1 6 6', 'M12 19h.01', 'M9 15.5a4.5 4.5 0 0 1 4.6-.8', 'M16.5 11.5a9 9 0 0 1 2.5 1.5', 'M12.5 5A13 13 0 0 1 22 8.5'],
  sparkle: ['M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z', 'M19 4v3', 'M17.5 5.5h3'],
  shield: ['M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', 'M9 12l2 2 4-4'],
  record: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'],
  image: ['M4.5 5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5z', 'M4.5 16l4.5-4.5 4 4 2.5-2.5 4 4', 'M15 9h.01'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  clipboard: ['M9 4h6v3H9z', 'M8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16', 'M9 13h6', 'M13 11l2 2-2 2'],
  touchpad: ['M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z', 'M4.5 15h15', 'M12 15v4.5'],
  repeat: ['M17 3l3 3-3 3', 'M4 11V9a3 3 0 0 1 3-3h13', 'M7 21l-3-3 3-3', 'M20 13v2a3 3 0 0 1-3 3H4'],
  gauge: ['M12 13l3.5-3.5', 'M4.5 17a8 8 0 1 1 15 0', 'M12 13h.01'],
  volume: ['M5 9.5h3l4-3.5v12l-4-3.5H5z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'],
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5.5 11a6.5 6.5 0 0 0 13 0', 'M12 17.5V21'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'],
  windows: ['M7 7V5.5A1.5 1.5 0 0 1 8.5 4h10A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H17', 'M4 10.5A1.5 1.5 0 0 1 5.5 9h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5z', 'M4 12h13'],
  'win-left': ['M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z', 'M12 4.5v15', 'M7 8v8', 'M9 8v8'],
  'win-right': ['M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z', 'M12 4.5v15', 'M15 8v8', 'M17 8v8'],
  'win-center': ['M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z', 'M8.5 8.5h7v7h-7z'],
  'win-max': ['M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z', 'M9 9l-2.5-2.5', 'M15 9l2.5-2.5', 'M9 15l-2.5 2.5', 'M15 15l2.5 2.5'],
  'win-min': ['M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z', 'M8 15.5h8'],
  sunrise: ['M4 18h16', 'M7 18a5 5 0 0 1 10 0', 'M12 4v4', 'M5.5 9.5l1.5 1.5', 'M18.5 9.5L17 11'],
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, { size = 22, stroke = 1.8, label } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'ico');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export const ACTION_ICONS = { hotkey: 'keyboard', text: 'type', open: 'open', media: 'music', power: 'power', script: 'code', multi: 'layers', clipboard: 'clipboard', wake: 'sunrise', cycle: 'repeat', stat: 'gauge', volume: 'volume', touchpad: 'touchpad', window: 'win-center', windows: 'windows' };
