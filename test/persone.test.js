import test from 'node:test';
import assert from 'node:assert/strict';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { conSessione, attivaPasskey, entraPasskey } from './_flussi.js';
import { q } from '../api/_db.js';
import persone from '../api/persone.js';
import sessione from '../api/sessione.js';

await dbProva();
const g = await conSessione('Gabriele', 'admin');

test('staff cannot manage people', async () => {
  const s = await conSessione('Sara');
  for (const [m, b, query] of [['GET'], ['POST', { nome: 'X' }], ['DELETE', undefined, { persona: String(g.id) }]])
    assert.equal((await chiama(persone, m, b, { query }, s.jar)).code, 403);
});

test('add a person, they activate with the code, list shows how they log in', async () => {
  const r = await chiama(persone, 'POST', { nome: '  Luca\nBianchi ' }, {}, g.jar);
  assert.equal(r.code, 200);
  assert.match(r.body.codice, /^[A-Z2-9]{10}$/);
  const { r: a } = await attivaPasskey(r.body.codice);
  assert.equal(a.code, 200);
  assert.equal(a.body.nome, 'Luca Bianchi');
  const lista = (await chiama(persone, 'GET', undefined, {}, g.jar)).body;
  const luca = lista.find(p => p.id === r.body.id);
  assert.equal(luca.accesso, 'passkey');
  assert.equal(luca.ruolo, 'staff');
  assert.equal((await chiama(persone, 'POST', { nome: '' }, {}, g.jar)).code, 400);
  assert.equal((await chiama(persone, 'POST', { nome: 'x'.repeat(61) }, {}, g.jar)).code, 400);
});

test('lost phone shuts out passkeys and sessions; a new code lets them back in', async () => {
  const m = await conSessione('Marco');
  assert.equal((await chiama(persone, 'POST', { persona: m.id, azione: 'telefono-perso' }, {}, g.jar)).code, 200);
  assert.equal((await chiama(sessione, 'GET', undefined, {}, m.jar)).code, 401, 'session gone');
  assert.equal((await entraPasskey(m.auth)).code, 401, 'passkey gone');
  const nuovo = await chiama(persone, 'POST', { persona: m.id, azione: 'codice' }, {}, g.jar);
  assert.equal((await attivaPasskey(nuovo.body.codice)).r.code, 200);
});

test('remove a person: out everywhere, off the list, old code dead; not yourself', async () => {
  const p = await conSessione('Paola');
  const codice = (await chiama(persone, 'POST', { persona: p.id, azione: 'codice' }, {}, g.jar)).body.codice;
  assert.equal((await chiama(persone, 'DELETE', undefined, { query: { persona: String(p.id) } }, g.jar)).code, 200);
  assert.equal((await chiama(sessione, 'GET', undefined, {}, p.jar)).code, 401);
  assert.ok(!(await chiama(persone, 'GET', undefined, {}, g.jar)).body.some(x => x.id === p.id));
  assert.equal((await attivaPasskey(codice)).r.code, 401);
  assert.equal((await chiama(persone, 'POST', { persona: p.id, azione: 'codice' }, {}, g.jar)).code, 404);
  const self = await chiama(persone, 'DELETE', undefined, { query: { persona: String(g.id) } }, g.jar);
  assert.equal(self.code, 400);
  assert.equal(self.body.errore, 'Non puoi rimuovere te stesso.');
  const [{ n }] = await q(`SELECT count(*)::int n FROM registro WHERE azione IN ('persona-aggiunta','persona-rimossa','telefono-perso','codice-creato')`);
  assert.ok(n >= 5);
});
