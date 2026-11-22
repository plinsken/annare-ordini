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
