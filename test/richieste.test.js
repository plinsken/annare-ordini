import test from 'node:test';
import assert from 'node:assert/strict';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { conSessione } from './_flussi.js';
import { q } from '../api/_db.js';
import richieste from '../api/richieste.js';

await dbProva();
const a = await conSessione('Anna'), b = await conSessione('Bruno');
const ora = iso => { globalThis.__ora = () => new Date(iso); };
const corpo = (q = 2) => ({ sede: 'Bianconi', reparto: 'Pizzeria', righe: [{ cat: 'Latticini', nome: 'Brie', q }], nota: 'grazie' });

test('a request lands in the week of the next Friday 16:00', async () => {
  ora('2026-11-26T10:00:00Z');                       // Thursday
  const r = await chiama(richieste, 'POST', corpo(), {}, a.jar);
  assert.equal(r.code, 200);
  assert.equal(r.body.settimana, '2026-11-27');
  ora('2026-11-27T15:00:00Z');                       // Friday 16:00 Rome
  assert.equal((await chiama(richieste, 'POST', corpo(), {}, a.jar)).body.settimana, '2026-12-04');
  assert.equal((await chiama(richieste, 'POST', { ...corpo(), righe: [{ cat: 'Latticini', nome: 'Brie', q: 0 }] }, {}, a.jar)).code, 400);
});

test('edit and cancel only your own, only before the cut-off', async () => {
  ora('2026-12-01T10:00:00Z');
  const { id } = (await chiama(richieste, 'POST', corpo(1), {}, a.jar)).body;
  const sua = { query: { id: String(id) } };
  assert.equal((await chiama(richieste, 'PUT', corpo(5), sua, b.jar)).code, 404, 'not yours');
  assert.equal((await chiama(richieste, 'DELETE', undefined, sua, b.jar)).code, 404);
  assert.equal((await chiama(richieste, 'PUT', corpo(5), sua, a.jar)).code, 200);
  const [r] = await q(`SELECT righe FROM richieste WHERE id = $1`, [id]);
  assert.equal(r.righe[0].q, 5);

  ora('2026-12-04T15:00:01Z');                       // after Friday 16:00
  const tardi = await chiama(richieste, 'PUT', corpo(6), sua, a.jar);
  assert.equal(tardi.code, 409);
  assert.equal(tardi.body.errore, "Questa richiesta è già nell'ordine chiuso.");
  assert.equal((await chiama(richieste, 'DELETE', undefined, sua, a.jar)).code, 409);

  ora('2026-12-01T11:00:00Z');
  const { id: id2 } = (await chiama(richieste, 'POST', corpo(1), {}, a.jar)).body;
  assert.equal((await chiama(richieste, 'DELETE', undefined, { query: { id: String(id2) } }, a.jar)).code, 200);
  const lista = (await chiama(richieste, 'GET', undefined, {}, a.jar)).body;
  assert.ok(!lista.aperte.some(x => x.id === id2), 'cancelled is hidden');
});

test('a week already closed: new requests go to the next one, edits refused, insert guard holds', async () => {
  ora('2026-12-08T10:00:00Z');
  const { id } = (await chiama(richieste, 'POST', corpo(), {}, a.jar)).body;
  await q(`INSERT INTO settimane (settimana) VALUES ('2026-12-11')`);   // closed early on prova
  assert.equal((await chiama(richieste, 'POST', corpo(), {}, a.jar)).body.settimana, '2026-12-18');
  assert.equal((await chiama(richieste, 'PUT', corpo(3), { query: { id: String(id) } }, a.jar)).code, 409);
  // both this week and the next closed: the guard refuses, nothing is orphaned
  await q(`INSERT INTO settimane (settimana) VALUES ('2026-12-18')`);
  const r = await chiama(richieste, 'POST', corpo(), {}, a.jar);
  assert.equal(r.code, 409);
  const [{ n }] = await q(`SELECT count(*)::int n FROM richieste WHERE settimana = '2026-12-18'`);
  assert.equal(n, 1);
});

test('GET shows only your own requests', async () => {
  ora('2026-12-22T10:00:00Z');
  await chiama(richieste, 'POST', corpo(), {}, b.jar);
  const lista = (await chiama(richieste, 'GET', undefined, {}, a.jar)).body;
  assert.equal(lista.settimana, '2026-12-25');
  assert.ok([...lista.aperte, ...lista.passate].every(x => x.persona === undefined));
  const [{ n }] = await q(`SELECT count(*)::int n FROM richieste WHERE persona_id = $1 AND settimana = '2026-12-25'`, [b.id]);
  assert.equal(n, 1);
  assert.equal(lista.aperte.filter(x => x.settimana === '2026-12-25').length, 0);
  delete globalThis.__ora;
});
