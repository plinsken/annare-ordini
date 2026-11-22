# Login sicuro e ordine settimanale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared-code login with passkeys (PIN fallback for staff), and replace "email every order at once" with saved requests that close every Friday at 16:00 into per sede+reparto orders that Gabriele approves with a fresh passkey check.

**Architecture:** Same shape as today: static `public/` plus Node functions in `api/` on Vercel, no framework, no build step. State moves into Neon Postgres (one prod database, one `dev` branch for the `prova` preview). Pure logic (week maths, validation, consolidation, PDF) lives in `_`-prefixed modules with unit tests; handlers are thin and tested against an in-process Postgres (PGlite) and a software passkey authenticator.

**Tech Stack:** Node 22+ ESM, `@neondatabase/serverless` 1.2.x, `@simplewebauthn/server` 14.1.x and `@simplewebauthn/browser` 14.0.x (UMD file served from `public/`), `pdf-lib` 1.17.1 + `@pdf-lib/fontkit` 1.1.1 (server side), `node:crypto` (scrypt, sha256, randomBytes), Resend REST, Vercel cron. Tests: `node --test`, devDependency `@electric-sql/pglite` 0.5.x.

**Spec:** `docs/superpowers/specs/2026-11-17-login-sicuro-e-ordine-settimanale-design.md` (approved by Tom 2026-11-22). Read it before starting.

## Global Constraints

- App language is Italian: every user-facing string, error and email.
- Time zone `Europe/Rome`. Cut-off: Friday 16:00 local time, both sedi, every reparto. A week is named by its Friday date (`YYYY-MM-DD`) and runs from the previous Friday 16:00 (inclusive) to that Friday 16:00 (exclusive).
- At most one notification email a week, sent at the close, to `ORDINI_A`: subject `Ordine della settimana pronto, da approvare`, body with the link `https://ordini.annarepizzeria.com/#gestione` and the count of orders waiting. No order details, names or PDF. Nothing if the week had no requests.
- Approved order: one email per approved sede+reparto order to `ORDINI_A` with the server-built PDF attached.
- Approval always needs a fresh passkey assertion with user verification. Admins never get the PIN login.
- Setup codes: 10 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, single use, expire after 48 hours, stored only as sha256.
- PIN: 6 digits, stored only as scrypt hash with a per-device salt, works only with that phone's `dispositivo` cookie, 5 wrong tries lock the device.
- Sessions server-side: staff 30 days renewed on use, admin 12 hours. Cookies `HttpOnly; Secure; SameSite=Lax; Path=/`. The `dispositivo` cookie lasts 400 days.
- Quantities: whole numbers 1 to 99. "Altro" name max 80 chars, quantity 1 to 99 or empty ("da indicare"). Note max 500 chars. Free text is only ever rendered escaped.
- State-changing requests (`method !== 'GET'`) must carry `Origin` equal to the app origin; otherwise 403.
- Hosts allowlist (never the `Host` header): production `ordini.annarepizzeria.com`; preview only on branch `prova`, at `annare-ordini-git-prova-plinskens-projects.vercel.app` (confirm in Task 11); development `localhost:3000`. Any other deploy answers 503 `Anteprima non configurata.`
- Previews never email.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.
- Retention: requests and orders 2 years (by week), log 1 year.
- Functions run in `fra1` (Neon is in Frankfurt).
- Never `vercel deploy --prod`. Production changes go live by pushing `main`; env changes need `vercel redeploy ordini.annarepizzeria.com`. Pushing `main` and removing env vars need Tom's go (Task 11).
- Never print or log secrets, codes, PINs or tokens, except the setup code shown once to the admin who created it.
- Log actions (`registro.azione`): `accesso`, `accesso-fallito`, `pin-bloccato`, `codice-creato`, `codice-usato`, `passkey-creata`, `pin-creato`, `persona-aggiunta`, `persona-rimossa`, `telefono-perso`, `richiesta-creata`, `richiesta-modificata`, `richiesta-annullata`, `settimana-chiusa`, `email-inviata`, `email-fallita`, `ordine-modificato`, `ordine-approvato`, `ordine-rifiutato`.

## Review Focus

1. **A request saved in the last second before 16:00** must end up in that week's order or be refused, never orphaned in a closed week. (Task 7 guard, Task 8 test.)
2. **Two close runs at the same time** (Vercel can invoke a cron twice) must produce one set of orders and one email. (Task 8 test.)
3. **A PIN phone that lost its cookies** (cleared Safari data) must get "Questo telefono non è più attivo. Chiedi un nuovo codice a Gabriele.", not a generic error. (Task 5 test.)
4. **A product renamed or removed in `prodotti.json` mid-week:** existing requests keep their snapshot and still consolidate; a new request for the removed product gets "Un prodotto non è più in lista. Aggiorna l'app." (Tasks 3 and 8 tests.)
5. **Approving twice** (two tabs, double tap) must approve once and send one email; the second answers 409 `Ordine già approvato.` (Task 9 test.)

---

## File map

