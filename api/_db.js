// Database access. Neon over HTTP in production; tests swap in PGlite with usaDb().
import { neon } from '@neondatabase/serverless';

let sql;
const client = () => (sql ??= neon(process.env.DATABASE_URL));
let impl = {
  q: (t, p = []) => client().query(t, p),
  tx: list => client().transaction(list.map(([t, p = []]) => client().query(t, p))),
};

export const q = (text, params) => impl.q(text, params);
// One transaction; returns the rows of each statement.
export const tx = list => impl.tx(list);
export const usaDb = adapter => { impl = adapter; };
