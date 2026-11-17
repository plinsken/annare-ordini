// POST {sede, reparto, num, pdf (base64)}: emails the order PDF to ORDINI_A. Logged-in staff only.
import { chi } from './_auth.js';

const riga = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();

  const nome = chi(req);
  if (!nome) return res.status(401).json({ errore: 'Accesso scaduto. Rientra con il tuo codice.' });

  const { RESEND_API_KEY: chiave, ORDINI_DA: da, ORDINI_A: a } = process.env;
  if (!chiave || !da || !a) return res.status(503).json({ errore: "L'invio per email non è ancora attivo." });

  const b = req.body || {};
  const sede = riga(b.sede), reparto = riga(b.reparto), num = riga(b.num);
  // "JVBER" is "%PDF" in base64: refuse anything that is not a PDF.
  if (!sede || !reparto || typeof b.pdf !== 'string' || !b.pdf.startsWith('JVBER')) {
    return res.status(400).json({ errore: 'Ordine non valido.' });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: da,
      to: a.split(',').map(s => s.trim()).filter(Boolean),
      subject: `Ordine ${reparto}, ${sede}, da ${nome}`,
      text: `Nuovo ordine da ${nome}.\nSede: ${sede}\nReparto: ${reparto}\nOrdine n. ${num}\n\nIl PDF è in allegato.`,
      attachments: [{ filename: `Ordine ${reparto} ${num}.pdf`, content: b.pdf }],
    }),
  });
  if (!r.ok) {
    console.error('Resend', r.status, await r.text());
    return res.status(502).json({ errore: 'Invio non riuscito. Riprova tra poco.' });
  }
  return res.status(200).json({ ok: true });
}
