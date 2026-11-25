// GET (Vercel cron, Bearer CRON_SECRET): closes every week whose Friday 16:00 has passed, sends the one weekly email, cleans old data.
// POST (Gabriele, prova only): "chiudi la settimana ora", closes open weeks without waiting for Friday.
import { timingSafeEqual } from 'node:crypto';
import { entrata, sha } from './_sessioni.js';
import { sito } from './_sito.js';
import { consolida } from './_consolida.js';
import { scadenza, dataBreve } from './_settimana.js';
import { invia } from './_email.js';
import { registra } from './_registro.js';
import { adesso } from './richieste.js';
import { q, tx } from './_db.js';

const MARGINE = 60000;   // a request started at 15:59:59 has a minute to be saved before the close reads it

export async function chiudi(ora, { forza = false } = {}) {
  const aperte = (await q(`SELECT DISTINCT r.settimana::text AS s FROM richieste r
    WHERE r.annullata IS NULL AND NOT EXISTS (SELECT 1 FROM settimane x WHERE x.settimana = r.settimana) ORDER BY 1`)).map(r => r.s);
  const chiuse = [];
  for (const s of aperte.filter(s => forza || scadenza(s).getTime() + MARGINE <= ora.getTime())) {
    const richieste = await q(`SELECT r.id, p.nome, r.sede, r.reparto, r.righe, r.nota FROM richieste r JOIN persone p ON p.id = r.persona_id
      WHERE r.settimana = $1 AND r.annullata IS NULL ORDER BY r.id`, [s]);
    const ordini = consolida(richieste);
    const [fatta] = await tx([
      [`INSERT INTO settimane (settimana) VALUES ($1) ON CONFLICT DO NOTHING RETURNING settimana`, [s]],
      ...ordini.map(o => [`INSERT INTO ordini (settimana, sede, reparto, righe, righe_originali, note) VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT DO NOTHING`,
        [s, o.sede, o.reparto, JSON.stringify(o.righe), JSON.stringify(o.note)]]),
    ]);
    if (fatta.length) { chiuse.push(s); await registra(null, 'settimana-chiusa', { settimana: s, ordini: ordini.length }); }
  }
  const email = await avvisa();
  await pulisci();
  return { chiuse, email };
}

// The one weekly email. Claimed first so two runs can't both send it.
async function avvisa() {
  const prese = (await q(`UPDATE settimane SET email_inviata = now() WHERE email_inviata IS NULL RETURNING settimana::text AS s`)).map(r => r.s).sort();
  if (!prese.length) return false;
  const [{ n }] = await q(`SELECT count(*)::int n FROM ordini WHERE stato = 'da_approvare'`);
  const ultima = prese.at(-1);
  const ok = await invia({
    subject: 'Ordine della settimana pronto, da approvare',
    text: `L'ordine di venerdì ${dataBreve(ultima)} è chiuso.\nOrdini da approvare: ${n}.\n\nApri l'app: ${sito()?.origin ?? 'https://ordini.annarepizzeria.com'}/#gestione\n`,
    chiave: 'settimana-' + ultima,
  });
  if (ok === false) {
    await q(`UPDATE settimane SET email_inviata = NULL WHERE settimana = ANY($1::date[])`, [prese]);
    await registra(null, 'email-fallita', { settimana: ultima });
  }
  return ok === true;
}

const pulisci = () => tx([
  [`DELETE FROM richieste WHERE settimana < (now() - interval '2 years')::date`, []],
  [`DELETE FROM ordini WHERE settimana < (now() - interval '2 years')::date AND stato <> 'da_approvare'`, []],
  [`DELETE FROM settimane WHERE settimana < (now() - interval '2 years')::date`, []],
  [`DELETE FROM registro WHERE quando < now() - interval '1 year'`, []],
  [`DELETE FROM sessioni WHERE scade < now()`, []],
  [`DELETE FROM sfide WHERE scade < now()`, []],
  [`DELETE FROM codici WHERE scade < now()`, []],
  [`DELETE FROM limiti WHERE inizio < now() - interval '1 day'`, []],
]);

const uguale = (a, b) => timingSafeEqual(Buffer.from(sha(a), 'hex'), Buffer.from(sha(b), 'hex'));

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const segreto = process.env.CRON_SECRET || '';
    if (!sito()) return res.status(503).end();
    if (segreto.length < 16 || !uguale(String(req.headers.authorization ?? ''), 'Bearer ' + segreto)) return res.status(401).end();
    return res.status(200).json(await chiudi(new Date()));
  }
  const e = await entrata(req, res, 'approva');
  if (!e) return;
  if (req.method !== 'POST' || !e.s.prova) return res.status(404).end();
  return res.status(200).json(await chiudi(adesso(), { forza: true }));
}
