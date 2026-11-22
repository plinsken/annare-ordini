// Append-only log (the table refuses updates and deletes, except retention).
import { q } from './_db.js';

export const registra = (personaId, azione, dettagli = {}) =>
  q(`INSERT INTO registro (persona_id, azione, dettagli) VALUES ($1, $2, $3)`, [personaId, azione, JSON.stringify(dettagli)]);
