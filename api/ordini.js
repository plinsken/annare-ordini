// Gabriele and managers allowed to approve (managers: only their shops and departments). GET: orders waiting and recent (?pdf=<id> downloads an approved one).
// POST {passo:'opzioni', ordine, righe:[{indice,q}]} -> passkey challenge holding the edited quantities;
// POST {passo:'approva', sfida, risposta} -> approves (or rejects when every line is 0) after a fresh verified passkey.
import { entrata } from './_sessioni.js';
import { opzioniAccesso, verificaAccesso, salvaSfida, prendiSfida } from './_passkey.js';
import { creaPdf } from './_pdf.js';
import { invia } from './_email.js';
import { dataBreve } from './_settimana.js';
import { MAX_Q, dove } from './_prodotti.js';
import { registra } from './_registro.js';
import { q } from './_db.js';

const COLONNE = `id, settimana::text, sede, reparto, righe, righe_originali, note, stato, deciso, email_inviata`;
const roma = (d, opz) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ...opz }).format(d);

export async function pdfOrdine(o, approvatoDa) {
  const gruppi = [];
  for (const r of o.righe.filter(r => r.q !== 0)) {
    let g = gruppi.at(-1);
    if (g?.cat !== r.cat) gruppi.push(g = { cat: r.cat, righe: [] });
    g.righe.push(r);
  }
  const quando = new Date(o.deciso ?? Date.now());
  return creaPdf({ num: String(o.id), data: roma(quando, { day: '2-digit', month: '2-digit', year: 'numeric' }), ora: roma(quando, { hour: '2-digit', minute: '2-digit' }),
    sede: o.sede, reparto: o.reparto, approvatoDa, settimana: o.settimana, gruppi, note: o.note.map(n => `${n.nome}: ${n.nota}`).join(' · ') });
}

export default async function handler(req, res) {
  const e = await entrata(req, res, 'approva');
  if (!e) return;
  const io = e.persona;

  if (req.method === 'GET') {
    if (req.query?.pdf !== undefined) {
      const [o] = await q(`SELECT ${COLONNE}, (SELECT nome FROM persone WHERE id = deciso_da) AS da FROM ordini WHERE id = $1 AND stato = 'approvato'`, [Number(req.query.pdf) || 0]);
      if (!o || !dove(io, o.sede, o.reparto)) return res.status(404).json({ errore: 'Ordine non trovato.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Ordine ${o.reparto} ${o.id}.pdf"`);
      return res.status(200).send(Buffer.from(await pdfOrdine(o, o.da)));
    }
    const da_approvare = await q(`SELECT ${COLONNE} FROM ordini WHERE stato = 'da_approvare' ORDER BY settimana, sede, reparto`);
    const recenti = await q(`SELECT ${COLONNE} FROM ordini WHERE stato <> 'da_approvare' AND settimana > (now() - interval '8 weeks')::date ORDER BY settimana DESC, sede, reparto`);
    const miei = l => l.filter(o => dove(io, o.sede, o.reparto));
    return res.status(200).json({ da_approvare: miei(da_approvare), recenti: miei(recenti) });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};

  if (b.passo === 'opzioni') {
    const [o] = await q(`SELECT id, sede, reparto, righe FROM ordini WHERE id = $1 AND stato = 'da_approvare'`, [Number(b.ordine) || 0]);
    if (!o) return res.status(409).json({ errore: 'Ordine già approvato.' });
    if (!dove(io, o.sede, o.reparto)) return res.status(403).json({ errore: 'Non hai il permesso.' });
    const nuove = Array.isArray(b.righe) && b.righe.length === o.righe.length ? new Array(o.righe.length) : null;
    for (const x of nuove ? b.righe : []) {
      const orig = o.righe[x?.indice];
      const ok = orig && nuove[x.indice] === undefined && (Number.isInteger(x.q) ? x.q >= 0 && x.q <= MAX_Q : x.q === null && orig.q === null);
      if (!ok) return res.status(400).json({ errore: 'Quantità non valida.' });
      nuove[x.indice] = x.q;
    }
    if (!nuove) return res.status(400).json({ errore: 'Quantità non valida.' });
    const mie = await q(`SELECT id, trasporti FROM passkey WHERE persona_id = $1`, [io.id]);
    const opzioni = await opzioniAccesso(e.s, mie);
    return res.status(200).json({ sfida: await salvaSfida('approva', opzioni.challenge, io.id, { ordine: o.id, q: nuove }), opzioni });
  }

  if (b.passo !== 'approva') return res.status(400).json({ errore: 'Richiesta non valida.' });
  const sf = await prendiSfida(b.sfida, 'approva');
  if (!sf || sf.personaId !== io.id) return res.status(400).json({ errore: 'Conferma scaduta. Riprova.' });
  if (!await verificaAccesso(b.risposta, sf, e.s, io.id)) return res.status(401).json({ errore: 'Conferma non riuscita. Riprova.' });

  const [o] = await q(`SELECT ${COLONNE} FROM ordini WHERE id = $1`, [sf.dati.ordine]);
  // Access is read again: Gabriele may have changed it since the challenge.
  if (!dove(io, o.sede, o.reparto)) return res.status(403).json({ errore: 'Non hai il permesso.' });
  const righe = o.righe.map((r, i) => ({ ...r, q: sf.dati.q[i] }));
  const stato = righe.every(r => r.q === 0) ? 'rifiutato' : 'approvato';
  const [fatto] = await q(`UPDATE ordini SET righe = $2, stato = $3, deciso = now(), deciso_da = $4 WHERE id = $1 AND stato = 'da_approvare' RETURNING ${COLONNE}`,
    [o.id, JSON.stringify(righe), stato, io.id]);
  if (!fatto) return res.status(409).json({ errore: 'Ordine già approvato.' });

  const modifiche = righe.flatMap((r, i) => (r.q !== o.righe[i].q ? [{ nome: r.nome, prima: o.righe[i].q, dopo: r.q }] : []));
  if (modifiche.length) await registra(io.id, 'ordine-modificato', { ordine: o.id, modifiche });
  await registra(io.id, stato === 'approvato' ? 'ordine-approvato' : 'ordine-rifiutato', { ordine: o.id });
  if (stato === 'rifiutato') return res.status(200).json({ stato, email: false });

  // The order is approved already: a PDF or email problem must not turn into an error page.
  let inviata = false;
  try {
  const pdf = Buffer.from(await pdfOrdine(fatto, io.nome)).toString('base64');
  inviata = await invia({
    subject: `Ordine ${o.reparto}, ${o.sede}, venerdì ${dataBreve(o.settimana)}`,
    text: `Ordine approvato da ${io.nome}.\nSede: ${o.sede}\nReparto: ${o.reparto}\nSettimana: venerdì ${dataBreve(o.settimana)}\n\nIl PDF è in allegato.`,
    attachments: [{ filename: `Ordine ${o.reparto} ${o.id}.pdf`, content: pdf }],
    chiave: 'ordine-' + o.id,
  });
  } catch (err) { console.error('PDF', err.message); }
  if (inviata) await q(`UPDATE ordini SET email_inviata = now() WHERE id = $1`, [o.id]);
  else if (inviata === false) await registra(io.id, 'email-fallita', { ordine: o.id });
  return res.status(200).json({ stato, email: inviata === true });
}
