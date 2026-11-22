// Shared test flows: people with a live session.
import { chiama } from './_http.js';
import { nuovoAutenticatore } from './_autenticatore.js';
import { q } from '../api/_db.js';
import { nuovoCodice } from '../api/_codici.js';
import attiva from '../api/attiva.js';
import accesso from '../api/accesso.js';

let n = 0;
export const nuovoIp = () => `10.9.${n >> 8 & 255}.${++n & 255}`;
export const persona = async (nome, ruolo = 'staff') => (await q(`INSERT INTO persone (nome, ruolo) VALUES ($1,$2) RETURNING id`, [nome, ruolo]))[0].id;

export async function attivaPasskey(codice, auth = nuovoAutenticatore(), jar = { c: '' }) {
  const ip = nuovoIp();
  const a = await chiama(attiva, 'POST', { passo: 'codice', codice }, { ip }, jar);
  const r = a.code === 200 ? await chiama(attiva, 'POST', { passo: 'passkey', sfida: a.body.sfida, risposta: auth.registra(a.body.opzioni) }, { ip }, jar) : a;
  return { r, auth, jar };
}
export async function entraPasskey(auth, jar = { c: '' }) {
  const o = await chiama(accesso, 'POST', { passo: 'opzioni' }, { ip: nuovoIp() }, jar);
  return chiama(accesso, 'POST', { passo: 'verifica', sfida: o.body.sfida, risposta: auth.accedi(o.body.opzioni) }, { ip: nuovoIp() }, jar);
}
// A person with an activated passkey and a session: {id, auth, jar}.
export async function conSessione(nome, ruolo = 'staff') {
  const id = await persona(nome, ruolo);
  const { auth, jar } = await attivaPasskey(await nuovoCodice(id));
  return { id, auth, jar };
}
