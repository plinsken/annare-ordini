import test from 'node:test';
import assert from 'node:assert/strict';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { nuovoAutenticatore } from './_autenticatore.js';
import { q } from '../api/_db.js';
import { nuovoCodice } from '../api/_codici.js';
import attiva from '../api/attiva.js';
import accesso from '../api/accesso.js';
import sessione from '../api/sessione.js';

await dbProva();
const persona = async (nome, ruolo = 'staff') => (await q(`INSERT INTO persone (nome, ruolo) VALUES ($1,$2) RETURNING id`, [nome, ruolo]))[0].id;
let ipN = 0;
const nuovoIp = () => `10.0.0.${++ipN}`;

async function attivaPasskey(codice, auth, jar = { c: '' }, uv = true) {
  const ip = nuovoIp();
  const a = await chiama(attiva, 'POST', { passo: 'codice', codice }, { ip }, jar);
  if (a.code !== 200) return a;
  return chiama(attiva, 'POST', { passo: 'passkey', sfida: a.body.sfida, risposta: auth.registra(a.body.opzioni, { uv }) }, { ip }, jar);
}
async function entraPasskey(auth, jar = { c: '' }, uv = true) {
  const o = await chiama(accesso, 'POST', { passo: 'opzioni' }, { ip: nuovoIp() }, jar);
  return chiama(accesso, 'POST', { passo: 'verifica', sfida: o.body.sfida, risposta: auth.accedi(o.body.opzioni, { uv }) }, { ip: nuovoIp() }, jar);
}