| File | Job |
|---|---|
| `db/schema.sql` | All tables, idempotent (`CREATE ... IF NOT EXISTS`) |
| `scripts/migra.js` | Applies `db/schema.sql` to `DATABASE_URL` |
| `scripts/codice-admin.js` | Tom's script: creates or finds an admin by name, prints a new setup code |
| `api/_db.js` | `q`, `tx`, `usaDb` (swap in PGlite for tests) |
| `api/_sito.js` | Host, origin and RP ID from env; origin check |
| `api/_sessioni.js` | Sessions, cookies, `entrata()` guard, revocation |
| `api/_limiti.js` | Rate limits in the database |
| `api/_registro.js` | Append-only log writes |
| `api/_codici.js` | Setup code create, hash, redeem |
| `api/_passkey.js` | Thin wrappers over SimpleWebAuthn with the app's settings, challenge storage |
| `api/_settimana.js` | Week maths in Europe/Rome (pure) |
| `api/_prodotti.js` | Request validation against `public/prodotti.json` (pure) |
| `api/_consolida.js` | Sums requests into per sede+reparto orders (pure) |
| `api/_pdf.js`, `api/_fonti/*` | Server PDF (ported from `index.html`), fonts and logo files |
| `api/_email.js` | Resend send with idempotency key |
| `api/sessione.js` | GET who am I, DELETE log out |
| `api/accesso.js` | Passkey login, PIN login |
| `api/attiva.js` | Redeem setup code, then create passkey or PIN |
| `api/persone.js` | Admin: people, codes, lost phone, remove |
| `api/richieste.js` | Staff: create, list, edit, cancel own requests |
| `api/ordini.js` | Admin: list orders, approve with passkey, download PDF |
| `api/chiusura.js` | Cron close + weekly email + retention; admin "chiudi ora" on `prova` only |
| `public/prodotti.json` | `{ "sedi": [...], "reparti": DATI }`, Gabriele edits this |
| `public/app.js`, `public/gestione.js` | Staff app and admin section (moved out of `index.html`) |
| `public/simplewebauthn.umd.min.js` | Copied from `@simplewebauthn/browser/dist/bundle/index.umd.min.js` |
| `vercel.json` | `regions`, `crons`, security headers |
| `test/_db.js`, `test/_http.js`, `test/_autenticatore.js` | Test helpers |
| Deleted | `api/_auth.js`, `api/ordine.js`, `test/auth.test.js`, `public/pdf-lib.min.js`, `public/fontkit.umd.min.js` |

---

### Task 1: Database, dependencies, region

**Files:**
- Create: `db/schema.sql`, `scripts/migra.js`, `api/_db.js`, `test/_db.js`, `test/schema.test.js`, `vercel.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `q(text: string, params?: any[]) => Promise<Row[]>`, `tx(list: [string, any[]][]) => Promise<Row[][]>` (one transaction), `usaDb({q, tx})` in `api/_db.js`. `dbProva() => Promise<PGlite>` in `test/_db.js` (fresh DB with schema loaded, already passed to `usaDb`).

- [ ] **Step 1: Provision Neon.** In `ordini/`: `vercel integration add neon --yes --no-claim`, region Frankfurt (`aws-eu-central-1`), connected to **Production only**. If the CLI hands off to a browser or asks for terms, stop and ask Tom to finish it, then continue. Check: `vercel env ls` shows `DATABASE_URL` for Production (names only, never values).
- [ ] **Step 2: Create the dev branch.** In the Neon console (via `vercel integration open neon`) create branch `dev`. Add its pooled connection string as a branch-scoped preview var: `vercel env add DATABASE_URL preview prova`. Check `vercel env ls` shows it scoped to Preview (prova). Other preview branches get no `DATABASE_URL`.
- [ ] **Step 3: Dependencies.** `npm i @neondatabase/serverless@1.2.1 @simplewebauthn/server@14.1.0 @simplewebauthn/browser@14.0.0 pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1` and `npm i -D @electric-sql/pglite@0.5.17`. Add `"engines": {"node": ">=22"}` to `package.json`. `.gitignore` already has `node_modules`.
- [ ] **Step 4: Write `db/schema.sql`:**

```sql
CREATE TABLE IF NOT EXISTS persone (
  id serial PRIMARY KEY, nome text NOT NULL, ruolo text NOT NULL CHECK (ruolo IN ('staff','admin')),
  creata timestamptz NOT NULL DEFAULT now(), rimossa timestamptz);
CREATE TABLE IF NOT EXISTS codici (
  hash text PRIMARY KEY, persona_id int NOT NULL REFERENCES persone(id),
  scade timestamptz NOT NULL, usato timestamptz);
CREATE TABLE IF NOT EXISTS passkey (
  id text PRIMARY KEY, persona_id int NOT NULL REFERENCES persone(id), chiave bytea NOT NULL,
  contatore bigint NOT NULL DEFAULT 0, trasporti text[], creata timestamptz NOT NULL DEFAULT now(), usata timestamptz);
CREATE TABLE IF NOT EXISTS dispositivi (
  id serial PRIMARY KEY, persona_id int NOT NULL REFERENCES persone(id), token_hash text UNIQUE NOT NULL,
  pin_hash text NOT NULL, tentativi int NOT NULL DEFAULT 0, bloccato timestamptz,
  creato timestamptz NOT NULL DEFAULT now(), usato timestamptz);
