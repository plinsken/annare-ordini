// Combines a week's requests into one order per sede+reparto. Same product (cat|nome|formato) is summed.
import prodotti from '../public/prodotti.json' with { type: 'json' };

export function consolida(richieste, catalogo = prodotti) {
  const gruppi = new Map();
  for (const r of richieste) {
    const gk = r.sede + '|' + r.reparto;
    if (!gruppi.has(gk)) gruppi.set(gk, { sede: r.sede, reparto: r.reparto, righe: new Map(), note: [] });
    const g = gruppi.get(gk);
    if (r.nota) g.note.push({ nome: r.nome, nota: r.nota });
    for (const l of r.righe) {
      // "Altro" is free text: never merged with anyone else's.
      const k = l.cat === 'Altro' ? `Altro|${r.id}|${l.nome}` : `${l.cat}|${l.nome}|${l.formato}`;
      const chi = { nome: r.nome, q: l.q, richiesta: r.id };
      const x = g.righe.get(k);
      if (x) { x.q = x.q === null || l.q === null ? null : x.q + l.q; x.chi.push(chi); }
      else g.righe.set(k, { cat: l.cat, nome: l.nome, dett: l.dett, formato: l.formato, q: l.q, chi: [chi] });
    }
  }
  const pos = (lista, v) => { const i = lista.indexOf(v); return i < 0 ? 1e6 : i; };
  const ordine = (o) => {
    const cats = Object.keys(catalogo.reparti[o.reparto] ?? {});
    const prodotto = l => pos((catalogo.reparti[o.reparto]?.[l.cat] ?? []).map(p => p[0]), l.nome);
    const cat = l => (l.cat === 'Altro' ? 2e6 : pos(cats, l.cat));
    return { ...o, righe: [...o.righe.values()].sort((a, b) => cat(a) - cat(b) || prodotto(a) - prodotto(b) || a.nome.localeCompare(b.nome)) };
  };
  const reparti = Object.keys(catalogo.reparti);
  return [...gruppi.values()].map(ordine)
    .sort((a, b) => pos(catalogo.sedi, a.sede) - pos(catalogo.sedi, b.sede) || pos(reparti, a.reparto) - pos(reparti, b.reparto));
}
