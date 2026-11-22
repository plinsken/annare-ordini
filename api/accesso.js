// POST {passo:'opzioni'} -> {sfida, opzioni}; {passo:'verifica', sfida, risposta} -> session; {passo:'pin', pin} with the phone's cookie -> session.
import { entrata, creaSessione, aggiungiCookie, leggiCookie, sha } from './_sessioni.js';
import { pinValido, verificaPin } from './_codici.js';
import { opzioniAccesso, verificaAccesso, salvaSfida, prendiSfida } from './_passkey.js';
import { limite, ipDi } from './_limiti.js';
import { registra } from './_registro.js';
import { q } from './_db.js';

const TENTATIVI = 5;
const NON_ATTIVO = 'Questo telefono non è più attivo. Chiedi un nuovo codice a Gabriele.';
const BLOCCATO = 'Telefono bloccato. Chiedi un nuovo codice a Gabriele.';

export default async function handler(req, res) {
  const e = await entrata(req, res, 'nessuno');
  if (!e) return;
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  if (!await limite('accesso:' + ipDi(req), 30, 900)) return res.status(429).json({ errore: 'Troppi tentativi. Riprova tra qualche minuto.' });
  const entra = async (p, tipo) => {
    aggiungiCookie(res, await creaSessione(p));
    await registra(p.id, 'accesso', { tipo });
    return res.status(200).json({ nome: p.nome, ruolo: p.ruolo });
  };

  if (b.passo === 'opzioni') {
    const opzioni = await opzioniAccesso(e.s);
    return res.status(200).json({ sfida: await salvaSfida('accesso', opzioni.challenge), opzioni });
  }

  if (b.passo === 'verifica') {
    const sf = await prendiSfida(b.sfida, 'accesso');
    const p = sf && await verificaAccesso(b.risposta, sf, e.s);
    if (!p) { await registra(null, 'accesso-fallito', { tipo: 'passkey' }); return res.status(401).json({ errore: 'Accesso non riuscito. Riprova.' }); }
    return entra(p, 'passkey');
  }

  if (b.passo === 'pin') {
    const token = leggiCookie(req, 'dispositivo');
    const [d] = token ? await q(`SELECT d.id, d.pin_hash, d.bloccato, p.id AS persona, p.nome, p.ruolo
      FROM dispositivi d JOIN persone p ON p.id = d.persona_id WHERE d.token_hash = $1 AND p.rimossa IS NULL`, [sha(token)]) : [];
    if (!d) return res.status(401).json({ errore: NON_ATTIVO });
    if (d.bloccato) return res.status(423).json({ errore: BLOCCATO });
    if (!pinValido(b.pin)) return res.status(400).json({ errore: 'Il PIN deve avere 6 cifre.' });
    if (!await verificaPin(b.pin, d.pin_hash)) {
      const [r] = await q(`UPDATE dispositivi SET tentativi = tentativi + 1,
        bloccato = CASE WHEN tentativi + 1 >= $2 THEN now() END WHERE id = $1 RETURNING bloccato`, [d.id, TENTATIVI]);
      await registra(d.persona, r.bloccato ? 'pin-bloccato' : 'accesso-fallito', { tipo: 'pin' });
      return r.bloccato ? res.status(423).json({ errore: BLOCCATO }) : res.status(401).json({ errore: 'PIN sbagliato.' });
    }
    await q(`UPDATE dispositivi SET tentativi = 0, usato = now() WHERE id = $1`, [d.id]);
    return entra({ id: d.persona, nome: d.nome, ruolo: d.ruolo }, 'pin');
  }
  return res.status(400).json({ errore: 'Richiesta non valida.' });
}
