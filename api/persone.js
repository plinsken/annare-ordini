// Gabriele only. GET list; POST {nome} add staff; POST {persona, azione:'codice'|'telefono-perso'}; DELETE ?persona= remove.
import { entrata, revoca } from './_sessioni.js';
import { nuovoCodice } from './_codici.js';
import { registra } from './_registro.js';
import { q } from './_db.js';

const nome = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export default async function handler(req, res) {
  const e = await entrata(req, res, 'admin');
  if (!e) return;
  const io = e.persona;

  if (req.method === 'GET') {
    const righe = await q(`SELECT p.id, p.nome, p.ruolo,
        EXISTS (SELECT 1 FROM passkey k WHERE k.persona_id = p.id) AS passkey,
        EXISTS (SELECT 1 FROM dispositivi d WHERE d.persona_id = p.id) AS pin,
        EXISTS (SELECT 1 FROM dispositivi d WHERE d.persona_id = p.id AND d.bloccato IS NOT NULL) AS bloccato,
        GREATEST((SELECT max(usata) FROM passkey k WHERE k.persona_id = p.id), (SELECT max(usato) FROM dispositivi d WHERE d.persona_id = p.id)) AS "ultimoUso"
      FROM persone p WHERE p.rimossa IS NULL ORDER BY p.ruolo, p.nome`);
    return res.status(200).json(righe.map(({ passkey, pin, ...p }) => ({ ...p, accesso: passkey ? 'passkey' : pin ? 'pin' : 'nessuno' })));
  }

  const b = req.body || {};
  if (req.method === 'POST' && b.nome !== undefined) {
    const n = nome(b.nome);
    if (!n || n.length > 60) return res.status(400).json({ errore: 'Scrivi un nome (massimo 60 caratteri).' });
    const [{ id }] = await q(`INSERT INTO persone (nome, ruolo) VALUES ($1, 'staff') RETURNING id`, [n]);
    const codice = await nuovoCodice(id);
    await registra(io.id, 'persona-aggiunta', { persona: id });
    await registra(io.id, 'codice-creato', { persona: id });
    return res.status(200).json({ id, codice });
  }

  const pid = Number(req.method === 'DELETE' ? req.query?.persona : b.persona);
  const [p] = Number.isInteger(pid) ? await q(`SELECT id, ruolo FROM persone WHERE id = $1 AND rimossa IS NULL`, [pid]) : [];
  if (!p) return res.status(404).json({ errore: 'Persona non trovata.' });

  if (req.method === 'POST' && b.azione === 'codice') {
    // An admin code from the app would let anyone holding Gabriele's unlocked phone make their own approving passkey.
    if (p.ruolo === 'admin') return res.status(403).json({ errore: 'Il codice per Gabriele lo crea Tom.' });
    const codice = await nuovoCodice(pid);
    await registra(io.id, 'codice-creato', { persona: pid });
    return res.status(200).json({ codice });
  }
  const tutto = req.method === 'DELETE';
  if (!tutto && !(req.method === 'POST' && b.azione === 'telefono-perso')) return res.status(400).json({ errore: 'Richiesta non valida.' });
  // Doing this to yourself would lock you out until Tom runs the recovery script.
  if (pid === io.id) return res.status(400).json({ errore: tutto ? 'Non puoi rimuovere te stesso.' : 'Non puoi farlo sul tuo account.' });
  await revoca(pid);
  if (tutto) await q(`UPDATE persone SET rimossa = now() WHERE id = $1`, [pid]);
  await registra(io.id, tutto ? 'persona-rimossa' : 'telefono-perso', { persona: pid });
  return res.status(200).json({ ok: true });
}
