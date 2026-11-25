import test from 'node:test';
import assert from 'node:assert/strict';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { conSessione, entraPasskey } from './_flussi.js';
import { q } from '../api/_db.js';
import { leggiAccesso } from '../api/_prodotti.js';
import persone from '../api/persone.js';
import ordini from '../api/ordini.js';
import richieste from '../api/richieste.js';
import sessione from '../api/sessione.js';

await dbProva();
const g = await conSessione('Gabriele', 'admin');
globalThis.__ora = () => new Date('2026-12-01T10:00:00Z');
const CUCINA = { sede: 'Bianconi', reparto: 'Cucina', righe: [{ cat: 'Pomodoro', nome: 'Passata di pomodoro', q: 2 }] };
const PIZZA = { sede: 'Bianconi', reparto: 'Pizzeria', righe: [{ cat: 'Farine e lievito', nome: 'Farina 00 Caputo Saccorosso', q: 1 }] };
const dove = (sedi, reparti) => ({ sedi, reparti });

async function persona(chi, body, { uv = true } = {}) {
  const r = await chiama(persone, 'POST', body, {}, chi.jar);
  if (!r.body?.conferma) return r;
  return chiama(persone, 'POST', { azione: 'conferma', sfida: r.body.sfida, risposta: chi.auth.accedi(r.body.opzioni, { uv }) }, {}, chi.jar);
}
const imposta = (id, sedi, reparti) => q(`UPDATE persone SET sedi = $2, reparti = $3 WHERE id = $1`, [id, sedi, reparti]);

test('reading access: one of each at least, known names, all ticked = null', () => {
  assert.deepEqual(leggiAccesso(dove(['Bianconi'], ['Cucina'])), { sedi: ['Bianconi'], reparti: ['Cucina'] });
  assert.deepEqual(leggiAccesso(dove(['Bianconi', 'Regina Margherita'], ['Cucina'])), { sedi: null, reparti: ['Cucina'] });
  for (const bad of [dove([], ['Cucina']), dove(['Bianconi'], undefined), dove(['Roma'], ['Cucina']), dove(['Bianconi', 'Bianconi'], ['Cucina'])])
    assert.equal(leggiAccesso(bad), null);
});

test('a Bianconi chef orders kitchen stuff in Bianconi only', async () => {
  const c = await conSessione('Carlo');
  await imposta(c.id, ['Bianconi'], ['Cucina']);
  const s = (await chiama(sessione, 'GET', undefined, {}, c.jar)).body;
  assert.deepEqual([s.sedi, s.reparti], [['Bianconi'], ['Cucina']]);
  assert.equal((await chiama(richieste, 'POST', CUCINA, {}, c.jar)).code, 200);
  assert.equal((await chiama(richieste, 'POST', PIZZA, {}, c.jar)).code, 403);
  assert.equal((await chiama(richieste, 'POST', { ...CUCINA, sede: 'Regina Margherita' }, {}, c.jar)).code, 403);
  // a request made before the limit can be cancelled but not edited
  await imposta(c.id, null, null);
  const { id } = (await chiama(richieste, 'POST', PIZZA, {}, c.jar)).body;
  await imposta(c.id, ['Bianconi'], ['Cucina']);
  assert.equal((await chiama(richieste, 'PUT', PIZZA, { query: { id: String(id) } }, c.jar)).code, 403);
  assert.equal((await chiama(richieste, 'DELETE', undefined, { query: { id: String(id) } }, c.jar)).code, 200);
});

