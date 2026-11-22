# Annaré Ordini: secure logins and the weekly order

Date: 2026-11-17, updated 2026-11-22 (weekly cycle, from Tom and Gabriele together). Owner: Tom. Status: draft for Tom's approval.

## Why

Annaré's staff use this app to say what needs ordering. Today each order is emailed to Gabriele as a PDF the moment it is sent. In practice Gabriele orders from suppliers once a week, on Friday afternoon, and the goods arrive on Saturday morning; the app should follow that week instead of emailing him all week. Later, approved orders will go to suppliers automatically, so a fake or tampered order will cost real money. Tom wants two things before that:

1. Only Gabriele's people can use the app, with a login stronger than a shared code ("2FA").
2. Nothing reaches the next step (Gabriele now, suppliers later) unless Gabriele has looked at it and approved it.

## What exists today (read this first)

- Repo `plinsken/annare-ordini`. It is Git-linked to the Vercel project `annare-ordini` on Tom's Pro team. A push to `main` deploys production at https://ordini.annarepizzeria.com, and other branches get public preview links.
- `public/index.html` is Gabriele's single-page app: the product list (`DATI`), the screens, and the PDF built in the browser with pdf-lib. `public/sw.js` is the offline service worker; it never caches `/api/`. Gabriele edits `public/` himself and pushes to `main`.
- `api/_auth.js`, `api/sessione.js`, `api/ordine.js`: the login is a personal 10-character code from the `STAFF` env var, giving a signed HttpOnly cookie that lasts 90 days. `POST /api/ordine` emails the PDF through Resend (domain annarepizzeria.com is verified; sender `ORDINI_DA`, recipients `ORDINI_A`).
- There is no database, and the server keeps nothing between requests.
- Preview deploys have their own `SESSION_SECRET` and a `STAFF` holding only a test user. They have no Resend key, so they never email.
- Tests: `npm test` (node:test, API only).

## Goals

### Logins
- **Staff setup:** Gabriele adds a person in the app and gets a one-time setup code to give them. The person opens the app on their own phone, enters the code once, and the phone creates a passkey (Face ID, fingerprint or the phone PIN). From then on, logging in is a passkey prompt only, with nothing to type.
- **Alternative login for phones that can't make a passkey** (Tom: "we need an alt login for staff with shit phones"). Staff only, never for admins. If creating a passkey fails or isn't supported, the setup screen offers a 6-digit PIN instead (my call). Redeeming the setup code on that phone stores a long-lived device token in an HttpOnly cookie, and the person chooses the PIN. Logging in then needs both: that phone's token (something you have) and the PIN (something you know). The PIN works only on that phone. Five wrong PINs lock it, and Gabriele issues a new setup code. The PIN is stored only as a slow hash. Each person's login type (passkey or PIN) is visible to Gabriele in the admin section.
- **Setup codes:** single use, and they expire (my call: 48 hours). Using one consumes it. A person may have more than one phone (my call: allowed, each needs its own code).
- **Removing a person**, or a "lost phone" action, shuts out all their passkeys and live sessions at once.
- **Gabriele (role `admin`)** logs in the same way. Every approval asks for a fresh passkey check (user verification), so an unlocked phone left on a counter can't approve.
- **Admin recovery:** if Gabriele loses his phone, Tom runs a small script from his Mac that issues a new admin setup code.
- **Roles** are stored per person (`staff`, `admin`). Only Gabriele is admin now. Adding other managers later should be a data change plus a small UI change, not a redesign.

### Requests and the weekly order
- **The week** (Tom and Gabriele, 2026-11-22): staff can send requests on any day. Gabriele orders on Friday afternoon and receives on Saturday morning. Each order week is named by its Friday (my call), and runs from Friday 16:00 to the next Friday 16:00.
- Staff send requests: sede, reparto, products with quantities, the optional "Altro prodotto" and a note. Each one is saved, and the staff member sees it as "nell'ordine di venerdì <data>".
- Staff can change or cancel their own requests until the cut-off (my call).
- **The cut-off is Friday at 16:00 Europe/Rome** for both pizzerias and every reparto, and it follows summer and winter time. A request sent after Friday 16:00 goes into the next week's order and is clearly labelled with that Friday's date.
- **At the cut-off** the week closes. Requests are combined per sede and reparto, and the same product is summed. Gabriele sees each line with its total and who asked for it.
- **Email only on Friday:** at most one email a week goes to Gabriele, at the cut-off: "Ordine della settimana pronto, da approvare", with a link. It contains no order details, no names and no PDF. No email on any other day. If there were no requests that week, nothing is sent.
- **Approval:** on Friday afternoon Gabriele opens the week's combined order in the app, confirms with a passkey, and approves it. The approved order is then emailed as PDF(s) to `ORDINI_A`, the same way as today. Later, that one step becomes "send to suppliers", and nothing before it changes.
- **Approval is per sede and reparto** (my call). Each closed week produces one order per sede+reparto that had requests. Each is approved on its own, because suppliers will later differ by reparto.
- **Before approving,** Gabriele can change a quantity or remove a line (Tom and Gabriele, 2026-11-22). Each change is logged with the original value, and the staff who asked see what changed. Removing every line rejects that order (my call), and the staff who asked see "non approvato".
- **An order Gabriele hasn't acted on stays open as its own order** (my call). It never merges into the next week's order and never expires. The Friday email lists how many orders are waiting, including older ones.
- **The PDF is built on the server** from the saved, approved data (my call), so what goes out can't be altered in the browser. Each request stores a copy of the product name and format as they were, so later edits to `prodotti.json` don't change past orders.
- **Log:** everything is written to an append-only log: who, what, when. That covers logins, setup codes issued and used, people added and removed, requests made, changed and cancelled, the week closed, the approval, and the email sent.

