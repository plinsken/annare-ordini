import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { conSessione, nuovoIp } from './_flussi.js';
import { q } from '../api/_db.js';
import { creaPdf } from '../api/_pdf.js';
import ordini from '../api/ordini.js';
import accesso from '../api/accesso.js';

await dbProva();
const g = await conSessione('Gabriele', 'admin'), s = await conSessione('Sara');
const righe = [
  { cat: 'Latticini', nome: 'Brie', dett: '', formato: 'forma 1 kg', q: 5, chi: [{ nome: 'Sara', q: 5, richiesta: 1 }] },
  { cat: 'Salumi', nome: 'Speck', dett: '', formato: '~2,5 kg', q: 2, chi: [{ nome: 'Sara', q: 2, richiesta: 1 }] },
];
const nuovoOrdine = async (sede = 'Bianconi', reparto = 'Pizzeria', r = righe) =>
  (await q(`INSERT INTO ordini (settimana, sede, reparto, righe, righe_originali, note) VALUES ('2026-11-27', $1, $2, $3, $3, '[{"nome":"Sara","nota":"entro sabato"}]') RETURNING id`, [sede, reparto, JSON.stringify(r)]))[0].id;

async function approva(ordine, qs, { uv = true, auth = g.auth, jar = g.jar } = {}) {
  const o = await chiama(ordini, 'POST', { passo: 'opzioni', ordine, righe: qs.map((q, indice) => ({ indice, q })) }, {}, jar);
  if (o.code !== 200) return o;
  return chiama(ordini, 'POST', { passo: 'approva', sfida: o.body.sfida, risposta: auth.accedi(o.body.opzioni, { uv }) }, {}, jar);
}
let email = [];
function produzione() {
  Object.assign(process.env, { VERCEL_ENV: 'production', RESEND_API_KEY: 're_x', ORDINI_DA: 'Ordini <o@x.it>', ORDINI_A: 'g@x.it' });
  globalThis.fetch = async (url, o) => { email.push({ ...JSON.parse(o.body), chiave: o.headers['Idempotency-Key'] }); return { ok: true }; };
}
const PROD = { origin: 'https://ordini.annarepizzeria.com' };

test('only Gabriele; approval needs a fresh, verified passkey', async () => {
  const id = await nuovoOrdine();
  assert.equal((await chiama(ordini, 'GET', undefined, {}, s.jar)).code, 403);
  assert.equal((await approva(id, [5, 2], { jar: s.jar, auth: s.auth })).code, 403);
  const r = await approva(id, [5, 2], { uv: false });
  assert.equal(r.code, 401);
  const [{ stato }] = await q(`SELECT stato FROM ordini WHERE id = $1`, [id]);
  assert.equal(stato, 'da_approvare');
  // a login challenge can't be used to approve
  const login = await chiama(accesso, 'POST', { passo: 'opzioni' }, { ip: nuovoIp() });
  const furbo = await chiama(ordini, 'POST', { passo: 'approva', sfida: login.body.sfida, risposta: g.auth.accedi(login.body.opzioni) }, {}, g.jar);
  assert.equal(furbo.code, 400);
  assert.equal((await chiama(ordini, 'POST', { passo: 'opzioni', ordine: id, righe: [{ indice: 0, q: 5 }] }, {}, g.jar)).code, 400, 'every line needed');
  assert.equal((await chiama(ordini, 'POST', { passo: 'opzioni', ordine: id, righe: [{ indice: 0, q: 100 }, { indice: 1, q: 2 }] }, {}, g.jar)).code, 400);
});

