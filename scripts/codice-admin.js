// Tom only: new admin setup code (first launch, or Gabriele lost his phone).
// vercel env pull .env.admin --environment production --yes && node --env-file=.env.admin scripts/codice-admin.js "Gabriele" && rm .env.admin
import { q } from '../api/_db.js';
import { nuovoCodice } from '../api/_codici.js';
import { registra } from '../api/_registro.js';

const nome = String(process.argv[2] ?? '').replace(/\s+/g, ' ').trim();
if (!nome || !process.env.DATABASE_URL) { console.error('Uso: node --env-file=.env.admin scripts/codice-admin.js "Nome"'); process.exit(1); }
let [p] = await q(`SELECT id FROM persone WHERE nome = $1 AND ruolo = 'admin' AND rimossa IS NULL`, [nome]);
p ??= (await q(`INSERT INTO persone (nome, ruolo) VALUES ($1, 'admin') RETURNING id`, [nome]))[0];
const codice = await nuovoCodice(p.id);
await registra(null, 'codice-creato', { persona: p.id, da: 'script' });
console.log(`Codice per ${nome}: ${codice} (valido 48 ore, una sola volta)`);