## Non-goals (now)
- Connecting suppliers, and anything Gabriele does with an order after approving it.
- Urgent mid-week orders (Tom and Gabriele, 2026-11-22): the app only does the Friday order. Something that runs out mid-week is handled outside the app, by phone, as today. No early close and no urgent button.
- Managers other than Gabriele, and per-pizzeria permissions.
- Push notifications, and reminders to staff before the cut-off.
- Changing how the app looks, beyond the new screens it needs.

## Anti-goals (failure even if it "works")
- Staff typing a code or password every day, or getting locked out in the middle of service with no quick way back in. Gabriele must be able to issue a new setup code within minutes from his phone.
- An approval that is possible without a fresh passkey check.
- Order details or personal data in emails or URLs.
- Preview deploys touching production data, or real staff logins working on previews.
- The app being broken after a quiet week, for example a holiday closure. The database must wake by itself.
- Any request reaching the "approved / send" step without Gabriele's approval, including through a hand-made API call.

## Decided
- **Database: Neon Postgres (free plan)**, provisioned through the Vercel Marketplace integration so the env vars are set automatically. EU region (Frankfurt). Not Supabase: free projects there pause after a week and need a manual restore, and its passkeys are still in beta.
- **Passkeys: SimpleWebAuthn** (`@simplewebauthn/server` and `@simplewebauthn/browser`). No hand-written WebAuthn crypto. The login stays in this app's own code, without an external auth service.
- Hosting stays on Vercel (Node functions in `api/`, static `public/`). Email stays on Resend.
- The app's language is Italian.

## Security and privacy requirements
- **Sessions** are stored server-side (in the database) so they can be revoked. My calls: staff sessions last 30 days and are renewed on use; admin sessions last 12 hours; approval always needs a fresh passkey check anyway.
- **Rate limits** on setup-code redemption and login attempts, per IP and per code, stored in the database.
- **CSRF:** keep SameSite cookies, and also reject state-changing requests whose `Origin` is not the app's own.
- **The server validates every request** against the product list. The list moves out of `index.html` into `public/prodotti.json`, which the page and the API both read, so Gabriele still edits one file. Quantities must be whole numbers within a sane cap. Free text ("Altro", note) is length-capped and only ever shown escaped.
- **Security headers:** a Content-Security-Policy that allows only the app's own scripts, `frame-ancestors 'none'`, and `Referrer-Policy: no-referrer`.
- **Passkey relying party:** the RP ID is `ordini.annarepizzeria.com` in production. Previews use their own host, taken from an allowlist and never from an arbitrary Host header.
- **Previews** (my call): Gabriele tests on one fixed branch, `prova`, at Vercel's stable branch URL for it. That URL is the preview RP ID, and the allowlist holds exactly two hosts: production and that one. A single dev database serves `prova`, and other branches show "anteprima non configurata" for login. Tom issues a test admin setup code for `prova` with the same script used for admin recovery. Crons don't run on previews, so `prova` gets an admin-only "chiudi la settimana ora" button that exists only there. Previews never send email.
- **CSP and file layout** (my call): the inline script moves out of `index.html` into `public/app.js`, so the CSP can allow only same-origin scripts. `DATI` moves to `public/prodotti.json`. Gabriele edits products in `prodotti.json` and texts in `index.html`, and the README "Per Gabriele" section is updated. He pauses his pushes to `main` while the rebuild lands.
- **Data kept:** first and last name, role, the public part of each passkey, requests, weekly orders and the log. Nothing else. My calls: orders are kept 2 years, and the log 1 year.
- **Code access:** Tom and Gabriele both need 2FA on their GitHub accounts, because anyone who can push to `main` can change the server code. Before suppliers are connected (out of scope here, but a constraint on this design), the supplier credentials must live in a separate service only Tom can deploy. That service must accept only approved weekly orders, signed by this app.

## Migration
- The current `STAFF` code login is retired when the passkey login goes live: no dual login. The "Prova" user and the preview `STAFF`/`SESSION_SECRET` env vars are removed.
- On launch day, Tom issues Gabriele's admin setup code. Gabriele then adds his staff and hands out their codes.

## Left to the builder
- The schema, the endpoint shapes, and the screen layouts of the admin section and the "my requests this week" view.
- How the cut-off job runs: for example, a Vercel cron on Friday afternoons that checks the Rome local time, with a closing that is safe to run twice and that still closes the week if a run is late or missed.
- What the merged order and PDF look like, reusing the existing pdf-lib PDF style.
- The test approach. At minimum: automated tests for setup-code redemption, session revocation, the cut-off and time-zone edges, consolidation, and approval needing a fresh passkey check.
