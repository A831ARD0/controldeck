// Datos públicos del proyecto. Para apoyar con donaciones, pon aquí tus enlaces: el panel de la
// computadora y los ajustes de la tablet muestran "Invítame un café" solo si hay alguno.
//   github: tu página de GitHub Sponsors, por ejemplo https://github.com/sponsors/tu-usuario
//   kofi:   tu página de Ko-fi, por ejemplo https://ko-fi.com/tu-usuario

export const PROJECT = {
  name: 'ControlDeck',
  repo: 'https://github.com/A831ARD0/controldeck',
  support: {
    github: 'https://github.com/sponsors/A831ARD0',
    kofi: 'https://ko-fi.com/amix_a83',
  },
};

// Niveles sugeridos para donar (en dólares). Cada quien puede elegir otra cantidad.
export const SUPPORT_TIERS = [
  { id: 'cafe', icon: '☕', name: 'Un café', amount: 3 },
  { id: 'cafetera', icon: '🫖', name: 'Una cafetera', amount: 25 },
  { id: 'anio', icon: '📅', name: 'Un año de café', amount: 100 },
];

// Enlaces listos para mostrar: solo direcciones https de los servicios conocidos.
export function supportLinks(project = PROJECT) {
  const ok = (url, host) => {
    try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === host || u.hostname === `www.${host}`); } catch { return false; }
  };
  const links = [];
  if (ok(project.support?.github, 'github.com')) links.push({ id: 'github', name: 'GitHub Sponsors', url: project.support.github });
  if (ok(project.support?.kofi, 'ko-fi.com')) links.push({ id: 'kofi', name: 'Ko-fi', url: project.support.kofi });
  return links;
}
