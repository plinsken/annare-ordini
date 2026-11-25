// Gabriele, and managers allowed to manage people (only staff whose shops and departments are all within their own).
// GET list; POST {nome, sedi, reparti} add staff; POST {persona, azione:'codice'|'telefono-perso'}; DELETE ?persona= remove.
// POST {persona, azione:'modifica', sedi, reparti, ruolo, approva, gestisce}: ruolo and rights from Gabriele only.
// Anything that hands out power (making a manager, a right on, wider access for a manager, a code for a manager) first answers
// {conferma, sfida, opzioni}; the same request runs after POST {azione:'conferma', sfida, risposta} with a fresh Face ID.
import { entrata, revoca } from './_sessioni.js';
import { nuovoCodice } from './_codici.js';
import { opzioniAccesso, verificaAccesso, salvaSfida, prendiSfida } from './_passkey.js';
import { registra } from './_registro.js';
import { leggiAccesso, dentro } from './_prodotti.js';
import { q, tx } from './_db.js';

const nome = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export default async function handler(req, res) {
  const e = await entrata(req, res, 'gestisce');
  if (!e) return;
  const io = e.persona, admin = io.ruolo === 'admin';
  // Who I may act on: Gabriele everyone but himself is handled below; a manager only staff within their own access.
  const posso = p => p.ruolo !== 'admin' && (admin || (p.ruolo === 'staff' && dentro(p, io)));
  const FUORI = 'Puoi dare solo sedi e reparti che hai anche tu.';

  if (req.method === 'GET') {
    const righe = await q(`SELECT p.id, p.nome, p.ruolo, p.puo_approvare AS approva, p.puo_gestire AS gestisce, p.sedi, p.reparti,
        EXISTS (SELECT 1 FROM passkey k WHERE k.persona_id = p.id) AS passkey,
        EXISTS (SELECT 1 FROM dispositivi d WHERE d.persona_id = p.id) AS pin,
        EXISTS (SELECT 1 FROM dispositivi d WHERE d.persona_id = p.id AND d.bloccato IS NOT NULL) AS bloccato,
        GREATEST((SELECT max(usata) FROM passkey k WHERE k.persona_id = p.id), (SELECT max(usato) FROM dispositivi d WHERE d.persona_id = p.id)) AS "ultimoUso"
      FROM persone p WHERE p.rimossa IS NULL ORDER BY p.ruolo, p.nome`);
    return res.status(200).json(righe.map(({ passkey, pin, ...p }) => ({ ...p, accesso: passkey ? 'passkey' : pin ? 'pin' : 'nessuno', puoi: posso(p) })));
  }

  let b = req.body || {}, confermato = false;
  if (req.method === 'POST' && b.azione === 'conferma') {
    const sf = await prendiSfida(b.sfida, 'persone');
    if (!sf || sf.personaId !== io.id) return res.status(400).json({ errore: 'Conferma scaduta. Riprova.' });
    if (!await verificaAccesso(b.risposta, sf, e.s, io.id)) return res.status(401).json({ errore: 'Conferma non riuscita. Riprova.' });
    b = sf.dati; confermato = true;
  }
  const conferma = async () => {
    const opzioni = await opzioniAccesso(e.s, await q(`SELECT id, trasporti FROM passkey WHERE persona_id = $1`, [io.id]));
    const { persona, azione, ruolo, approva, gestisce, sedi, reparti } = b;
    return res.status(200).json({ conferma: true, sfida: await salvaSfida('persone', opzioni.challenge, io.id, { persona, azione, ruolo, approva, gestisce, sedi, reparti }), opzioni });
  };

  if (req.method === 'POST' && b.nome !== undefined) {
    const n = nome(b.nome);
    if (!n || n.length > 60) return res.status(400).json({ errore: 'Scrivi un nome (massimo 60 caratteri).' });
    const acc = leggiAccesso(b);
    if (!acc) return res.status(400).json({ errore: 'Scegli almeno una sede e un reparto.' });
    if (!dentro(acc, io)) return res.status(403).json({ errore: FUORI });
    const [{ id }] = await q(`INSERT INTO persone (nome, ruolo, sedi, reparti) VALUES ($1, 'staff', $2, $3) RETURNING id`, [n, acc.sedi, acc.reparti]);
    const codice = await nuovoCodice(id);
    await registra(io.id, 'persona-aggiunta', { persona: id });
    await registra(io.id, 'codice-creato', { persona: id });
    return res.status(200).json({ id, codice });
  }

  const pid = Number(req.method === 'DELETE' ? req.query?.persona : b.persona);
  const [p] = Number.isInteger(pid) ? await q(`SELECT id, ruolo, puo_approvare, puo_gestire, sedi, reparti FROM persone WHERE id = $1 AND rimossa IS NULL`, [pid]) : [];
  if (!p) return res.status(404).json({ errore: 'Persona non trovata.' });

  const codice = req.method === 'POST' && b.azione === 'codice';
  // An admin code from the app would let anyone holding Gabriele's unlocked phone make their own approving passkey.
  if (codice && p.ruolo === 'admin') return res.status(403).json({ errore: 'Il codice per Gabriele lo crea Tom.' });
  // On yourself: would lock you out until Tom runs the recovery script, or (a code) give a manager a second phone.
  if (pid === io.id) return res.status(400).json({ errore: req.method === 'DELETE' ? 'Non puoi rimuovere te stesso.' : 'Non puoi farlo sul tuo account.' });
  if (!posso(p)) return res.status(403).json({ errore: 'Per questa persona chiedi a Gabriele.' });
  if (codice) {
    if (p.ruolo === 'manager' && !confermato) return conferma();
    const c = await nuovoCodice(pid);
    await registra(io.id, 'codice-creato', { persona: pid });
    return res.status(200).json({ codice: c });
  }

  if (req.method === 'POST' && b.azione === 'modifica') {
    const acc = leggiAccesso(b);
    if (!acc) return res.status(400).json({ errore: 'Scegli almeno una sede e un reparto.' });
    if (!admin) {
      if (b.ruolo !== undefined || b.approva !== undefined || b.gestisce !== undefined) return res.status(403).json({ errore: 'Solo Gabriele può cambiare i ruoli.' });
      if (!dentro(acc, io)) return res.status(403).json({ errore: FUORI });
      await q(`UPDATE persone SET sedi = $2, reparti = $3 WHERE id = $1`, [pid, acc.sedi, acc.reparti]);
      await registra(io.id, 'accesso-cambiato', { persona: pid, ...acc });
      return res.status(200).json({ ok: true });
    }
    if (!['staff', 'manager'].includes(b.ruolo) || typeof b.approva !== 'boolean' || typeof b.gestisce !== 'boolean')
      return res.status(400).json({ errore: 'Richiesta non valida.' });
    const manager = b.ruolo === 'manager', approva = manager && b.approva, gestisce = manager && b.gestisce;
    const daPiu = (manager && p.ruolo !== 'manager') || (approva && !p.puo_approvare) || (gestisce && !p.puo_gestire) || (manager && !dentro(acc, p));
    if (daPiu && !confermato) return conferma();
    const passi = [[`UPDATE persone SET ruolo = $2, puo_approvare = $3, puo_gestire = $4, sedi = $5, reparti = $6 WHERE id = $1`, [pid, b.ruolo, approva, gestisce, acc.sedi, acc.reparti]]];
    // A new role means a new login length; managers log in with a passkey only, so PIN phones stop working.
    if (b.ruolo !== p.ruolo) passi.push([`DELETE FROM sessioni WHERE persona_id = $1`, [pid]]);
    if (manager) passi.push([`DELETE FROM dispositivi WHERE persona_id = $1`, [pid]]);
    await tx(passi);
    await registra(io.id, 'ruolo-cambiato', { persona: pid, ruolo: b.ruolo, approva, gestisce, ...acc });
    return res.status(200).json({ ok: true });
  }

  const tutto = req.method === 'DELETE';
  if (!tutto && !(req.method === 'POST' && b.azione === 'telefono-perso')) return res.status(400).json({ errore: 'Richiesta non valida.' });
  await revoca(pid);
  if (tutto) await q(`UPDATE persone SET rimossa = now() WHERE id = $1`, [pid]);
  await registra(io.id, tutto ? 'persona-rimossa' : 'telefono-perso', { persona: pid });
  return res.status(200).json({ ok: true });
}
