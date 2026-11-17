// GET: who is logged in. POST {codice}: log in. DELETE: log out.
import { GIORNI, norm, staff, creaToken, chi, cookie } from './_auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const nome = chi(req);
    return nome ? res.status(200).json({ nome }) : res.status(401).json({});
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookie('', 0));
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).end();

  const codice = norm(req.body?.codice);
  const nome = codice && staff().get(codice);
  if (!nome) return res.status(401).json({ errore: 'Codice non valido.' });
  try {
    res.setHeader('Set-Cookie', cookie(creaToken(nome, codice), GIORNI * 86400));
  } catch (e) {
    console.error(e.message);
    return res.status(503).json({ errore: "L'accesso non è ancora configurato." });
  }
  return res.status(200).json({ nome });
}
