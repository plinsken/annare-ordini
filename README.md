# Annaré · Ordini interni

Staff ordering app for the two pizzerias. Gabriele built the front end (prototype on Netlify: resilient-paletas-bcb70d.netlify.app). This folder adds a login and the email step.

- Live: https://ordini.annarepizzeria.com (Vercel project `annare-ordini`, team plinskens-projects, CLI deploys)
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

Add, remove or change a person: edit `STAFF` in Vercel, then redeploy (`vercel deploy --prod`). Env changes only apply after a redeploy. Removing a person or changing their code ends their sessions on every phone. The name on the order comes from `STAFF`.

## Test and deploy

```bash
npm test
```

```bash
vercel deploy --prod
```
