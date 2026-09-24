-- Books: a double-entry ledger under plain categories. Jacob picks
-- "Supplies" and "Business checking"; the lines underneath balance.

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  schedule_c    TEXT,             -- Schedule C line for income and expense accounts
  money_account INTEGER NOT NULL DEFAULT 0, -- can pay, receive and take bank imports
  hint          TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Generated from packages/books/src/accounts.ts (defaultAccounts).
INSERT INTO accounts (id, name, type, schedule_c, money_account, hint, sort) VALUES
  ('checking', 'Business checking', 'asset', NULL, 1, NULL, 0),
  ('cash', 'Cash on hand', 'asset', NULL, 1, NULL, 10),
  ('stripe', 'Stripe balance', 'asset', NULL, 1, 'Card payments waiting to pay out', 20),
  ('credit-card', 'Business credit card', 'liability', NULL, 1, NULL, 30),
  ('sales-tax', 'Sales tax owed', 'liability', NULL, 0, NULL, 40),
  ('owner-contributions', 'Owner contributions', 'equity', NULL, 0, 'Your own money put into the business', 50),
  ('owner-draws', 'Owner draws', 'equity', NULL, 0, 'Money you take out for yourself', 60),
  ('opening-balance', 'Opening balances', 'equity', NULL, 0, NULL, 70),
  ('income-detailing', 'Detailing', 'income', '1', 0, NULL, 80),
  ('income-marine', 'Marine detailing', 'income', '1', 0, NULL, 90),
  ('income-merch', 'Merch sales', 'income', '1', 0, NULL, 100),
  ('income-tips', 'Tips', 'income', '1', 0, NULL, 110),
  ('income-other', 'Other income', 'income', '6', 0, NULL, 120),
  ('supplies', 'Supplies', 'expense', '22', 0, 'Chemicals, towels, pads, brushes', 130),
  ('equipment-small', 'Tools and small equipment', 'expense', '22', 0, 'Polishers, vacuums, extractors', 140),
  ('fuel', 'Fuel and vehicle costs', 'expense', '9', 0, 'Only if not claiming mileage', 150),
  ('advertising', 'Advertising', 'expense', '8', 0, 'Ads, flyers, van wrap, website', 160),
  ('fees', 'Card and payment fees', 'expense', '10', 0, 'Stripe and other processing fees', 170),
  ('contract-labor', 'Contract labor', 'expense', '11', 0, 'Paying a helper who is not an employee', 180),
  ('insurance', 'Insurance', 'expense', '15', 0, 'Business liability, garage keepers', 190),
  ('professional', 'Legal and accounting', 'expense', '17', 0, NULL, 200),
  ('office', 'Office and software', 'expense', '18', 0, 'Apps, subscriptions, postage', 210),
  ('equipment-rental', 'Equipment rental', 'expense', '20b', 0, NULL, 220),
  ('repairs', 'Repairs and maintenance', 'expense', '21', 0, 'Fixing equipment', 230),
  ('licenses', 'Licenses and fees', 'expense', '23', 0, 'Business license, LLC renewal', 240),
  ('travel', 'Travel', 'expense', '24a', 0, 'Overnight trips for work', 250),
  ('meals', 'Meals', 'expense', '24b', 0, 'Business meals', 260),
  ('phone', 'Phone and internet', 'expense', '25', 0, NULL, 270),
  ('uniforms', 'Uniforms and merch for staff', 'expense', '27a', 0, NULL, 280),
  ('other-expense', 'Other expenses', 'expense', '27a', 0, NULL, 290),
  ('merch-cost', 'Merch cost', 'expense', '4', 0, 'What the merch cost you to make', 300);

CREATE TABLE payees (
  id               TEXT PRIMARY KEY, -- ULID
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'vendor' CHECK (kind IN ('vendor', 'contractor')),
  -- A W-9 is on file. The form itself stays with Jacob; no tax IDs are stored here.
  tax_form_on_file INTEGER NOT NULL DEFAULT 0,
  email            TEXT,
  phone            TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX payees_name ON payees (name);

-- Entries are never edited or deleted. Voiding posts an exact reversal, so
-- history and every past report stay explainable.
CREATE TABLE entries (
  id          TEXT PRIMARY KEY, -- ULID
  date        TEXT NOT NULL,    -- YYYY-MM-DD, local
  kind        TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'reversal')),
  memo        TEXT,
  payee_id    TEXT REFERENCES payees (id),
  job_id      TEXT REFERENCES jobs (id),
  method      TEXT,             -- how it was paid: card, cash, check, zelle, …
  receipt_key TEXT,             -- R2 object key, once receipt photos land
  reverses    TEXT REFERENCES entries (id),
  voided_by   TEXT REFERENCES entries (id),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL
);
CREATE INDEX entries_date ON entries (date);
CREATE INDEX entries_job ON entries (job_id);
CREATE INDEX entries_payee ON entries (payee_id);

CREATE TABLE entry_lines (
  entry_id   TEXT NOT NULL REFERENCES entries (id),
  line       INTEGER NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  amount     INTEGER NOT NULL CHECK (amount != 0), -- cents, + debit / - credit
  PRIMARY KEY (entry_id, line)
);
CREATE INDEX entry_lines_account ON entry_lines (account_id);

CREATE TABLE bank_imports (
  id         TEXT PRIMARY KEY, -- ULID
  account_id TEXT NOT NULL REFERENCES accounts (id),
  filename   TEXT,
  rows       INTEGER NOT NULL,
  added      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE bank_lines (
  id          TEXT PRIMARY KEY, -- ULID
  import_id   TEXT NOT NULL REFERENCES bank_imports (id),
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  date        TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      INTEGER NOT NULL, -- cents, + in / - out of the account
  fingerprint TEXT NOT NULL UNIQUE, -- re-importing an overlapping statement adds nothing
  status      TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'ignored')),
  entry_id    TEXT REFERENCES entries (id),
  created_at  TEXT NOT NULL
);
CREATE INDEX bank_lines_status ON bank_lines (status, date);
CREATE INDEX bank_lines_entry ON bank_lines (entry_id);

-- Business miles, for the standard mileage deduction.
CREATE TABLE trips (
  id         TEXT PRIMARY KEY, -- ULID
  date       TEXT NOT NULL,
  miles      REAL NOT NULL CHECK (miles > 0),
  purpose    TEXT NOT NULL,
  from_place TEXT,
  to_place   TEXT,
  job_id     TEXT REFERENCES jobs (id),
  created_at TEXT NOT NULL
);
CREATE INDEX trips_date ON trips (date);
