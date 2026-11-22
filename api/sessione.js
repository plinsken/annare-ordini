// GET: who is logged in (401 with dispositivo:true when this phone has a PIN login). DELETE: log out.
import { entrata, chi, esci, aggiungiCookie, leggiCookie, sha } from './_sessioni.js';
import { q } from './_db.js';

export default async function handler(req, res) {
  const e = await entrata(req, res, 'nessuno');
  if (!e) return;
  const prova = e.s.prova;
  if (req.method === 'DELETE') {
    aggiungiCookie(res, await esci(req));
    return res.status(204).end();
  }
  if (req.method !== 'GET') return res.status(405).end();
  const p = await chi(req, res);
  if (p) return res.status(200).json({ nome: p.nome, ruolo: p.ruolo, prova });
  const token = leggiCookie(req, 'dispositivo');
  const [d] = token ? await q(`SELECT d.bloccato IS NOT NULL AS bloccato FROM dispositivi d JOIN persone p ON p.id = d.persona_id
    WHERE d.token_hash = $1 AND p.rimossa IS NULL`, [sha(token)]) : [];
  return res.status(401).json(d ? { dispositivo: true, bloccato: d.bloccato, prova } : { prova });
}
