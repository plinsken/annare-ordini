# Annaré · Ordini interni

Staff ordering app for the two pizzerias. Gabriele built the front end (prototype on Netlify: resilient-paletas-bcb70d.netlify.app). This folder adds secure logins and the weekly order.

- Live: https://ordini.annarepizzeria.com (Vercel project `annare-ordini`, team plinskens-projects, functions in Frankfurt). Deploys from GitHub: a push to `main` goes live.
- Design: `docs/superpowers/specs/2026-11-17-login-sicuro-e-ordine-settimanale-design.md`. Build plan: `docs/superpowers/plans/`.

## How it works

- **Login:** Gabriele adds a person in Gestione and gets a one-time setup code (48 hours). On their own phone the person enters it once and the phone creates a passkey (Face ID, fingerprint or the phone's lock). Phones that can't make one get a 6-digit PIN that only works on that phone; 5 wrong PINs lock it. "Perso" or "Togli" in Gestione shuts the person out at once.
- **Requests:** cooks send requests any day. They can change or cancel them until **Friday 16:00** (Europe/Rome). Later ones go into the next week.
- **Friday 16:02:** a Vercel cron closes the week, sums the requests per sede and reparto, and sends **one** email to `ORDINI_A` with a link, no details.
- **Access by shop and department:** each person orders only for the shops and departments Gabriele ticks (when adding them, or later with Modifica). A manager who can approve sees and approves only those orders; a manager who manages people acts only on staff within their own access and gives only what they have. People added before 2026-11-25 keep full access. Access is stored by name: renaming a shop or department in `prodotti.json` takes it away from people until Gabriele ticks it again.
- **Managers ("Responsabile"):** Gabriele can make a person a manager in Gestione (Modifica) and switch two rights on or off: approve orders, and manage people (staff only). Making a manager, giving a right, wider access for a manager, or a code for a manager asks for Gabriele's Face ID. Managers log in with a passkey only, for 12 hours. Only Gabriele makes managers.
- **Approval:** Gabriele opens Gestione, can change quantities or remove lines, and approves with Face ID. The approved order goes as a PDF to `ORDINI_A`. Everything is logged.

## Files

- `public/`: the app. `index.html` (screens and styles), `app.js` (staff), `gestione.js` (Gabriele), `prodotti.json` (sedi and products), `sw.js` (offline cache).
- `api/`: server routes. `_`-prefixed files are shared code, not routes.
- `db/schema.sql`: database tables. `scripts/migra.js` applies it, `scripts/codice-admin.js` makes an admin setup code.

## Environment variables (Vercel)

| Name | What |
|---|---|
| `DATABASE_URL` | Neon Postgres. Production: set by the Neon integration. Preview: only for branch `prova`, pointing at the Neon `dev` branch. |
| `CRON_SECRET` | random, 32+ characters. Vercel sends it to the Friday cron. |
| `RESEND_API_KEY` | Resend key. Without it, approvals work but no email goes out (Gabriele downloads the PDF). |
| `ORDINI_DA` | sender, e.g. `Annaré Ordini <ordini@annarepizzeria.com>` |
| `ORDINI_A` | recipient(s) of the Friday email and the approved PDFs, comma-separated |

Env changes only apply after `vercel redeploy ordini.annarepizzeria.com`. Don't use `vercel deploy --prod`: it uploads this folder as it is on your Mac and can undo Gabriele's pushes.

## Database and admin code

After a schema change, or on a new database:

```bash
vercel env pull .env.migra --environment production --yes && node --env-file=.env.migra scripts/migra.js && rm .env.migra
```

Gabriele lost his phone, or first launch: make him a new admin code (then send it to him):

```bash
vercel env pull .env.admin --environment production --yes && node --env-file=.env.admin scripts/codice-admin.js "Gabriele" && rm .env.admin
```

For the `prova` test database use `--environment preview --git-branch prova` instead.

## Test

```bash
npm test
```

Tests run on an in-process Postgres (PGlite) and a software passkey, so they need no network.

## Previews

Only the branch `prova` gets a working preview, at its fixed Vercel branch link, with its own test database. It never emails, and Gestione has a "Chiudi la settimana ora" button to try the Friday close. Any other branch shows "Anteprima non configurata."

## Per Gabriele

- Prodotti e sedi sono in `public/prodotti.json`. Testi e grafica in `public/index.html`. Il funzionamento è in `public/app.js` (staff) e `public/gestione.js` (la tua sezione).
- Ogni modifica su `main` va online da sola su ordini.annarepizzeria.com in circa un minuto. Per provare prima, lavora sul branch `prova`: ha il suo link fisso e un database di prova. Lì entri con un codice di prova che ti dà Tom, non partono email e in Gestione c'è "Chiudi la settimana ora".
- Se cambi un file in `public/`, alza il numero in `CACHE` dentro `public/sw.js` (es. `v3` → `v4`), altrimenti i telefoni continuano a vedere la versione vecchia.
- Se togli o rinomini un prodotto, le richieste già fatte restano come erano.
- Se rinomini una sede o un reparto, le persone che lo avevano lo perdono: rispuntalo in Gestione, Modifica.
- Non toccare `api/`, `db/` e `vercel.json` senza parlarne con Tom: sono la parte che controlla gli accessi e gli ordini.
- Le persone le aggiungi e le togli tu dalla sezione Gestione dell'app. Se perdi il telefono, scrivi a Tom per un nuovo codice.
- Se qualcosa si rompe, Tom può tornare alla versione precedente con un clic.
