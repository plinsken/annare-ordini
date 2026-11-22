import test from 'node:test';
import assert from 'node:assert/strict';
import { chiama } from './_http.js';
import { dbProva } from './_db.js';
import { conSessione, persona } from './_flussi.js';
import { q } from '../api/_db.js';
import chiusura, { chiudi } from '../api/chiusura.js';

await dbProva();
const anna = await persona('Anna'), bruno = await persona('Bruno');
const brie = q => [{ cat: 'Latticini', nome: 'Brie', dett: '', formato: 'forma 1 kg', q }];
const richiesta = (p, settimana, sede = 'Bianconi', reparto = 'Pizzeria', righe = brie(1)) =>
  q(`INSERT INTO richieste (persona_id, settimana, sede, reparto, righe) VALUES ($1,$2,$3,$4,$5)`, [p, settimana, sede, reparto, JSON.stringify(righe)]);

let email = [];
function produzione(fallisce = false) {
  Object.assign(process.env, { VERCEL_ENV: 'production', RESEND_API_KEY: 're_x', ORDINI_DA: 'Ordini <o@x.it>', ORDINI_A: 'g@x.it' });
  globalThis.fetch = async (url, o) => { if (fallisce) return { ok: false, status: 500, text: async () => 'no' }; email.push({ ...JSON.parse(o.body), chiave: o.headers['Idempotency-Key'] }); return { ok: true }; };
}
const sviluppo = () => { process.env.VERCEL_ENV = 'development'; };

test('nothing before 16:01, then one order per sede+reparto and one email without details', async () => {
  await richiesta(anna, '2026-11-27', 'Bianconi', 'Pizzeria', brie(2));
  await richiesta(bruno, '2026-11-27', 'Bianconi', 'Pizzeria', brie(3));
  await richiesta(bruno, '2026-11-27', 'Regina Margherita', 'Bar', [{ cat: 'Caffè', nome: 'Caffè in grani', dett: '', formato: '1 kg', q: 1 }]);
  await q(`INSERT INTO richieste (persona_id, settimana, sede, reparto, righe, annullata) VALUES ($1,'2026-11-27','Bianconi','Cucina',$2, now())`, [anna, JSON.stringify(brie(9))]);
  produzione();
  assert.deepEqual(await chiudi(new Date('2026-11-27T15:00:30Z')), { chiuse: [], email: false });
  const r = await chiudi(new Date('2026-11-27T15:02:00Z'));
  assert.deepEqual(r, { chiuse: ['2026-11-27'], email: true });
  const ordini = await q(`SELECT sede, reparto, righe FROM ordini ORDER BY sede, reparto`);
  assert.deepEqual(ordini.map(o => o.sede + '/' + o.reparto), ['Bianconi/Pizzeria', 'Regina Margherita/Bar'], 'cancelled request ignored');
  assert.equal(ordini[0].righe[0].q, 5);
  assert.equal(email.length, 1);
  assert.equal(email[0].subject, 'Ordine della settimana pronto, da approvare');
  assert.match(email[0].text, /https:\/\/ordini\.annarepizzeria\.com\/#gestione/);
  assert.match(email[0].text, /da approvare: 2/);
  assert.doesNotMatch(email[0].text + email[0].subject, /Brie|Anna|Bruno|Caffè/);
  assert.equal(email[0].attachments, undefined);
  sviluppo();
});

test('two runs at once: one set of orders, one email; an empty week sends nothing', async () => {
  email = [];
  await richiesta(anna, '2026-12-04');
  produzione();
  const [a, b] = await Promise.all([chiudi(new Date('2026-12-04T15:05:00Z')), chiudi(new Date('2026-12-04T15:05:00Z'))]);
  assert.equal(a.chiuse.length + b.chiuse.length, 1);
  assert.equal(email.length, 1);
  const [{ n }] = await q(`SELECT count(*)::int n FROM ordini WHERE settimana = '2026-12-04'`);
  assert.equal(n, 1);
  assert.match(email[0].text, /da approvare: 3/, 'last week\'s unapproved orders are counted too');
  email = [];
  assert.deepEqual(await chiudi(new Date('2026-12-11T15:05:00Z')), { chiuse: [], email: false });
  assert.equal(email.length, 0);
  sviluppo();
});

test('a failed send is retried by the next run; a missed run is caught up later', async () => {
  email = [];
  await richiesta(anna, '2026-12-18');
  produzione(true);
  const r = await chiudi(new Date('2026-12-18T15:02:00Z'));
  assert.deepEqual(r, { chiuse: ['2026-12-18'], email: false });
  const [s] = await q(`SELECT email_inviata FROM settimane WHERE settimana = '2026-12-18'`);
  assert.equal(s.email_inviata, null);
  produzione();
  assert.deepEqual(await chiudi(new Date('2026-12-18T16:02:00Z')), { chiuse: [], email: true });
  assert.equal(email.length, 1);
  await richiesta(bruno, '2026-12-25');
  assert.deepEqual((await chiudi(new Date('2026-12-26T09:00:00Z'))).chiuse, ['2026-12-25'], 'late run still closes');
  sviluppo();
});

test('previews never email, but still close', async () => {
  email = [];
  await richiesta(anna, '2027-01-01');
  produzione(); sviluppo();             // keys present, but this is not production
  assert.deepEqual(await chiudi(new Date('2027-01-01T15:02:00Z')), { chiuse: ['2027-01-01'], email: false });
  assert.equal(email.length, 0);
});

test('retention: old orders and log go, recent stay', async () => {
  await richiesta(anna, '2024-01-05');
  await q(`INSERT INTO registro (quando, azione) VALUES (now() - interval '400 days', 'vecchio'), (now(), 'nuovo')`);
  await chiudi(new Date());
  const [{ n }] = await q(`SELECT count(*)::int n FROM richieste WHERE settimana = '2024-01-05'`);
  assert.equal(n, 0);
  assert.deepEqual((await q(`SELECT azione FROM registro WHERE azione IN ('vecchio','nuovo')`)).map(r => r.azione), ['nuovo']);
});

test('cron needs the secret; "chiudi ora" is admin-only and only on prova', async () => {
  process.env.CRON_SECRET = 's'.repeat(32);
  assert.equal((await chiama(chiusura, 'GET', undefined, {})).code, 401);
  assert.equal((await chiama(chiusura, 'GET', undefined, { headers: { authorization: 'Bearer sbagliato' } })).code, 401);
  assert.equal((await chiama(chiusura, 'GET', undefined, { headers: { authorization: 'Bearer ' + 's'.repeat(32) } })).code, 200);
  const s = await conSessione('Sara'), g = await conSessione('Gabriele', 'admin');
  assert.equal((await chiama(chiusura, 'POST', {}, {}, s.jar)).code, 403);
  await q(`INSERT INTO richieste (persona_id, settimana, sede, reparto, righe) VALUES ($1, '2030-01-04', 'Bianconi', 'Pizzeria', $2)`, [s.id, JSON.stringify(brie(1))]);
  const r = await chiama(chiusura, 'POST', {}, {}, g.jar);
  assert.equal(r.code, 200);
  assert.ok(r.body.chiuse.includes('2030-01-04'), 'closes open weeks without waiting for Friday');
  process.env.VERCEL_ENV = 'production';
  assert.equal((await chiama(chiusura, 'POST', {}, { origin: 'https://ordini.annarepizzeria.com' }, g.jar)).code, 404);
  sviluppo();
});
