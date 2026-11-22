// POST {passo:'codice', codice} -> passkey options; then {passo:'passkey', sfida, risposta} or {passo:'pin', sfida, pin} (staff only).
import { entrata, creaSessione, cookie, aggiungiCookie, nuovoToken, sha } from './_sessioni.js';
import { trovaCodice, codiceDaHash, consumaCodice, pinValido, hashPin } from './_codici.js';
import { opzioniRegistrazione, verificaRegistrazione, salvaPasskey, salvaSfida, prendiSfida } from './_passkey.js';
import { limite, ipDi } from './_limiti.js';
import { registra } from './_registro.js';
import { q } from './_db.js';

export const DISPOSITIVO = 400 * 86400;
const SCADUTA = 'Attivazione scaduta. Inserisci di nuovo il codice.';

export default async function handler(req, res) {
  const e = await entrata(req, res, 'nessuno');
  if (!e) return;
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};

  if (b.passo === 'codice') {
    if (!await limite('attiva:' + ipDi(req), 10, 900)) return res.status(429).json({ errore: 'Troppi tentativi. Riprova tra qualche minuto.' });
    const c = await trovaCodice(b.codice);
    if (!c) { await registra(null, 'accesso-fallito', { tipo: 'codice' }); return res.status(401).json({ errore: 'Codice non valido o scaduto.' }); }
    const opzioni = await opzioniRegistrazione({ id: c.personaId, nome: c.nome }, e.s);
    const sfida = await salvaSfida('attiva', opzioni.challenge, c.personaId, { codice: c.hash });
    return res.status(200).json({ sfida, opzioni, ruolo: c.ruolo, nome: c.nome });
  }

  if (b.passo !== 'passkey' && b.passo !== 'pin') return res.status(400).json({ errore: 'Richiesta non valida.' });
  if (b.passo === 'pin' && !pinValido(b.pin)) return res.status(400).json({ errore: 'Il PIN deve avere 6 cifre.' });
  const sf = await prendiSfida(b.sfida, 'attiva');
  const c = sf && await codiceDaHash(sf.dati?.codice);
  if (!c) return res.status(400).json({ errore: SCADUTA });

  if (b.passo === 'pin') {
    if (c.ruolo !== 'staff') return res.status(403).json({ errore: 'Gabriele entra solo con la passkey.' });
    if (!await consumaCodice(c.hash)) return res.status(400).json({ errore: SCADUTA });
    const token = nuovoToken();
    await q(`INSERT INTO dispositivi (persona_id, token_hash, pin_hash) VALUES ($1, $2, $3)`, [c.personaId, sha(token), await hashPin(b.pin)]);
    aggiungiCookie(res, cookie('dispositivo', token, DISPOSITIVO));
    await registra(c.personaId, 'pin-creato');
  } else {
    const cred = await verificaRegistrazione(b.risposta, sf, e.s);
    if (!cred) return res.status(400).json({ errore: 'Attivazione non riuscita. Inserisci di nuovo il codice e riprova.' });
    if (!await consumaCodice(c.hash)) return res.status(400).json({ errore: SCADUTA });
    await salvaPasskey(c.personaId, cred);
    await registra(c.personaId, 'passkey-creata');
  }
  await registra(c.personaId, 'codice-usato');
  aggiungiCookie(res, await creaSessione({ id: c.personaId, ruolo: c.ruolo }));
  return res.status(200).json({ nome: c.nome, ruolo: c.ruolo });
}
