# Annaré · Ordini interni

Staff ordering app for the two pizzerias. Gabriele built the front end (prototype on Netlify: resilient-paletas-bcb70d.netlify.app). This folder adds a login and the email step.

- Live: https://ordini.annarepizzeria.com (Vercel project `annare-ordini`, team plinskens-projects). Deploys from GitHub: a push to `main` goes live, other branches get a preview link.
- `public/`: Gabriele's app (index.html, service worker, icons, pdf-lib + fontkit served by the app itself)
- `api/sessione.js`: log in with a personal code (POST), check (GET), log out (DELETE)
- `api/ordine.js`: emails the order PDF to Gabriele, for logged-in staff only
- `api/_auth.js`: signed session cookie, 90 days, HttpOnly

## Environment variables (Vercel, Production)

| Name | What |
|---|---|
| `STAFF` | `Nome:CODICE,Nome2:CODICE2`. Codes are at least 10 characters; shorter ones are ignored. |
| `SESSION_SECRET` | random, 32+ characters. Changing it logs everyone out. |
| `RESEND_API_KEY` | Resend key. Without it the app falls back to "download the PDF". |
| `ORDINI_DA` | sender, e.g. `Annaré Ordini <ordini@annarepizzeria.com>` (domain must be verified in Resend) |
| `ORDINI_A` | recipient(s), comma-separated |

## Staff

New code (10 characters, no 0/O/1/I):

```bash
node -e 'const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";console.log([...require("crypto").randomBytes(10)].map(x=>a[x%32]).join(""))'
```

Add, remove or change a person: edit `STAFF` in Vercel, then rebuild what is live (`vercel redeploy ordini.annarepizzeria.com`). Env changes only apply after a redeploy. Don't use `vercel deploy --prod`: it uploads this folder as it is on your Mac and can undo Gabriele's pushes. Removing a person or changing their code ends their sessions on every phone. The name on the order comes from `STAFF`.

## Test and deploy

```bash
npm test
```

Code changes: commit and push to `main`. Settings changes only:

```bash
vercel redeploy ordini.annarepizzeria.com
```

## Previews

Preview links are public (the app has its own login), but they use their own Preview settings: a separate `SESSION_SECRET` and a `STAFF` with only a test code, and no Resend key, so a preview never emails a real order and real staff codes don't work there.

## Per Gabriele

- L'app è tutta in `public/index.html`. Modifica lì prodotti, testi e grafica.
- Ogni modifica su `main` va online da sola su ordini.annarepizzeria.com in circa un minuto. Se vuoi provare prima, lavora su un altro branch: Vercel ti dà un link di prova (lo vedi su GitHub, accanto al commit). Lì entri con il tuo codice di prova, che ti dà Tom. Dal link di prova le email non partono: alla fine esce solo il PDF.
- Se cambi `public/index.html` o altri file in `public/`, alza il numero in `CACHE` dentro `public/sw.js` (es. `v2` → `v3`), altrimenti i telefoni continuano a vedere la versione vecchia.
- Non toccare `api/` senza parlarne con Tom: è la parte che controlla i codici e manda le email.
- I codici dello staff e la chiave Resend non sono qui ma su Vercel. Per aggiungere o togliere persone scrivi a Tom.
- Se qualcosa si rompe, Tom può tornare alla versione precedente con un clic.
