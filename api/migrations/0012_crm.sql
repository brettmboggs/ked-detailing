-- CRM foundation: where customers come from, tags and consent, a timeline of
-- every touch, follow-ups to do, and email campaigns. See docs/crm.md.

-- Where a lead or customer came from. `source` is one of the fixed channels in
-- api/src/attribution.ts; `attribution` is JSON: { utmSource, utmMedium,
-- utmCampaign, referrer, landing, firstSeen, ref }.
ALTER TABLE leads ADD COLUMN source TEXT;
ALTER TABLE leads ADD COLUMN source_detail TEXT;
ALTER TABLE leads ADD COLUMN attribution TEXT;
ALTER TABLE leads ADD COLUMN customer_id TEXT REFERENCES customers (id);

ALTER TABLE jobs ADD COLUMN attribution TEXT;

-- First touch wins: set when the customer is created, filled in later only if blank.
ALTER TABLE customers ADD COLUMN source TEXT;
ALTER TABLE customers ADD COLUMN source_detail TEXT;
ALTER TABLE customers ADD COLUMN attribution TEXT;
ALTER TABLE customers ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'; -- JSON array of short strings
ALTER TABLE customers ADD COLUMN referred_by TEXT REFERENCES customers (id);
ALTER TABLE customers ADD COLUMN referral_code TEXT; -- theirs to share: kedservice.com/?ref=<code>
-- Consent. Email marketing is opt-out (with a working unsubscribe link in
-- every email); texts are only ever sent by Jacob by hand.
ALTER TABLE customers ADD COLUMN email_ok INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN text_ok INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN unsubscribe_token TEXT;
CREATE UNIQUE INDEX customers_referral_code ON customers (referral_code) WHERE referral_code IS NOT NULL;
CREATE UNIQUE INDEX customers_unsubscribe ON customers (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;
CREATE INDEX customers_source ON customers (source);
CREATE INDEX leads_customer ON leads (customer_id);

-- Everything that happened with a customer, newest first: notes, calls,
-- texts Jacob sent, emails the system sent, review asks.
CREATE TABLE activities (
  id          TEXT PRIMARY KEY, -- ULID
  customer_id TEXT REFERENCES customers (id),
  lead_id     TEXT REFERENCES leads (id),
  job_id      TEXT REFERENCES jobs (id),
  kind        TEXT NOT NULL CHECK (kind IN ('note', 'call', 'text', 'email', 'review_request', 'referral', 'system')),
  body        TEXT,
  meta        TEXT, -- JSON
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL -- owner email/sub, or 'system'
);
CREATE INDEX activities_customer ON activities (customer_id, created_at DESC);
CREATE INDEX activities_lead ON activities (lead_id, created_at DESC);

-- Things to do: made by the daily rules (rule_key dedupes them) or by hand.
CREATE TABLE follow_ups (
  id          TEXT PRIMARY KEY, -- ULID
  customer_id TEXT REFERENCES customers (id),
  lead_id     TEXT REFERENCES leads (id),
  job_id      TEXT REFERENCES jobs (id),
  kind        TEXT NOT NULL CHECK (kind IN ('rebook', 'review', 'winback', 'quote_chase', 'thank_you', 'reminder', 'custom')),
  due_date    TEXT NOT NULL, -- YYYY-MM-DD, business time zone
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped', 'sent')),
  channel     TEXT CHECK (channel IN ('text', 'email', 'call')),
  title       TEXT NOT NULL,
  message     TEXT, -- ready-to-send text or email body
  rule_key    TEXT, -- e.g. 'review:<jobId>'; one follow-up per key, ever
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  done_at     TEXT
);
CREATE UNIQUE INDEX follow_ups_rule ON follow_ups (rule_key) WHERE rule_key IS NOT NULL;
CREATE INDEX follow_ups_open ON follow_ups (status, due_date);
CREATE INDEX follow_ups_customer ON follow_ups (customer_id);

-- Email campaigns to a segment of customers.
CREATE TABLE campaigns (
  id          TEXT PRIMARY KEY, -- ULID
  name        TEXT NOT NULL,
  segment     TEXT NOT NULL, -- JSON filter, see docs/crm.md
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'text')),
  subject     TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  sent_at     TEXT
);

CREATE TABLE campaign_sends (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  status      TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error       TEXT,
  sent_at     TEXT,
  PRIMARY KEY (campaign_id, customer_id)
);
