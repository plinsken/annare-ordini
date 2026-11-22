import test from 'node:test';
import assert from 'node:assert/strict';
import { finto, req, biscotti } from './_http.js';
import { dbProva } from './_db.js';
import { q } from '../api/_db.js';
import { sito } from '../api/_sito.js';
import { creaSessione, chi, esci, revoca, entrata } from '../api/_sessioni.js';
import { limite } from '../api/_limiti.js';
import { registra } from '../api/_registro.js';

await dbProva();
const persona = async (nome, ruolo = 'staff') => (await q(`INSERT INTO persone (nome, ruolo) VALUES ($1,$2) RETURNING id, ruolo`, [nome, ruolo]))[0];
const jar = c => biscotti({ getHeader: () => c });

test('sito: only known hosts, never the Host header', () => {
  assert.equal(sito({ VERCEL_ENV: 'production' }).origin, 'https://ordini.annarepizzeria.com');
  assert.equal(sito({ VERCEL_ENV: 'production' }).prova, false);
  const p = sito({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'prova' });
  assert.equal(p.rpID, 'annare-ordini-git-prova-plinskens-projects.vercel.app');
  assert.equal(p.prova, true);
  assert.equal(sito({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'altro' }), null);
  assert.equal(sito({}), null);
  assert.equal(sito({ VERCEL_ENV: 'development' }).origin, 'http://localhost:3000');
});

test('entrata: origin check for writes, roles', async () => {
  let r = finto(); assert.equal(await entrata(req('POST', {}, { origin: 'https://evil.example' }), r, 'nessuno'), null);
  assert.equal(r.code, 403);
  r = finto(); assert.equal(await entrata(req('POST', {}, { headers: { origin: undefined } }), r, 'nessuno'), null);
  assert.equal(r.code, 403);
  r = finto(); assert.ok(await entrata(req('GET', undefined, { headers: { origin: undefined } }), r, 'nessuno'));
  assert.equal(r.headers['cache-control'], 'no-store');
  r = finto(); assert.equal(await entrata(req('GET'), r, 'persona'), null);
  assert.equal(r.code, 401);

  const staff = await persona('Anna');
  const c = jar(await creaSessione(staff));
  r = finto(); assert.equal(await entrata(req('GET', undefined, { cookie: c }), r, 'admin'), null);
  assert.equal(r.code, 403);
  r = finto(); const e = await entrata(req('GET', undefined, { cookie: c }), r, 'persona');
  assert.equal(e.persona.nome, 'Anna');
});

test('sessions: cookie flags, expiry, renewal, logout, revocation, removal', async () => {
  const staff = await persona('Mario'), admin = await persona('Gabriele', 'admin');
  const sc = await creaSessione(staff), ac = await creaSessione(admin);
  assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Max-Age=2592000/);
  assert.match(ac, /Max-Age=43200/);
  const s = jar(sc), a = jar(ac);
  assert.equal((await chi(req('GET', undefined, { cookie: s }))).nome, 'Mario');

  // staff used on day 2: renewed to 30 days and the cookie is sent again
  await q(`UPDATE sessioni SET scade = now() + interval '28 days' WHERE persona_id = $1`, [staff.id]);
  const r = finto(); await chi(req('GET', undefined, { cookie: s }), r);
  const [{ giorni }] = await q(`SELECT extract(day from scade - now())::int giorni FROM sessioni WHERE persona_id = $1`, [staff.id]);
  assert.ok(giorni >= 29);
  assert.match(String(r.headers['set-cookie']), /Max-Age=2592000/);
  // admin is never extended
  await q(`UPDATE sessioni SET scade = now() + interval '1 hour' WHERE persona_id = $1`, [admin.id]);
  await chi(req('GET', undefined, { cookie: a }), finto());
  const [{ ore }] = await q(`SELECT extract(epoch from scade - now())/3600 ore FROM sessioni WHERE persona_id = $1`, [admin.id]);
  assert.ok(ore <= 1);

  await q(`UPDATE sessioni SET scade = now() - interval '1 second' WHERE persona_id = $1`, [admin.id]);
  assert.equal(await chi(req('GET', undefined, { cookie: a })), null, 'expired');
  assert.equal(await chi(req('GET', undefined, { cookie: 'sessione=inventato' })), null);

  assert.match(await esci(req('DELETE', undefined, { cookie: s })), /Max-Age=0/);
  assert.equal(await chi(req('GET', undefined, { cookie: s })), null, 'logged out');

  const s2 = jar(await creaSessione(staff));
  await revoca(staff.id);
  assert.equal(await chi(req('GET', undefined, { cookie: s2 })), null, 'revoked');
  const s3 = jar(await creaSessione(staff));
  await q(`UPDATE persone SET rimossa = now() WHERE id = $1`, [staff.id]);
  assert.equal(await chi(req('GET', undefined, { cookie: s3 })), null, 'removed person');
  const [{ n }] = await q(`SELECT count(*)::int n FROM sessioni WHERE token_hash LIKE '%' AND persona_id = $1 AND token_hash = $2`, [staff.id, s3.split('=')[1]]);
  assert.equal(n, 0, 'the raw token is never stored');
});

test('rate limit and log', async () => {
  for (let i = 0; i < 3; i++) assert.equal(await limite('t:1', 3, 900), true);
  assert.equal(await limite('t:1', 3, 900), false);
  assert.equal(await limite('t:2', 3, 900), true, 'other key');
  await q(`UPDATE limiti SET inizio = now() - interval '16 minutes' WHERE chiave = 't:1'`);
  assert.equal(await limite('t:1', 3, 900), true, 'window passed');
  await registra(null, 'prova', { x: 1 });
  const [l] = await q(`SELECT azione, dettagli FROM registro WHERE azione = 'prova'`);
  assert.deepEqual(l.dettagli, { x: 1 });
});
