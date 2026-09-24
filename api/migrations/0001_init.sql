-- Pricing: every save is a new row, so old quotes can be explained by the
-- version that produced them. The newest row is live.
CREATE TABLE pricing_configs (
  version    INTEGER PRIMARY KEY,
  config     TEXT    NOT NULL, -- PricingConfig JSON
  created_at TEXT    NOT NULL,
  created_by TEXT    NOT NULL
);

-- Quote requests from the website.
CREATE TABLE leads (
  id             TEXT PRIMARY KEY, -- ULID
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'booked', 'lost')),
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  vehicle        TEXT,
  zip            TEXT,
  notes          TEXT,
  input          TEXT NOT NULL, -- QuoteInput JSON
  quote          TEXT NOT NULL, -- priced server-side, never trusted from the client
  config_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX leads_status_created ON leads (status, created_at DESC);

-- App sessions. Only a hash of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  subject    TEXT NOT NULL, -- Apple sub
  email      TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
