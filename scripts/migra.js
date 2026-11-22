// Applies db/schema.sql to DATABASE_URL. Safe to run again.
// vercel env pull .env.migra --environment production --yes && node --env-file=.env.migra scripts/migra.js && rm .env.migra
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL mancante'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await pool.end();
console.log('schema OK');
