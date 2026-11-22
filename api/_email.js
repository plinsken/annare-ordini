// Email through Resend to ORDINI_A. true = sent, false = failed, null = email is off here (previews, or not configured).
import { sito } from './_sito.js';
import { registra } from './_registro.js';

export async function invia({ subject, text, attachments, chiave }) {
  const { RESEND_API_KEY: k, ORDINI_DA: da, ORDINI_A: a } = process.env;
  if (!k || !da || !a || sito()?.prova !== false) return null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', 'Idempotency-Key': chiave },
      body: JSON.stringify({ from: da, to: a.split(',').map(s => s.trim()).filter(Boolean), subject, text, attachments }),
    });
    if (!r.ok) { console.error('Resend', r.status, await r.text()); return false; }
  } catch (e) { console.error('Resend', e.message); return false; }
  await registra(null, 'email-inviata', { chiave });
  return true;
}
