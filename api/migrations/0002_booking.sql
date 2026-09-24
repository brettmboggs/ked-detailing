-- Jacob's settings, one JSON document per key ('booking' = BookingRules).
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE customers (
  id         TEXT PRIMARY KEY, -- ULID
  name       TEXT NOT NULL,
  phone      TEXT,             -- as typed
  phone_key  TEXT,             -- last 10 digits, for matching repeat customers
  email      TEXT,             -- lower-cased
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX customers_phone ON customers (phone_key);
CREATE INDEX customers_email ON customers (email);

-- Every booked job, whether the customer booked it online or Jacob added it.
-- Times are UTC ISO strings from toISOString(), so they compare as text.
CREATE TABLE jobs (
  id             TEXT PRIMARY KEY, -- ULID
  customer_id    TEXT NOT NULL REFERENCES customers (id),
  status         TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'in_progress', 'done', 'cancelled')),
  source         TEXT NOT NULL CHECK (source IN ('web', 'app')),
  service        TEXT NOT NULL,
  vehicle        TEXT,
  address        TEXT NOT NULL,
  zip            TEXT,
  notes          TEXT,
  input          TEXT NOT NULL, -- QuoteInput JSON
  quote          TEXT NOT NULL, -- quote summary JSON, priced server-side
  config_version INTEGER NOT NULL,
  final_price    INTEGER,       -- cents, set when Jacob settles the price
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  local_date     TEXT NOT NULL, -- start's date in the business zone, for per-day limits
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX jobs_start ON jobs (start_at);
CREATE INDEX jobs_day ON jobs (local_date, status);
CREATE INDEX jobs_customer ON jobs (customer_id);

CREATE TABLE time_off (
  id         TEXT PRIMARY KEY, -- ULID
  start_at   TEXT NOT NULL,
  end_at     TEXT NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX time_off_start ON time_off (start_at);