test('a manager approves only orders for their shops and departments', async () => {
  const m = await conSessione('Mirko');
  await q(`UPDATE persone SET ruolo = 'manager', puo_approvare = true, sedi = '{Bianconi}', reparti = '{Cucina}' WHERE id = $1`, [m.id]);
  const nuovo = async (sede, reparto, stato = 'da_approvare') => (await q(`INSERT INTO ordini (settimana, sede, reparto, righe, righe_originali, stato)
    VALUES ('2026-11-27', $1, $2, '[{"cat":"x","nome":"y","q":1,"chi":[]}]', '[]', $3) RETURNING id`, [sede, reparto, stato]))[0].id;
  const mio = await nuovo('Bianconi', 'Cucina'), altro = await nuovo('Bianconi', 'Bar'), fatto = await nuovo('Regina Margherita', 'Cucina', 'approvato');
  const lista = (await chiama(ordini, 'GET', undefined, {}, m.jar)).body;
  assert.deepEqual(lista.da_approvare.map(o => o.id), [mio]);
  assert.equal(lista.recenti.length, 0);
  assert.equal((await chiama(ordini, 'GET', undefined, {}, g.jar)).body.da_approvare.length, 2, 'Gabriele sees all');
  const opz = r => chiama(ordini, 'POST', { passo: 'opzioni', ordine: r, righe: [{ indice: 0, q: 1 }] }, {}, m.jar);
  assert.equal((await opz(altro)).code, 403);
  assert.equal((await chiama(ordini, 'GET', undefined, { query: { pdf: String(fatto) } }, m.jar)).code, 404);
  // access narrowed between the challenge and the Face ID: refused
  const o = await opz(mio);
  await imposta(m.id, ['Bianconi'], ['Pizzeria']);
  const v = await chiama(ordini, 'POST', { passo: 'approva', sfida: o.body.sfida, risposta: m.auth.accedi(o.body.opzioni) }, {}, m.jar);
  assert.equal(v.code, 403);
  assert.equal((await q(`SELECT stato FROM ordini WHERE id = $1`, [mio]))[0].stato, 'da_approvare');
});

test('a manager manages only staff within their access, and gives only what they have', async () => {
  const m = await conSessione('Monica');
  await q(`UPDATE persone SET ruolo = 'manager', puo_gestire = true, sedi = '{Bianconi}', reparti = '{Cucina,Pizzeria}' WHERE id = $1`, [m.id]);
  assert.equal((await chiama(persone, 'POST', { nome: 'Ugo', ...dove(['Regina Margherita'], ['Cucina']) }, {}, m.jar)).code, 403);
  const ugo = await chiama(persone, 'POST', { nome: 'Ugo', ...dove(['Bianconi'], ['Cucina']) }, {}, m.jar);
  assert.equal(ugo.code, 200);
  assert.equal((await persona(m, { persona: ugo.body.id, azione: 'modifica', ...dove(['Bianconi'], ['Pizzeria']) })).code, 200);
  assert.equal((await persona(m, { persona: ugo.body.id, azione: 'modifica', ...dove(['Bianconi'], ['Bar']) })).code, 403);
  assert.equal((await persona(m, { persona: ugo.body.id, azione: 'modifica', ruolo: 'manager', approva: true, gestisce: false, ...dove(['Bianconi'], ['Cucina']) })).code, 403);

  const tutto = await conSessione('Tina');   // full access, so Gabriele's
  const lista = (await chiama(persone, 'GET', undefined, {}, m.jar)).body;
  assert.equal(lista.find(p => p.id === tutto.id).puoi, false);
  assert.equal(lista.find(p => p.id === ugo.body.id).puoi, true);
  assert.equal((await persona(m, { persona: tutto.id, azione: 'codice' })).code, 403);
  assert.equal((await chiama(persone, 'DELETE', undefined, { query: { persona: String(tutto.id) } }, m.jar)).code, 403);
  assert.equal((await chiama(persone, 'POST', { nome: 'Zeta' }, {}, g.jar)).code, 400, 'access is required');
});

test('wider access for a manager needs Gabriele\'s Face ID; narrower does not', async () => {
  const m = await conSessione('Max');
  const base = { persona: m.id, azione: 'modifica', ruolo: 'manager', approva: true, gestisce: false };
  assert.equal((await persona(g, { ...base, ...dove(['Bianconi'], ['Cucina']) })).code, 200);
  await entraPasskey(m.auth, m.jar);
  const piu = await chiama(persone, 'POST', { ...base, ...dove(['Bianconi', 'Regina Margherita'], ['Cucina']) }, {}, g.jar);
  assert.equal(piu.body.conferma, true);
  const meno = await chiama(persone, 'POST', { ...base, ...dove(['Bianconi'], ['Cucina']) }, {}, g.jar);
  assert.equal(meno.code, 200);
  assert.equal(meno.body.conferma, undefined);
  assert.equal((await chiama(sessione, 'GET', undefined, {}, m.jar)).code, 200, 'same role: still logged in');
  const staff = await conSessione('Sam');
  const s = await chiama(persone, 'POST', { persona: staff.id, azione: 'modifica', ruolo: 'staff', approva: false, gestisce: false, ...dove(['Bianconi'], ['Bar']) }, {}, g.jar);
  assert.equal(s.code, 200);
  assert.equal(s.body.conferma, undefined, 'staff access needs no Face ID');
});
