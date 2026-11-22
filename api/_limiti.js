// Fixed-window rate limits stored in the database. true = allowed.
import { q } from './_db.js';

export const ipDi = req => req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sconosciuto';

// Read-only: true while the key is still under max (does not count this call).
export async function sotto(chiave, max, secondi) {
  const [r] = await q(`SELECT conta FROM limiti WHERE chiave = $1 AND inizio >= now() - $2::int * interval '1 second'`, [chiave, secondi]);
  return !r || r.conta < max;
}

export async function limite(chiave, max, secondi) {
  const [r] = await q(`INSERT INTO limiti (chiave, conta, inizio) VALUES ($1, 1, now())
    ON CONFLICT (chiave) DO UPDATE SET
      conta = CASE WHEN limiti.inizio < now() - $2::int * interval '1 second' THEN 1 ELSE limiti.conta + 1 END,
      inizio = CASE WHEN limiti.inizio < now() - $2::int * interval '1 second' THEN now() ELSE limiti.inizio END
    RETURNING conta`, [chiave, secondi]);
  return r.conta <= max;
}
