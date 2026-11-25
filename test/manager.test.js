import test from 'node:test';
import assert from 'node:assert/strict';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { conSessione, attivaPasskey, entraPasskey, nuovoIp } from './_flussi.js';
import { q } from '../api/_db.js';
import persone from '../api/persone.js';
import ordini from '../api/ordini.js';
import sessione from '../api/sessione.js';
import attiva from '../api/attiva.js';
import accesso from '../api/accesso.js';

await dbProva();
const g = await conSessione('Gabriele', 'admin');

// Sends a people request as `chi`; if Face ID is asked for, answers it (uv false = no Face ID).
async function persona(chi, body, { uv = true } = {}) {
  const r = await chiama(persone, 'POST', body, {}, chi.jar);
  if (!r.body?.conferma) return r;
  return chiama(persone, 'POST', { azione: 'conferma', sfida: r.body.sfida, risposta: chi.auth.accedi(r.body.opzioni, { uv }) }, {}, chi.jar);
}
const ruolo = (chi, p, ruolo, approva = false, gestisce = false, opz) => persona(chi, { persona: p.id, azione: 'ruolo', ruolo, approva, gestisce }, opz);
const io = async p => (await chiama(sessione, 'GET', undefined, {}, p.jar)).body;

test('making a manager needs Gabriele\'s Face ID; rights start off and apply at once', async () => {
  const m = await conSessione('Marta');
  const chiede = await chiama(persone, 'POST', { persona: m.id, azione: 'ruolo', ruolo: 'manager', approva: false, gestisce: false }, {}, g.jar);
  assert.equal(chiede.body.conferma, true, 'asks for Face ID');
  assert.equal((await ruolo(g, m, 'manager', false, false, { uv: false })).code, 401);
  assert.equal((await q(`SELECT ruolo FROM persone WHERE id = $1`, [m.id]))[0].ruolo, 'staff');

  assert.equal((await ruolo(g, m, 'manager')).code, 200);
  assert.equal((await chiama(sessione, 'GET', undefined, {}, m.jar)).code, 401, 'new role, new login');
  assert.equal((await entraPasskey(m.auth, m.jar)).code, 200);
  assert.deepEqual(await io(m), { nome: 'Marta', ruolo: 'manager', approva: false, gestisce: false, prova: true });
  assert.equal((await chiama(ordini, 'GET', undefined, {}, m.jar)).code, 403);
  assert.equal((await chiama(persone, 'GET', undefined, {}, m.jar)).code, 403);

  assert.equal((await ruolo(g, m, 'manager', true, false)).code, 200);
  assert.equal((await chiama(ordini, 'GET', undefined, {}, m.jar)).code, 200, 'same session, right on');
  const tolto = await chiama(persone, 'POST', { persona: m.id, azione: 'ruolo', ruolo: 'manager', approva: false, gestisce: false }, {}, g.jar);
  assert.equal(tolto.code, 200, 'taking a right away needs no Face ID');
  assert.equal((await chiama(ordini, 'GET', undefined, {}, m.jar)).code, 403, 'off at once');
  const [{ n }] = await q(`SELECT count(*)::int n FROM registro WHERE azione = 'ruolo-cambiato'`);
  assert.equal(n, 3);
});

test('a manager who manages people: staff only, never Gabriele, managers, roles or themselves', async () => {
  const m = await conSessione('Mario');
  assert.equal((await ruolo(g, m, 'manager', false, true)).code, 200);
  await entraPasskey(m.auth, m.jar);
  const altro = await conSessione('Matteo');
  assert.equal((await ruolo(g, altro, 'manager')).code, 200);

  assert.equal((await chiama(persone, 'GET', undefined, {}, m.jar)).code, 200);
  const nuovo = await chiama(persone, 'POST', { nome: 'Nina' }, {}, m.jar);
  assert.equal(nuovo.code, 200);
  assert.equal((await persona(m, { persona: nuovo.body.id, azione: 'codice' })).code, 200);
  assert.equal((await chiama(persone, 'DELETE', undefined, { query: { persona: String(nuovo.body.id) } }, m.jar)).code, 200);

  for (const p of [g, altro, m]) {
    assert.equal((await persona(m, { persona: p.id, azione: 'codice' })).code, 403);
    assert.equal((await persona(m, { persona: p.id, azione: 'telefono-perso' })).code, 403);
    assert.equal((await chiama(persone, 'DELETE', undefined, { query: { persona: String(p.id) } }, m.jar)).code, 403);
  }
  const s = await conSessione('Sofia');
  assert.equal((await ruolo(m, s, 'manager', true, true)).code, 403, 'only Gabriele makes managers');
  assert.equal((await ruolo(g, g, 'staff')).code, 400, 'Gabriele stays Gabriele');
});

test('manager codes need Face ID; managers have no PIN; promotion ends PIN phones', async () => {
  const p = await conSessione('Piero');
  // Piero also has a PIN phone
  const codice = (await persona(g, { persona: p.id, azione: 'codice' })).body.codice;
  const jar = { c: '' }, ip = nuovoIp();
  const a = await chiama(attiva, 'POST', { passo: 'codice', codice }, { ip }, jar);
  assert.equal((await chiama(attiva, 'POST', { passo: 'pin', sfida: a.body.sfida, pin: '123456' }, { ip }, jar)).code, 200);

  assert.equal((await ruolo(g, p, 'manager', true, false)).code, 200);
  assert.equal((await chiama(accesso, 'POST', { passo: 'pin', pin: '123456' }, { ip: nuovoIp() }, jar)).code, 401, 'PIN phone gone');

  const chiede = await chiama(persone, 'POST', { persona: p.id, azione: 'codice' }, {}, g.jar);
  assert.equal(chiede.body.conferma, true);
  assert.equal(chiede.body.codice, undefined);
  const nuovo = (await persona(g, { persona: p.id, azione: 'codice' })).body.codice;
  const b = await chiama(attiva, 'POST', { passo: 'codice', codice: nuovo }, { ip }, { c: '' });
  const pin = await chiama(attiva, 'POST', { passo: 'pin', sfida: b.body.sfida, pin: '123456' }, { ip }, { c: '' });
  assert.equal(pin.code, 403);
  assert.equal((await attivaPasskey(nuovo)).r.code, 200, 'a passkey works');
});

test('a confirmation is only for the person and the request it was made for', async () => {
  const s = await conSessione('Sergio');
  const r = await chiama(persone, 'POST', { persona: s.id, azione: 'ruolo', ruolo: 'manager', approva: true, gestisce: true }, {}, g.jar);
  const login = await chiama(accesso, 'POST', { passo: 'opzioni' }, { ip: nuovoIp() });
  const furbo = await chiama(persone, 'POST', { azione: 'conferma', sfida: login.body.sfida, risposta: g.auth.accedi(login.body.opzioni) }, {}, g.jar);
  assert.equal(furbo.code, 400);
  const ok = await chiama(persone, 'POST', { azione: 'conferma', sfida: r.body.sfida, risposta: g.auth.accedi(r.body.opzioni) }, {}, g.jar);
  assert.equal(ok.code, 200);
  const [x] = await q(`SELECT ruolo, puo_approvare, puo_gestire FROM persone WHERE id = $1`, [s.id]);
  assert.deepEqual(x, { ruolo: 'manager', puo_approvare: true, puo_gestire: true });
  const again = await chiama(persone, 'POST', { azione: 'conferma', sfida: r.body.sfida, risposta: g.auth.accedi(r.body.opzioni) }, {}, g.jar);
  assert.equal(again.code, 400, 'single use');
});