test('setup code -> passkey -> session; code works once and expires', async () => {
  const id = await persona('Anna');
  const codice = await nuovoCodice(id), auth = nuovoAutenticatore(), jar = { c: '' };
  assert.match(codice, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
  const r = await attivaPasskey(codice.toLowerCase().replace(/(.{5})/, '$1-'), auth, jar);
  assert.equal(r.code, 200);
  assert.deepEqual((await chiama(sessione, 'GET', undefined, {}, jar)).body, { nome: 'Anna', ruolo: 'staff', approva: false, gestisce: false, prova: true });

  const again = await chiama(attiva, 'POST', { passo: 'codice', codice }, { ip: nuovoIp() });
  assert.equal(again.code, 401);
  assert.equal(again.body.errore, 'Codice non valido o scaduto.');

  const vecchio = await nuovoCodice(id);
  await q(`UPDATE codici SET scade = now() - interval '1 hour' WHERE usato IS NULL`);
  assert.equal((await chiama(attiva, 'POST', { passo: 'codice', codice: vecchio }, { ip: nuovoIp() })).code, 401);
  const [{ n }] = await q(`SELECT count(*)::int n FROM codici WHERE hash = $1`, [codice]);
  assert.equal(n, 0, 'only the hash is stored');

  // later logins: passkey prompt only
  const j2 = { c: '' };
  assert.equal((await entraPasskey(auth, j2)).code, 200);
  assert.equal((await chiama(sessione, 'GET', undefined, {}, j2)).body.nome, 'Anna');
});

test('user verification is required to create and to use a passkey; challenges are single use', async () => {
  const id = await persona('Bruno');
  const auth = nuovoAutenticatore();
  assert.equal((await attivaPasskey(await nuovoCodice(id), auth, { c: '' }, false)).code, 400);
  assert.equal((await attivaPasskey(await nuovoCodice(id), auth)).code, 200);
  assert.equal((await entraPasskey(auth, { c: '' }, false)).code, 401);

  const o = await chiama(accesso, 'POST', { passo: 'opzioni' }, { ip: nuovoIp() });
  const risposta = auth.accedi(o.body.opzioni);
  assert.equal((await chiama(accesso, 'POST', { passo: 'verifica', sfida: o.body.sfida, risposta }, { ip: nuovoIp() })).code, 200);
  assert.equal((await chiama(accesso, 'POST', { passo: 'verifica', sfida: o.body.sfida, risposta }, { ip: nuovoIp() })).code, 401);
  assert.equal((await entraPasskey(nuovoAutenticatore())).code, 401, 'unknown passkey');
});

test('PIN fallback: tied to the phone, 5 wrong tries lock it, admins cannot use it', async () => {
  const id = await persona('Carla');
  const ip = nuovoIp(), jar = { c: '' };
  const a = await chiama(attiva, 'POST', { passo: 'codice', codice: await nuovoCodice(id) }, { ip }, jar);
  assert.equal((await chiama(attiva, 'POST', { passo: 'pin', sfida: a.body.sfida, pin: '12345' }, { ip }, jar)).code, 400);
  assert.equal((await chiama(attiva, 'POST', { passo: 'pin', sfida: a.body.sfida, pin: 'abcdef' }, { ip }, jar)).code, 400);
  const r = await chiama(attiva, 'POST', { passo: 'pin', sfida: a.body.sfida, pin: '123456' }, { ip }, jar);
  assert.equal(r.code, 200);
  assert.match(String(r.getHeader('set-cookie')), /dispositivo=.*Max-Age=34560000/);
  assert.match(jar.c, /dispositivo=/);

  // log out: the phone still knows its device, the app shows the PIN pad
  await chiama(sessione, 'DELETE', undefined, {}, jar);
  const g = await chiama(sessione, 'GET', undefined, {}, jar);
  assert.equal(g.code, 401);
  assert.equal(g.body.dispositivo, true);

  const pin = p => chiama(accesso, 'POST', { passo: 'pin', pin: p }, { ip: nuovoIp() }, jar);
  assert.equal((await pin('123456')).code, 200);
  const senza = await chiama(accesso, 'POST', { passo: 'pin', pin: '123456' }, { ip: nuovoIp(), cookie: '' });
  assert.equal(senza.code, 401);
  assert.equal(senza.body.errore, 'Questo telefono non è più attivo. Chiedi un nuovo codice a Gabriele.');

  for (let i = 0; i < 4; i++) assert.equal((await pin('000000')).code, 401);
  assert.equal((await pin('000000')).code, 423);
  await chiama(sessione, 'DELETE', undefined, {}, jar);
  const st = await chiama(sessione, 'GET', undefined, {}, jar);
  assert.deepEqual([st.code, st.body.dispositivo, st.body.bloccato], [401, true, true], 'the app can show the locked message');
  const bloccato = await pin('123456');
  assert.equal(bloccato.code, 423);
  assert.equal(bloccato.body.errore, 'Telefono bloccato. Chiedi un nuovo codice a Gabriele.');

  const admin = await persona('Gabriele', 'admin');
  const b = await chiama(attiva, 'POST', { passo: 'codice', codice: await nuovoCodice(admin) }, { ip });
  assert.equal(b.body.ruolo, 'admin');
  assert.equal((await chiama(attiva, 'POST', { passo: 'pin', sfida: b.body.sfida, pin: '123456' }, { ip })).code, 403);
});

test('PIN is stored salted; code redemption is rate limited', async () => {
  for (const nome of ['D1', 'D2']) {
    const ip = nuovoIp();
    const a = await chiama(attiva, 'POST', { passo: 'codice', codice: await nuovoCodice(await persona(nome)) }, { ip });
    await chiama(attiva, 'POST', { passo: 'pin', sfida: a.body.sfida, pin: '424242' }, { ip });
  }
  const righe = await q(`SELECT pin_hash FROM dispositivi d JOIN persone p ON p.id = d.persona_id WHERE p.nome IN ('D1','D2')`);
  assert.equal(righe.length, 2);
  assert.notEqual(righe[0].pin_hash, righe[1].pin_hash);
  assert.ok(righe.every(r => !r.pin_hash.includes('424242')));

  const ip = nuovoIp();
  for (let i = 0; i < 10; i++) assert.equal((await chiama(attiva, 'POST', { passo: 'codice', codice: 'XXXXXXXXXX' }, { ip })).code, 401);
  const r = await chiama(attiva, 'POST', { passo: 'codice', codice: 'XXXXXXXXXX' }, { ip });
  assert.equal(r.code, 429);
  assert.equal(r.body.errore, 'Troppi tentativi. Riprova tra qualche minuto.');
});

test('successful activations from one Wi-Fi do not use up the limit', async () => {
  const ip = nuovoIp();
  for (let i = 0; i < 12; i++) {
    const a = await chiama(attiva, 'POST', { passo: 'codice', codice: await nuovoCodice(await persona('W' + i)) }, { ip });
    assert.equal(a.code, 200, 'activation ' + (i + 1));
  }
});
