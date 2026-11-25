// Checks a staff request against public/prodotti.json and copies each product as it is now (snapshot).
import prodotti from '../public/prodotti.json' with { type: 'json' };

export const MAX_Q = 99;

// Access by shop and department: {sedi, reparti}, each a list of names or null for all of them.
export const dove = (a, sede, reparto) => (!a.sedi || a.sedi.includes(sede)) && (!a.reparti || a.reparti.includes(reparto));
const sotto = (x, y) => !y || (!!x && x.every(v => y.includes(v)));
// True when access `a` gives nothing that `b` doesn't.
export const dentro = (a, b) => sotto(a.sedi, b.sedi) && sotto(a.reparti, b.reparti);
// Reads {sedi, reparti} from a request: at least one of each, known names only. Every name ticked = null (all,
// including ones added later). Returns null when invalid.
export function leggiAccesso(b, catalogo = prodotti) {
  const lista = (v, tutti) => Array.isArray(v) && v.length && new Set(v).size === v.length && v.every(x => tutti.includes(x))
    ? (v.length === tutti.length ? null : [...v]) : undefined;
  const sedi = lista(b?.sedi, catalogo.sedi), reparti = lista(b?.reparti, Object.keys(catalogo.reparti));
  return sedi === undefined || reparti === undefined ? null : { sedi, reparti };
}
const okQ = q => Number.isInteger(q) && q >= 1 && q <= MAX_Q;
const riga = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const no = errore => ({ errore });

export function valida(b, catalogo = prodotti) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.righe)) return no('Ordine non valido.');
  const reparto = catalogo.reparti[b.reparto];
  if (!catalogo.sedi.includes(b.sede) || !reparto || !Object.hasOwn(catalogo.reparti, b.reparto)) return no('Ordine non valido.');

  const righe = [], visti = new Set();
  for (const r of b.righe) {
    const p = Object.hasOwn(reparto, r?.cat) && reparto[r.cat].find(x => x[0] === r.nome);
    if (!p) return no("Un prodotto non è più in lista. Aggiorna l'app.");
    if (!okQ(r.q)) return no('Quantità non valida.');
    const k = r.cat + '|' + r.nome;
    if (visti.has(k)) return no('Prodotto ripetuto.');
    visti.add(k);
    righe.push({ cat: r.cat, nome: p[0], dett: p[1] || '', formato: p[2] || '', q: r.q });
  }

  const nomeAltro = riga(b.altro?.nome, 80);
  if (nomeAltro) {
    const q = b.altro.q ?? '';
    if (q !== '' && !okQ(q)) return no('Quantità non valida.');
    righe.push({ cat: 'Altro', nome: nomeAltro, dett: '', formato: '', q: q === '' ? null : q });
  }
  if (!righe.length) return no('Aggiungi almeno un prodotto.');
  return { sede: b.sede, reparto: b.reparto, righe, nota: String(b.nota ?? '').trim().slice(0, 500) };
}
