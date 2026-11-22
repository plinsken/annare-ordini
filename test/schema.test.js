import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dbProva } from './_db.js';
import { q, tx } from '../api/_db.js';

test('schema loads twice and the log is append-only', async () => {
  const pg = await dbProva();
  await pg.exec(readFileSync('db/schema.sql', 'utf8'));
  await q(`INSERT INTO registro (azione) VALUES ('prova')`);
  await assert.rejects(q(`UPDATE registro SET azione='x'`), /solo aggiunte/);
  await assert.rejects(q(`DELETE FROM registro`), /solo aggiunte/);
  await q(`INSERT INTO registro (quando, azione) VALUES (now() - interval '13 months', 'vecchio')`);
  await q(`DELETE FROM registro WHERE azione='vecchio'`);
  const [{ n }] = await q(`SELECT count(*)::int n FROM registro`);
  assert.equal(n, 1);
  const r = await tx([[`INSERT INTO persone (nome, ruolo) VALUES ($1,'staff') RETURNING id`, ['A']], [`SELECT count(*)::int n FROM persone`, []]]);
  assert.equal(r[1][0].n, 1);
});
