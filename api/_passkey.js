// Passkeys through SimpleWebAuthn. User verification (Face ID, fingerprint, phone PIN) is always required.
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { q } from './_db.js';
import { nuovoToken } from './_sessioni.js';

export async function salvaSfida(scopo, sfida, personaId = null, dati = null) {
  const id = nuovoToken();
  await q(`INSERT INTO sfide (id, sfida, scopo, persona_id, dati, scade) VALUES ($1, $2, $3, $4, $5, now() + interval '5 minutes')`,
    [id, sfida, scopo, personaId, dati && JSON.stringify(dati)]);
  return id;
}
// Read once: the row is deleted even when it turns out expired or for another purpose.
export async function prendiSfida(id, scopo) {
  if (typeof id !== 'string') return null;
  const [r] = await q(`DELETE FROM sfide WHERE id = $1 RETURNING sfida, scopo, persona_id AS "personaId", dati, scade > now() AS valida`, [id]);
  return r && r.valida && r.scopo === scopo ? r : null;
}

export async function opzioniRegistrazione(persona, s) {
  const esistenti = await q(`SELECT id, trasporti FROM passkey WHERE persona_id = $1`, [persona.id]);
  return generateRegistrationOptions({
    rpName: 'Annaré Ordini', rpID: s.rpID, userName: persona.nome, userDisplayName: persona.nome,
    userID: new TextEncoder().encode(String(persona.id)), attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: esistenti.map(p => ({ id: p.id, transports: p.trasporti ?? undefined })),
  });
}

// Returns the new credential, or null. Writes nothing.
export async function verificaRegistrazione(risposta, sfida, s) {
  try {
    const v = await verifyRegistrationResponse({ response: risposta, expectedChallenge: sfida.sfida, expectedOrigin: s.origin, expectedRPID: s.rpID, requireUserVerification: true });
    return v.verified && v.registrationInfo.userVerified ? v.registrationInfo.credential : null;
  } catch { return null; }
}

export const salvaPasskey = (personaId, c) =>
  q(`INSERT INTO passkey (id, persona_id, chiave, contatore, trasporti) VALUES ($1, $2, decode($3, 'base64'), $4, $5)`,
    [c.id, personaId, Buffer.from(c.publicKey).toString('base64'), c.counter, c.transports ?? null]);

export const opzioniAccesso = (s, allow) => generateAuthenticationOptions({
  rpID: s.rpID, userVerification: 'required',
  allowCredentials: allow?.map(p => ({ id: p.id, transports: p.trasporti ?? undefined })),
});

// Returns {id, nome, ruolo} of the passkey's owner, or null. personaId limits it to one person (approvals).
export async function verificaAccesso(risposta, sfida, s, personaId = null) {
  const [p] = await q(`SELECT k.id, encode(k.chiave, 'base64') AS chiave, k.contatore, k.trasporti, p.id AS persona, p.nome, p.ruolo
    FROM passkey k JOIN persone p ON p.id = k.persona_id
    WHERE k.id = $1 AND p.rimossa IS NULL AND ($2::int IS NULL OR p.id = $2)`, [String(risposta?.id ?? ''), personaId]);
  if (!p) return null;
  try {
    const v = await verifyAuthenticationResponse({
      response: risposta, expectedChallenge: sfida.sfida, expectedOrigin: s.origin, expectedRPID: s.rpID, requireUserVerification: true,
      credential: { id: p.id, publicKey: new Uint8Array(Buffer.from(p.chiave, 'base64')), counter: Number(p.contatore), transports: p.trasporti ?? undefined },
    });
    if (!v.verified || !v.authenticationInfo.userVerified) return null;
    await q(`UPDATE passkey SET contatore = $2, usata = now() WHERE id = $1`, [p.id, v.authenticationInfo.newCounter]);
    return { id: p.persona, nome: p.nome, ruolo: p.ruolo };
  } catch { return null; }
}
