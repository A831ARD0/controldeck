// Comandos de voz: encuentra la tecla o la página que se mencionó.
//   "copiar" → la tecla Copiar · "página multimedia" → esa página.

const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

export function matchVoice(deck, said) {
  const t = norm(said);
  if (!t || !deck) return null;
  const pageCmd = /^(?:ir a |abre |abrir )?(?:la )?pagina (.+)$/.exec(t);
  if (pageCmd) {
    const page = deck.pages.find((p) => norm(p.name) === pageCmd[1]) ?? deck.pages.find((p) => norm(p.name).includes(pageCmd[1]));
    if (page) return { page };
  }
  let best = null;
  for (const page of deck.pages) {
    for (const b of page.buttons) {
      const label = norm(b.label);
      if (!label) continue;
      const score = label === t ? 3 : t.includes(label) ? 2 : label.includes(t) ? 1 : 0;
      if (score && (!best || score > best.score || (score === best.score && label.length > norm(best.button.label).length))) best = { score, page, button: b };
    }
  }
  return best;
}