test('edit, approve, PDF email once; second approval is refused', async () => {
  const id = await nuovoOrdine('Regina Margherita');
  email = [];
  produzione();
  const r = await approva(id, [3, 0], {});
  process.env.VERCEL_ENV = 'development';
  assert.equal(r.code, 403, 'origin is checked in production');
  produzione();
  const o = await chiama(ordini, 'POST', { passo: 'opzioni', ordine: id, righe: [{ indice: 0, q: 3 }, { indice: 1, q: 0 }] }, PROD, g.jar);
  const ok = await chiama(ordini, 'POST', { passo: 'approva', sfida: o.body.sfida, risposta: authProd().accedi(o.body.opzioni) }, PROD, g.jar);
  process.env.VERCEL_ENV = 'development';
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { stato: 'approvato', email: true });
  const [row] = await q(`SELECT righe, righe_originali, stato, email_inviata FROM ordini WHERE id = $1`, [id]);
  assert.deepEqual(row.righe.map(x => x.q), [3, 0]);
  assert.deepEqual(row.righe_originali.map(x => x.q), [5, 2]);
  assert.ok(row.email_inviata);
  assert.equal(email.length, 1);
  assert.equal(email[0].chiave, 'ordine-' + id);
  assert.ok(email[0].attachments[0].content.startsWith('JVBER'));
  const [log] = await q(`SELECT dettagli FROM registro WHERE azione = 'ordine-modificato' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual(log.dettagli.modifiche, [{ nome: 'Brie', prima: 5, dopo: 3 }, { nome: 'Speck', prima: 2, dopo: 0 }]);
  const again = await approva(id, [3, 0]);
  assert.equal(again.code, 409);
  assert.equal(again.body.errore, 'Ordine già approvato.');
});

test('removing every line rejects the order, no email', async () => {
  email = [];
  const id = await nuovoOrdine('Bianconi', 'Bar');
  const r = await approva(id, [0, 0]);
  assert.deepEqual(r.body, { stato: 'rifiutato', email: false });
  assert.equal(email.length, 0);
});

test('list and PDF download', async () => {
  const lista = (await chiama(ordini, 'GET', undefined, {}, g.jar)).body;
  assert.ok(lista.da_approvare.length >= 1);
  assert.ok(lista.recenti.some(o => o.stato === 'approvato'));
  assert.equal(lista.da_approvare[0].righe[0].chi[0].nome, 'Sara');
  const approvato = lista.recenti.find(o => o.stato === 'approvato');
  const pdf = await chiama(ordini, 'GET', undefined, { query: { pdf: String(approvato.id) } }, g.jar);
  assert.equal(pdf.code, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(Buffer.from(pdf.body).subarray(0, 4).toString(), '%PDF');
  assert.equal((await chiama(ordini, 'GET', undefined, { query: { pdf: String(lista.da_approvare[0].id) } }, g.jar)).code, 404);
});

test('server PDF: fonts, two pages for a long order', async () => {
  const lunghe = Array.from({ length: 40 }, (_, i) => ({ nome: 'Prodotto ' + i, dett: '', formato: 'kg', q: i % 7 ? i : null }));
  const bytes = await creaPdf({ num: '12', data: '27/11/2026', ora: '16:30', sede: 'Bianconi', reparto: 'Pizzeria', approvatoDa: 'Gabriele', settimana: '2026-11-27', gruppi: [{ cat: 'Varie', righe: lunghe }], note: 'Sara: entro sabato' });
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), '%PDF');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

// The production RP ID differs from localhost, so production approvals need a passkey made for it.
let prodAuth;
function authProd() { return prodAuth; }
test.before(async () => {
  const { nuovoAutenticatore } = await import('./_autenticatore.js');
  const { salvaPasskey } = await import('../api/_passkey.js');
  prodAuth = nuovoAutenticatore({ rpID: 'ordini.annarepizzeria.com', origin: 'https://ordini.annarepizzeria.com' });
  // register it the normal way under production settings
  const { opzioniRegistrazione, verificaRegistrazione } = await import('../api/_passkey.js');
  const sp = { rpID: 'ordini.annarepizzeria.com', origin: 'https://ordini.annarepizzeria.com' };
  const op = await opzioniRegistrazione({ id: g.id, nome: 'Gabriele' }, sp);
  await salvaPasskey(g.id, await verificaRegistrazione(prodAuth.registra(op), { sfida: op.challenge }, sp));
});
