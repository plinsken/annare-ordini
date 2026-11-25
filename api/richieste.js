// Staff requests. POST new; PUT/DELETE ?id= own request until its Friday 16:00; GET own requests (open and recent).
import { entrata } from './_sessioni.js';
import { valida, dove } from './_prodotti.js';
import { settimanaDi, settimanaDopo, scadenza } from './_settimana.js';
import { registra } from './_registro.js';
import { q } from './_db.js';

// Tests set globalThis.__ora to move the clock.
export const adesso = () => globalThis.__ora?.() ?? new Date();
const APERTA = `NOT EXISTS (SELECT 1 FROM settimane s WHERE s.settimana = $1::date)`;
const CHIUSA = "Questa richiesta è già nell'ordine chiuso.";
const FUORI = { errore: 'Non puoi ordinare per questa sede o questo reparto.' };

// The week a new request goes into. It is the next one when this week was closed early (prova button).
export async function settimanaAperta(ora = adesso()) {
  const w = settimanaDi(ora);
  return (await q(`SELECT 1 FROM settimane WHERE settimana = $1`, [w])).length ? settimanaDopo(w) : w;
}

export default async function handler(req, res) {
  const e = await entrata(req, res, 'persona');
  if (!e) return;
  const io = e.persona.id;

  if (req.method === 'GET') return res.status(200).json(await elenco(io));

  if (req.method === 'POST') {
    const v = valida(req.body);
    if (v.errore) return res.status(400).json(v);
    if (!dove(e.persona, v.sede, v.reparto)) return res.status(403).json(FUORI);
    const w = await settimanaAperta();
    const [r] = await q(`INSERT INTO richieste (persona_id, settimana, sede, reparto, righe, nota)
      SELECT $2, $1::date, $3, $4, $5, $6 WHERE ${APERTA} RETURNING id`, [w, io, v.sede, v.reparto, JSON.stringify(v.righe), v.nota]);
    if (!r) return res.status(409).json({ errore: "L'ordine di questa settimana è già chiuso. Riprova: la richiesta andrà nella prossima." });
    await registra(io, 'richiesta-creata', { richiesta: r.id });
    return res.status(200).json({ id: r.id, settimana: w });
  }

  if (req.method !== 'PUT' && req.method !== 'DELETE') return res.status(405).end();
  const id = Number(req.query?.id);
  const [r] = Number.isInteger(id) ? await q(`SELECT id, settimana::text FROM richieste WHERE id = $1 AND persona_id = $2 AND annullata IS NULL`, [id, io]) : [];
  if (!r) return res.status(404).json({ errore: 'Richiesta non trovata.' });
  if (adesso() >= scadenza(r.settimana)) return res.status(409).json({ errore: CHIUSA });

  let fatta;
  if (req.method === 'PUT') {
    const v = valida(req.body);
    if (v.errore) return res.status(400).json(v);
    if (!dove(e.persona, v.sede, v.reparto)) return res.status(403).json(FUORI);
    fatta = await q(`UPDATE richieste SET sede = $3, reparto = $4, righe = $5, nota = $6, modificata = now()
      WHERE id = $2 AND ${APERTA} RETURNING id`, [r.settimana, id, v.sede, v.reparto, JSON.stringify(v.righe), v.nota]);
  } else {
    fatta = await q(`UPDATE richieste SET annullata = now() WHERE id = $2 AND ${APERTA} RETURNING id`, [r.settimana, id]);
  }
  if (!fatta.length) return res.status(409).json({ errore: CHIUSA });
  await registra(io, req.method === 'PUT' ? 'richiesta-modificata' : 'richiesta-annullata', { richiesta: id });
  return res.status(200).json({ ok: true });
}

const ESITO = { approvato: 'approvato', rifiutato: 'non_approvato' };

async function elenco(io) {
  const settimana = await settimanaAperta();
  const aperte = await q(`SELECT id, settimana::text, sede, reparto, righe, nota, creata FROM richieste r
    WHERE persona_id = $1 AND annullata IS NULL AND NOT EXISTS (SELECT 1 FROM settimane s WHERE s.settimana = r.settimana)
    ORDER BY settimana, id`, [io]);
  const chiuse = await q(`SELECT r.id, r.settimana::text, r.sede, r.reparto, r.righe, r.nota, o.stato, o.righe AS o_righe, o.righe_originali AS o_orig
    FROM richieste r JOIN settimane s ON s.settimana = r.settimana
    LEFT JOIN ordini o ON o.settimana = r.settimana AND o.sede = r.sede AND o.reparto = r.reparto
    WHERE r.persona_id = $1 AND r.annullata IS NULL
      AND r.settimana IN (SELECT settimana FROM settimane ORDER BY settimana DESC LIMIT 4)
    ORDER BY r.settimana DESC, r.id DESC`, [io]);
  const passate = chiuse.map(({ stato, o_righe, o_orig, ...r }) => ({
    ...r, esito: ESITO[stato] ?? 'in_attesa',
    // When Gabriele changed a line's total, show it next to the line.
    righe: r.righe.map(l => {
      const i = (o_righe ?? []).findIndex(x => x.cat === l.cat && x.nome === l.nome && x.chi?.some(c => c.richiesta === r.id));
      return i >= 0 && o_orig[i].q !== o_righe[i].q ? { ...l, cambio: { prima: o_orig[i].q, dopo: o_righe[i].q } } : l;
    }),
  }));
  return { settimana, scadenza: scadenza(settimana).toISOString(), aperte, passate };
}