CREATE TABLE IF NOT EXISTS sessioni (
  token_hash text PRIMARY KEY, persona_id int NOT NULL REFERENCES persone(id),
  scade timestamptz NOT NULL, creata timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sfide (
  id text PRIMARY KEY, sfida text NOT NULL, scopo text NOT NULL, persona_id int REFERENCES persone(id),
  dati jsonb, scade timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS settimane (
  settimana date PRIMARY KEY, chiusa timestamptz NOT NULL DEFAULT now(), email_inviata timestamptz);
CREATE TABLE IF NOT EXISTS richieste (
  id serial PRIMARY KEY, persona_id int NOT NULL REFERENCES persone(id), settimana date NOT NULL,
  sede text NOT NULL, reparto text NOT NULL, righe jsonb NOT NULL, nota text NOT NULL DEFAULT '',
  creata timestamptz NOT NULL DEFAULT now(), modificata timestamptz, annullata timestamptz);
CREATE INDEX IF NOT EXISTS richieste_settimana ON richieste (settimana);
CREATE TABLE IF NOT EXISTS ordini (
  id serial PRIMARY KEY, settimana date NOT NULL, sede text NOT NULL, reparto text NOT NULL,
  righe jsonb NOT NULL, righe_originali jsonb NOT NULL, note jsonb NOT NULL DEFAULT '[]',
  stato text NOT NULL DEFAULT 'da_approvare' CHECK (stato IN ('da_approvare','approvato','rifiutato')),
  deciso timestamptz, deciso_da int REFERENCES persone(id), email_inviata timestamptz,
  UNIQUE (settimana, sede, reparto));
CREATE TABLE IF NOT EXISTS limiti (chiave text PRIMARY KEY, conta int NOT NULL, inizio timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS registro (
  id bigserial PRIMARY KEY, quando timestamptz NOT NULL DEFAULT now(), persona_id int,
  azione text NOT NULL, dettagli jsonb NOT NULL DEFAULT '{}');
CREATE OR REPLACE FUNCTION registro_solo_aggiunte() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.quando < now() - interval '1 year' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'registro: solo aggiunte';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS registro_blocca ON registro;
CREATE TRIGGER registro_blocca BEFORE UPDATE OR DELETE ON registro
  FOR EACH ROW EXECUTE FUNCTION registro_solo_aggiunte();
```

- [ ] **Step 5: Write the failing test** `test/schema.test.js`:

```js
test('schema loads twice and the log is append-only', async () => {
  const pg = await dbProva();
  await pg.exec(readFileSync('db/schema.sql', 'utf8'));          // idempotent
  await q(`INSERT INTO registro (azione) VALUES ('prova')`);
  await assert.rejects(q(`UPDATE registro SET azione='x'`), /solo aggiunte/);
  await assert.rejects(q(`DELETE FROM registro`), /solo aggiunte/);
  await q(`INSERT INTO registro (quando, azione) VALUES (now() - interval '13 months', 'vecchio')`);
  await q(`DELETE FROM registro WHERE azione='vecchio'`);         // retention allowed
  const [{ n }] = await q(`SELECT count(*)::int n FROM registro`);
  assert.equal(n, 1);
  const r = await tx([[`INSERT INTO persone (nome, ruolo) VALUES ($1,'staff') RETURNING id`, ['A']], [`SELECT count(*)::int n FROM persone`, []]]);
  assert.equal(r[1][0].n, 1);
});
```

- [ ] **Step 6:** Run `npm test`, expect FAIL (`api/_db.js` missing).
- [ ] **Step 7: Implement `api/_db.js`.** Lazy `neon(process.env.DATABASE_URL)` on first call. `q` = `sql.query(text, params)`. `tx` = `sql.transaction(list.map(([t, p]) => sql.query(t, p)))`. `usaDb(adapter)` replaces both. `test/_db.js`: new `PGlite()`, `exec(schema)`, `usaDb({ q: (t,p) => pg.query(t,p).then(r => r.rows), tx: list => pg.transaction(async t => { const out = []; for (const [s, p] of list) out.push((await t.query(s, p)).rows); return out; }) })`.
- [ ] **Step 8: `scripts/migra.js`**: reads `db/schema.sql` and runs the whole file in one `client.query()` through `@neondatabase/serverless` `Pool` (the HTTP driver can't run several statements at once; Node 22 has a global `WebSocket`). Run against both branches: `vercel env pull .env.migra --environment production --yes && node --env-file=.env.migra scripts/migra.js && rm .env.migra`, then the same with `--environment preview --git-branch prova`. Expect `schema OK`.
- [ ] **Step 9: `vercel.json`:** `{"regions": ["fra1"]}` (crons and headers come in Tasks 8 and 10).
- [ ] **Step 10:** `npm test` passes (the old `test/auth.test.js` still passes too). Commit `db/ scripts/migra.js api/_db.js test/ vercel.json package*.json` as "Database: Neon schema, db adapter, PGlite tests".

### Task 2: Week maths

**Files:** Create `api/_settimana.js`, `test/settimana.test.js`

**Interfaces:**
- Produces: `settimanaDi(ora: Date) => string` (Friday `YYYY-MM-DD` of the order week the instant belongs to); `scadenza(settimana: string) => Date` (that Friday 16:00 Rome as an instant); `dataBreve(settimana) => string` (`27/11`).

- [ ] **Step 1: Failing tests** (UTC instants, Rome is +1 in winter, +2 in summer):

```js
const S = s => settimanaDi(new Date(s));
assert.equal(S('2026-11-27T14:59:59Z'), '2026-11-27');   // Fri 15:59:59 winter
assert.equal(S('2026-11-27T15:00:00Z'), '2026-12-04');   // Fri 16:00 winter -> next week
assert.equal(S('2026-07-03T13:59:59Z'), '2026-07-03');   // Fri 15:59:59 summer
assert.equal(S('2026-07-03T14:00:00Z'), '2026-07-10');
assert.equal(S('2026-11-28T08:00:00Z'), '2026-12-04');   // Saturday
assert.equal(S('2026-11-26T23:30:00Z'), '2026-11-27');   // Fri 00:30 Rome, Thu in UTC
assert.equal(S('2026-03-29T01:30:00Z'), '2026-04-03');   // DST switch night
assert.equal(S('2026-12-31T12:00:00Z'), '2027-01-01');   // year end
assert.equal(scadenza('2026-11-27').toISOString(), '2026-11-27T15:00:00.000Z');
assert.equal(scadenza('2026-07-03').toISOString(), '2026-07-03T14:00:00.000Z');
assert.equal(scadenza('2026-10-23').toISOString(), '2026-10-23T14:00:00.000Z');  // still summer time
assert.equal(scadenza('2026-10-30').toISOString(), '2026-10-30T15:00:00.000Z');  // after the switch
```

- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3: Implement.** Read Rome local parts with `Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Rome', weekday, year, month, day, hour, minute, hourCycle: 'h23'}).formatToParts`. Days to Friday = `(5 - weekday + 7) % 7`; if 0 and local time ≥ 16:00, 7. Add days on the calendar date with `Date.UTC`. `scadenza`: Rome offset for that date from `Intl` `timeZoneName: 'longOffset'`, then `Date.UTC(y, m-1, d, 16) - offset`.
- [ ] **Step 4:** Tests pass. Commit "Settimana: week and cut-off in Europe/Rome".

### Task 3: Product list and request validation

**Files:** Create `public/prodotti.json`, `api/_prodotti.js`, `test/prodotti.test.js`

**Interfaces:**
- Produces: `valida(body, catalogo = prodotti) => {sede, reparto, righe: Riga[], nota} | {errore: string}`, where `Riga = {cat, nome, dett, formato, q: number|null}` (snapshot copied from the catalogue; `cat: 'Altro'` for the free line, `q: null` means "da indicare"). Body: `{sede, reparto, righe: [{cat, nome, q}], altro?: {nome, q}, nota?}`.

- [ ] **Step 1: Extract the catalogue.** One-off node command that evaluates `const SEDI` (line 153) and `const DATI` (line 150) from `public/index.html` and writes `public/prodotti.json` as `{"sedi": SEDI, "reparti": DATI}`, pretty-printed with 2 spaces so Gabriele can edit it. Leave `index.html` as it is until Task 10.
- [ ] **Step 2: Failing tests:** valid request returns snapshot with `dett` and `formato` from the catalogue; unknown sede, unknown reparto → `Ordine non valido.`; product not in that reparto → `Un prodotto non è più in lista. Aggiorna l'app.`; `q` of `0`, `100`, `1.5`, `'2'` → `Quantità non valida.`; the same product twice in one request → `Prodotto ripetuto.`; altro name 81 chars or with newline → trimmed to one line and capped at 80 (not an error); altro q empty → `null`; nota capped at 500; no lines and no altro → `Aggiungi almeno un prodotto.`
- [ ] **Step 3:** FAIL. **Step 4:** Implement; import the catalogue with `import prodotti from '../public/prodotti.json' with { type: 'json' }`. **Step 5:** PASS. Commit "Prodotti: catalogue in prodotti.json, server-side validation".

### Task 4: Site, sessions, rate limits, log

**Files:** Create `api/_sito.js`, `api/_sessioni.js`, `api/_limiti.js`, `api/_registro.js`, `test/_http.js`, `test/sessioni.test.js`

**Interfaces:**
- Produces:
  - `sito(env = process.env) => {host, origin, rpID, prova: boolean} | null` (production when `VERCEL_ENV==='production'`; prova when `VERCEL_ENV==='preview' && VERCEL_GIT_COMMIT_REF==='prova'`; localhost when `VERCEL_ENV==='development'`).
  - `creaSessione(persona: {id, ruolo}) => Promise<string>` (Set-Cookie value); `chi(req) => Promise<{id, nome, ruolo} | null>` (renews staff sessions with less than 29 days left); `esci(req) => Promise<string>` (deletes the row, returns the clearing cookie); `revoca(personaId, {tutto})` deletes sessions, passkeys, devices and unused codes for that person.
  - `entrata(req, res, serve: 'nessuno'|'persona'|'admin') => Promise<{s, persona} | null>`: sets `Cache-Control: no-store`; 503 if `sito()` is null; 403 `Richiesta non valida.` if a non-GET has the wrong `Origin`; 401 `Accesso scaduto.` / 403 `Solo per Gabriele.` by role. When it returns null it has already answered.
  - `limite(chiave, max, secondi) => Promise<boolean>` (true = allowed), one upsert: reset when the window has passed, else `conta + 1`.
  - `registra(personaId | null, azione, dettagli = {})`.
  - `test/_http.js`: `finto()` response mock (from the old test) and `req(method, body, {cookie, origin, ip})` defaulting `origin` to `http://localhost:3000` and env `VERCEL_ENV=development`.
- Token: 32 random bytes base64url in the cookie, sha256 in the table. Cookie name `sessione`; Max-Age 30 days for staff, 12 hours for admin.

- [ ] **Step 1: Failing tests:** `sito` for the four env cases (production, prova, other preview → null, development); `entrata` 403 on wrong/missing Origin for POST, GET without Origin allowed; session round trip; expired session → null; staff session extended when used on day 2, admin session not extended; `revoca` ends the session; removed person (`rimossa` set) → `chi` null; `limite` allows 3 of max 3 then refuses, allows again after the window (the test moves `inizio` back with an `UPDATE limiti`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit "Sessions, origin check, rate limits, log".

### Task 5: Activation and login (passkey and PIN)

**Files:** Create `api/_codici.js`, `api/_passkey.js`, `api/attiva.js`, `api/accesso.js`, `test/_autenticatore.js`, `test/accesso.test.js`; modify `api/sessione.js`

**Interfaces:**
- Consumes: Task 4 helpers.
- Produces:
  - `nuovoCodice(personaId) => Promise<string>` (plain code, stored hashed, 48 h); `trovaCodice(codice) => Promise<{personaId, ruolo, hash} | null>` (unused, unexpired, person not removed); `consumaCodice(hash) => Promise<boolean>` (`UPDATE ... WHERE usato IS NULL RETURNING`).
  - `_passkey.js`: `opzioniRegistrazione(persona, s)`, `verificaRegistrazione(risposta, sfida, s)`, `opzioniAccesso(s, {allow?})`, `verificaAccesso(risposta, sfida, s)`. Settings: `rpName: 'Annaré Ordini'`, `attestationType: 'none'`, `authenticatorSelection: {residentKey: 'required', userVerification: 'required'}`, `requireUserVerification: true`, `userID` = person id as bytes. Challenges saved in `sfide` (5-minute expiry), read once with `DELETE ... RETURNING`.
  - `POST /api/attiva`: `{passo:'codice', codice}` → `{sfida, opzioni, ruolo}`; `{passo:'passkey', sfida, risposta}` → session; `{passo:'pin', sfida, pin}` → staff only, creates device, sets `dispositivo` and `sessione`. The code is consumed only in the last step. Rate limit `attiva:<ip>` 10 per 15 min.
  - `POST /api/accesso`: `{passo:'opzioni'}` → `{sfida, opzioni}`; `{passo:'verifica', sfida, risposta}` → session, updates counter and `usata`; `{passo:'pin', pin}` with the `dispositivo` cookie → session. Rate limit `accesso:<ip>` 30 per 15 min.
  - `GET /api/sessione` → `{nome, ruolo, prova}`; 401 with `{dispositivo: true}` when a valid unlocked device cookie is present (the app then shows the PIN pad). `DELETE` → logs out, keeps the device cookie.
  - `test/_autenticatore.js`: `nuovoAutenticatore({rpID, origin}) => {registra(opzioni, {uv = true}) => RegistrationResponseJSON, accedi(opzioni, {uv = true}) => AuthenticationResponseJSON}`. ES256 key from `crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'})`; authData = sha256(rpID) ‖ flags (UP 0x01, UV 0x04 when `uv`, AT 0x40 on create) ‖ counter (4 bytes) ‖ on create: 16 zero bytes AAGUID, credId length (2 bytes), credId, COSE key `{1:2, 3:-7, -1:1, -2:x, -3:y}`; attestation object CBOR `{fmt:'none', attStmt:{}, authData}`; assertion signature = ECDSA-SHA256 (DER) over authData ‖ sha256(clientDataJSON); `userHandle` = `opzioni.user.id` saved at registration. A minimal CBOR encoder (unsigned/negative ints, byte strings, text, maps) is enough.
- Log actions: `codice-usato`, `passkey-creata`, `pin-creato`, `accesso`, `accesso-fallito`, `pin-bloccato`.

- [ ] **Step 1: Failing tests:**
  - setup code → passkey → session works; the same code again → 401 `Codice non valido o scaduto.`; a code 49 hours old → same 401.
  - passkey registration with `uv: false` → rejected; login with `uv: false` → rejected.
  - passkey login with a challenge used twice → second rejected.
  - PIN: staff sets `123456`, logs in with device cookie; wrong PIN 5 times → locked, sixth with the right PIN → 423 `Telefono bloccato. Chiedi un nuovo codice a Gabriele.`; right PIN without device cookie → 401 `Questo telefono non è più attivo. Chiedi un nuovo codice a Gabriele.`; PIN `12345` or `abcdef` → 400.
  - admin code with `passo: 'pin'` → 403.
  - 11th code attempt from one IP in 15 minutes → 429 `Troppi tentativi. Riprova tra qualche minuto.`
  - `pin_hash` in the table is not the PIN and differs for two devices with the same PIN.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (scrypt via `crypto.scrypt` promisified, 16-byte salt, store `salt:hash` hex; compare with `timingSafeEqual`). **Step 4:** PASS. Commit "Login: setup codes, passkeys, PIN fallback".

### Task 6: People admin and Tom's recovery script

**Files:** Create `api/persone.js`, `scripts/codice-admin.js`, `test/persone.test.js`

**Interfaces:**
- Consumes: `nuovoCodice`, `revoca`, `entrata(..., 'admin')`, `registra`.
- Produces: `GET /api/persone` → `[{id, nome, ruolo, accesso: 'passkey'|'pin'|'nessuno', bloccato: boolean, ultimoUso}]` (not removed people); `POST {nome}` → `{id, codice}` (new staff); `POST {persona, azione: 'codice'}` → `{codice}`; `POST {persona, azione: 'telefono-perso'}` → revokes passkeys, devices, sessions and codes, keeps the person; `DELETE ?persona=` → same plus `rimossa = now()`. Name 1 to 60 chars, one line.
- `scripts/codice-admin.js "<nome>"`: with `DATABASE_URL` in env, finds the non-removed admin with that name or creates one, prints only the code and its expiry. Logs `codice-creato` with `{da: 'script'}`.

- [ ] **Step 1: Failing tests:** staff gets 403 on every method; add person returns a code that redeems (Task 5 helper); lost phone → that person's live session and passkey stop working, they can activate again with a new code; delete → session dead, not in the list, their old code dead; admin cannot delete himself (400 `Non puoi rimuovere te stesso.`).
- [ ] **Step 2–4:** FAIL, implement, PASS. Commit "Admin: people, setup codes, lost phone; Tom's admin code script".

### Task 7: Staff requests

**Files:** Create `api/richieste.js`, `test/richieste.test.js`

**Interfaces:**
- Consumes: `valida`, `settimanaDi`, `scadenza`, `entrata(..., 'persona')`, `registra`.
- Produces:
  - `POST /api/richieste` (body as Task 3) → `{id, settimana}`. Insert guard: `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM settimane WHERE settimana = $week)`; no row → 409 `L'ordine di questa settimana è già chiuso. Riprova: la richiesta andrà nella prossima.`
  - `PUT /api/richieste?id=` (same body) and `DELETE /api/richieste?id=` (sets `annullata`): own request only (else 404), only while `now < scadenza(settimana)` and the week is not in `settimane` (else 409 `Questa richiesta è già nell'ordine chiuso.`).
  - `GET /api/richieste` → `{settimana, scadenza, aperte: [...own requests of the current week...], passate: [...own requests of the last 4 closed weeks, each with esito: 'in_attesa'|'approvato'|'non_approvato' and per line the approved total when Gabriele changed it]}`.
- Optional clock override for tests: handlers read `globalThis.__ora?.() ?? new Date()` (tests only).

- [ ] **Step 1: Failing tests:** request saved into the right week (set clock Thursday); request at Friday 16:00:00 Rome goes to next week; edit and cancel before cut-off work, after cut-off → 409; another person's request → 404; insert when the week is already in `settimane` → 409 (Review Focus 1); `GET` shows own requests only.
- [ ] **Step 2–4:** FAIL, implement, PASS. Commit "Requests: save, edit, cancel until Friday 16:00".

### Task 8: Weekly close, notification, retention

**Files:** Create `api/_consolida.js`, `api/_email.js`, `api/chiusura.js`, `test/consolida.test.js`, `test/chiusura.test.js`; modify `vercel.json`

**Interfaces:**
- Produces:
  - `consolida(richieste: {id, persona_id, nome, sede, reparto, righe, nota}[]) => {sede, reparto, righe: RigaOrdine[], note: {nome, nota}[]}[]` with `RigaOrdine = {cat, nome, dett, formato, q: number|null, chi: {nome, q}[]}`. Same `cat|nome|formato` summed; `Altro` lines never merged; `q: null` lines keep `null` total and list who asked. Groups and lines sorted by catalogue order where present, `Altro` last.
  - `invia({subject, text, attachments?, chiave}) => Promise<boolean>` in `_email.js` (Resend to `ORDINI_A`, `Idempotency-Key: chiave`, logs `email-inviata`); returns false when `RESEND_API_KEY`, `ORDINI_DA` or `ORDINI_A` is missing or `sito().prova` is true.
  - `chiudi(ora: Date) => Promise<{chiuse: string[], email: boolean}>`: for every week with requests where `ora >= scadenza(settimana) + 60s` and no `settimane` row: one `tx` that inserts `settimane` (`ON CONFLICT DO NOTHING`) and the week's `ordini` (`ON CONFLICT DO NOTHING`, `righe_originali = righe`); log `settimana-chiusa`. Then the email: claim with `UPDATE settimane SET email_inviata = now() WHERE settimana = $1 AND email_inviata IS NULL RETURNING`; on send failure set it back to NULL and log `email-fallita`. Email text includes the number of orders with `stato = 'da_approvare'`. Then retention deletes (requests and orders with `settimana < now - 2 years`, log `quando < now - 1 year`, expired `sessioni`, `sfide`, `codici`, `limiti` older than a day).
  - `GET /api/chiusura` with `Authorization: Bearer ${CRON_SECRET}` → runs `chiudi(new Date())`. `POST /api/chiusura` → admin only and only when `sito().prova` ("chiudi la settimana ora": closes the current week too, ignoring the cut-off), else 404.
  - `vercel.json` `crons: [{"path": "/api/chiusura", "schedule": "2 14-18 * * 5"}]` (covers 16:02 Rome in both summer and winter, and catches up if a run is missed).

- [ ] **Step 1: Failing tests:**
  - `consolida`: two people asking 2 and 3 of the same product → one line `q: 5` with both names; altro lines stay separate; a renamed product (different snapshot) stays its own line (Review Focus 4); cancelled requests excluded (caller filters, test the handler).
  - `chiudi` before 16:01 → nothing; after → one order per sede+reparto, one email with link and no product names; run twice in `Promise.all` → one set of orders, one email (Review Focus 2); week with no requests → no email; failed send → `email_inviata` NULL and the next run sends; previous week's unapproved order counted in the next Friday's email.
  - cron without the bearer → 401; prova `POST` by staff → 403, in production → 404.
- [ ] **Step 2–4:** FAIL, implement, PASS. Commit "Weekly close at Friday 16:00, one email, retention".

### Task 9: Server PDF and approval

**Files:** Create `api/_pdf.js`, `api/_fonti/{isr,isi,m4,m7}.ttf`, `api/_fonti/logo.png`, `api/ordini.js`, `test/ordini.test.js`

**Interfaces:**
- Consumes: Task 5 passkey helpers, `invia`, `registra`, `entrata(..., 'admin')`.
- Produces:
  - `creaPdf(o: {num, data, ora, sede, reparto, approvatoDa, settimana, gruppi: {cat, righe: {nome, dett, formato, q}[]}[], note: string}) => Promise<Uint8Array>`. Port `creaPdf` from `public/index.html:266-319` with `pdf-lib` and `@pdf-lib/fontkit` imports; fonts and logo read with `readFileSync(new URL('./_fonti/…', import.meta.url))`. Header rows: Sede, Reparto, Settimana (`venerdì 27/11`), Approvato da. `q: null` prints `da indicare`. Lines carry totals only (no staff names); notes print as `Nome: nota`.
  - `GET /api/ordini` → `{da_approvare: [...], recenti: [...last 8 weeks decided...]}` with lines, `chi` and notes. `GET /api/ordini?pdf=<id>` → `application/pdf` for an approved order.
  - `POST /api/ordini {passo: 'opzioni', ordine, righe: [{indice, q}]}`: `q` 0 to 99 (0 removes the line), one entry per existing line, no new lines → `{sfida, opzioni}` with `userVerification: 'required'` and `allowCredentials` = the admin's passkeys; the proposed lines are stored in the challenge's `dati`.
  - `POST /api/ordini {passo: 'approva', sfida, risposta}` → verify (fresh UV); if every `q` is 0 the order becomes `rifiutato`, else `approvato` with the edited `righe` (keep `righe_originali`). `UPDATE ... WHERE id = $1 AND stato = 'da_approvare' RETURNING`; no row → 409 `Ordine già approvato.` Log `ordine-modificato` (each change with old and new q), `ordine-approvato` or `ordine-rifiutato`. Then PDF email (`chiave: 'ordine-<id>'`); failure → 200 with `{email: false}` and the app shows "Approvato. L'email non è partita: scarica il PDF."
  - Fonts: one-off node command evaluates `FONT` (line 152) and `LOGO_PNG` (line 151) from `index.html` and writes the files.

- [ ] **Step 1: Failing tests:** staff → 403; approve with a response signed with `uv: false` → 401 and order still `da_approvare`; approve with a challenge made for another order → 400; edited quantity saved, original kept, logged; all lines 0 → `rifiutato`, no email; approve twice → second 409, one email (Review Focus 5); `creaPdf` output starts with `%PDF`, and a 60-line order gives `(await PDFDocument.load(bytes)).getPageCount() === 2`; `?pdf=` on an unapproved order → 404.
- [ ] **Step 2–4:** FAIL, implement, PASS. Commit "Approval with fresh passkey check, server PDF".

### Task 10: Front end

**Files:** Create `public/app.js`, `public/gestione.js`, `public/simplewebauthn.umd.min.js`; modify `public/index.html`, `public/sw.js`, `vercel.json`; delete `api/_auth.js`, `api/ordine.js`, `test/auth.test.js`, `public/pdf-lib.min.js`, `public/fontkit.umd.min.js`

**Interfaces:**
- Consumes: every endpoint above. Browser global `SimpleWebAuthnBrowser.{startRegistration, startAuthentication, browserSupportsWebAuthn}`.
- Screens (`section.vista`, Gabriele's existing classes only, no new visual style):
  - `v-accesso`: "Entra" (passkey) and "Ho un codice di attivazione".
  - `v-attiva`: code field → passkey creation; if `startRegistration` throws or WebAuthn is unsupported and the role is staff, show "Il telefono non riesce a creare l'accesso. Scegli un PIN di 6 cifre." with PIN and repeat.
  - `v-pin`: 6-digit field (`inputmode="numeric"`, `autocomplete="off"`), shown when `/api/sessione` answers `{dispositivo: true}`.
  - `v-inizio`, `v-lista`, `v-riepilogo` as today; "Invia" saves the request (POST, or PUT when editing).
  - `v-fatto`: "Richiesta salvata. Entra nell'ordine di venerdì 27/11. Puoi cambiarla fino a venerdì alle 16:00." No PDF button.
  - `v-mie`: this week's requests (Modifica, Annulla) and past outcomes.
  - `v-gestione` (admin only, `gestione.js`, reachable at `#gestione`): people (add, new code shown once, lost phone, remove, login type), orders waiting (per sede+reparto, lines with total and who, quantity inputs and remove, "Approva con Face ID"), recent orders with "Scarica PDF", and on prova only "Chiudi la settimana ora".
  - The `.prova` banner shows only when `/api/sessione` says `prova: true`.
- `index.html` keeps markup and styles only: remove lines 149-343 and load `simplewebauthn.umd.min.js`, `app.js`, `gestione.js` with plain `<script src defer>`. `app.js` fetches `prodotti.json` instead of `DATI`/`SEDI`. Drop the `window.creaPdf` debug hooks and the client PDF code.
- `sw.js`: `CACHE = "annare-ordini-v3"`; FILE list without pdf-lib, with `app.js`, `gestione.js`, `simplewebauthn.umd.min.js`; `prodotti.json` and navigations network-first; cache a navigation response only when `r.ok`.
- `vercel.json` `headers` for `/(.*)`: the CSP, Referrer-Policy and nosniff values from Global Constraints.

- [ ] **Step 1:** Run `npm test`: the old auth tests are deleted with their modules; all others pass.
- [ ] **Step 2: Local e2e.** `vercel env pull .env.local --environment preview --git-branch prova --yes`, then `vercel dev` (development host `localhost:3000`). Extend the scratchpad Playwright script (Chrome channel) with a CDP virtual authenticator (`WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator` with `protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true`). Flow: admin code from `scripts/codice-admin.js` → passkey → add staff → staff activates with PIN (second browser context with `browserSupportsWebAuthn` forced false) → staff sends a request → admin "Chiudi la settimana ora" → edits a quantity → approves → downloads PDF. Expected: each screen reached, PDF downloads, browser console has no CSP errors.
- [ ] **Step 3:** Commit "App: passkey and PIN login, weekly requests, Gabriele's admin section; app.js split, CSP".

### Task 11: Prova preview, README, launch

**Files:** Modify `README.md`; Vercel env and Git

- [ ] **Step 1: Prova.** `git push origin HEAD:prova`. Read the branch URL from `vercel ls` / the deployment's aliases and confirm it equals the host in `_sito.js`; if not, fix the constant and push again. Run the Task 10 e2e against it. Expected: same pass, `/api/chiusura` GET without bearer 401, response headers include the CSP.
- [ ] **Step 2: Another branch** pushed as `prova-x` answers 503 `Anteprima non configurata.` on `/api/sessione`. Delete the branch.
- [ ] **Step 3: README.** Replace the `STAFF` sections with: env vars (`DATABASE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `ORDINI_DA`, `ORDINI_A`); `scripts/migra.js` and `scripts/codice-admin.js` usage; previews only on `prova`. "Per Gabriele" (Italian): prodotti in `public/prodotti.json`, testi in `public/index.html`, provare su `prova` (Tom gli dà un codice admin di prova), alzare `CACHE` in `sw.js`, non toccare `api/`, aggiungere persone dalla sezione Gestione.
- [ ] **Step 4: Stop and ask Tom** before launch: it replaces everyone's login. On his go: `vercel env add CRON_SECRET production` (random 32+ chars), merge to `main` and push, run `scripts/migra.js` on production first, then `vercel env rm STAFF` and `SESSION_SECRET` for Production, Preview and Development, `vercel redeploy ordini.annarepizzeria.com`. Tom runs `scripts/codice-admin.js "Gabriele"` himself and sends Gabriele the code.
- [ ] **Step 5: Code access.** Ask Tom to confirm that 2FA is on for his GitHub account and Gabriele's (spec: anyone who can push `main` can change the server).
- [ ] **Step 6: Production check:** `/api/sessione` 401 without cookie, `/api/chiusura` 401 without bearer, CSP header present, Gabriele's activation works on his iPhone. Commit README and push.
