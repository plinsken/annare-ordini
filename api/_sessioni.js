// Server-side sessions: random token in an HttpOnly cookie, its sha256 in the database.
import { createHash, randomBytes } from 'node:crypto';
import { q, tx } from './_db.js';
import { sito } from './_sito.js';

export const DURATA = { staff: 30 * 86400, manager: 12 * 3600, admin: 12 * 3600 };
export const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const nuovoToken = () => randomBytes(32).toString('base64url');
export const leggiCookie = (req, nome) => new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`).exec(req.headers.cookie || '')?.[1];
export const cookie = (nome, valore, maxAge) => `${nome}=${valore}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Adds a Set-Cookie header without dropping one set earlier in the same response.
export function aggiungiCookie(res, c) {
  const prima = res.getHeader?.('set-cookie');
  res.setHeader('Set-Cookie', prima ? [prima, c].flat() : c);
}

export async function creaSessione(persona) {
  const token = nuovoToken(), durata = DURATA[persona.ruolo];
  await q(`INSERT INTO sessioni (token_hash, persona_id, scade) VALUES ($1, $2, now() + $3::int * interval '1 second')`, [sha(token), persona.id, durata]);
  return cookie('sessione', token, durata);
}

export async function chi(req, res) {
  const token = leggiCookie(req, 'sessione');
  if (!token) return null;
  const [p] = await q(`SELECT p.id, p.nome, p.ruolo, p.puo_approvare, p.puo_gestire, s.scade < now() + interval '29 days' AS vecchia
    FROM sessioni s JOIN persone p ON p.id = s.persona_id
    WHERE s.token_hash = $1 AND s.scade > now() AND p.rimossa IS NULL`, [sha(token)]);
  if (!p) return null;
  if (p.ruolo === 'staff' && p.vecchia) {
    await q(`UPDATE sessioni SET scade = now() + $2::int * interval '1 second' WHERE token_hash = $1`, [sha(token), DURATA.staff]);
    if (res) aggiungiCookie(res, cookie('sessione', token, DURATA.staff));
  }
  // Rights are read on every request, so Gabriele switching one off takes effect at once.
  const potere = d => p.ruolo === 'admin' || (p.ruolo === 'manager' && d);
  return { id: p.id, nome: p.nome, ruolo: p.ruolo, approva: potere(p.puo_approvare), gestisce: potere(p.puo_gestire) };
}

export async function esci(req) {
  const token = leggiCookie(req, 'sessione');
  if (token) await q(`DELETE FROM sessioni WHERE token_hash = $1`, [sha(token)]);
  return cookie('sessione', '', 0);
}

// Shuts a person out everywhere: sessions, passkeys, PIN phones, unused setup codes.
export const revoca = personaId => tx([
  [`DELETE FROM sessioni WHERE persona_id = $1`, [personaId]],
  [`DELETE FROM passkey WHERE persona_id = $1`, [personaId]],
  [`DELETE FROM dispositivi WHERE persona_id = $1`, [personaId]],
  [`DELETE FROM codici WHERE persona_id = $1 AND usato IS NULL`, [personaId]],
]);

// Common start of every route. Returns null after answering when the request can't go on.
// serve: 'nessuno' (no login), 'persona', 'approva' (approve orders), 'gestisce' (manage people).
export async function entrata(req, res, serve = 'persona') {
  res.setHeader('Cache-Control', 'no-store');
  const s = sito();
  const stop = (code, errore) => { res.status(code).json({ errore }); return null; };
  if (!s) return stop(503, 'Anteprima non configurata.');
  if (req.method !== 'GET' && req.headers.origin !== s.origin) return stop(403, 'Richiesta non valida.');
  if (serve === 'nessuno') return { s, persona: null };
  const persona = await chi(req, res);
  if (!persona) return stop(401, 'Accesso scaduto.');
  // Fails closed: an unknown `serve` is a right nobody has.
  if (serve !== 'persona' && persona[serve] !== true) return stop(403, 'Non hai il permesso.');
  return { s, persona };
}
