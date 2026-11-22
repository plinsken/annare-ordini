// Fresh in-process Postgres with the schema, wired into api/_db.js.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { usaDb } from '../api/_db.js';

export async function dbProva() {
  const pg = new PGlite();
  await pg.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  usaDb({
    q: (t, p = []) => pg.query(t, p).then(r => r.rows),
    tx: list => pg.transaction(async t => { const out = []; for (const [s, p = []] of list) out.push((await t.query(s, p)).rows); return out; }),
  });
  return pg;
}
