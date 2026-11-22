// One-time setup codes (stored as sha256) and PIN hashes (scrypt, per-phone salt).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './_db.js';
import { sha } from './_sessioni.js';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORE = 48;
export const normCodice = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function nuovoCodice(personaId) {
  const codice = [...randomBytes(10)].map(x => ALFABETO[x % 32]).join('');
  await q(`INSERT INTO codici (hash, persona_id, scade) VALUES ($1, $2, now() + $3::int * interval '1 hour')`, [sha(codice), personaId, ORE]);
  return codice;
}

const VALIDO = `c.usato IS NULL AND c.scade > now() AND p.rimossa IS NULL`;
export async function trovaCodice(codice) {
  const c = normCodice(codice);
  if (c.length !== 10) return null;
  return (await q(`SELECT c.hash, c.persona_id AS "personaId", p.nome, p.ruolo FROM codici c JOIN persone p ON p.id = c.persona_id
    WHERE c.hash = $1 AND ${VALIDO}`, [sha(c)]))[0] ?? null;
}
export async function codiceDaHash(hash) {
  return (await q(`SELECT c.hash, c.persona_id AS "personaId", p.nome, p.ruolo FROM codici c JOIN persone p ON p.id = c.persona_id
    WHERE c.hash = $1 AND ${VALIDO}`, [hash]))[0] ?? null;
}
// Atomic: of two simultaneous redemptions only one gets true.
export const consumaCodice = async hash =>
  (await q(`UPDATE codici SET usato = now() WHERE hash = $1 AND usato IS NULL AND scade > now() RETURNING hash`, [hash])).length === 1;

const scryptP = promisify(scrypt);
export const pinValido = pin => typeof pin === 'string' && /^\d{6}$/.test(pin);
export async function hashPin(pin) {
  const sale = randomBytes(16);
  return sale.toString('hex') + ':' + (await scryptP(pin, sale, 32)).toString('hex');
}
export async function verificaPin(pin, salvato) {
  const [sale, h] = salvato.split(':');
  const atteso = Buffer.from(h, 'hex'), dato = await scryptP(pin, Buffer.from(sale, 'hex'), 32);
  return atteso.length === dato.length && timingSafeEqual(atteso, dato);
}
