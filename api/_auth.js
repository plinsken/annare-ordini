// Session logic shared by the API routes. Files starting with "_" are not routes on Vercel.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const GIORNI = 90;
const MIN_CODICE = 10;

export const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// STAFF="Mario Rossi:K7P2X9QWMT,Anna:H3M8RT2ZQA" -> Map(codice -> nome)
export function staff(env = process.env) {
  const m = new Map();
  for (const voce of (env.STAFF || '').split(',')) {
    if (!voce.trim()) continue;
    const i = voce.lastIndexOf(':');
    const nome = voce.slice(0, i).trim(), codice = norm(voce.slice(i + 1));
    // shortcut: no login rate limit, so short codes are refused; add a Vercel WAF rate-limit rule before allowing shorter ones.
    if (i < 1 || !nome || codice.length < MIN_CODICE) { console.warn('STAFF: voce ignorata (nome o codice troppo corto)'); continue; }
    m.set(codice, nome);
  }
  return m;
}

const segreto = env => (env.SESSION_SECRET || '').length >= 32 ? env.SESSION_SECRET : null;
// The code is part of the signature: changing someone's code or removing them ends their sessions.
const firma = (nome, exp, codice, s) => createHmac('sha256', s).update(`${nome}|${exp}|${codice}`).digest('base64url');

export function creaToken(nome, codice, env = process.env, ora = Date.now()) {
  const s = segreto(env);
  if (!s) throw new Error('SESSION_SECRET mancante o troppo corto');
  const exp = ora + GIORNI * 864e5;
  return `${Buffer.from(nome).toString('base64url')}.${exp}.${firma(nome, exp, codice, s)}`;
}

export function leggiToken(token, env = process.env, ora = Date.now()) {
  const s = segreto(env), [n, exp, sig] = String(token ?? '').split('.');
  if (!s || !sig || !(Number(exp) > ora)) return null;
  const nome = Buffer.from(n, 'base64url').toString(), dato = Buffer.from(sig);
  for (const [codice, chi] of staff(env)) {
    if (chi !== nome) continue;
    const atteso = Buffer.from(firma(nome, exp, codice, s));
    if (atteso.length === dato.length && timingSafeEqual(atteso, dato)) return nome;
  }
  return null;
}

export const cookie = (token, maxAge) => `sessione=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const chi = (req, env = process.env) => leggiToken(/(?:^|;\s*)sessione=([^;]+)/.exec(req.headers.cookie || '')?.[1], env);
