-- Jacob's phones, for push alerts (a booking, a quote request, an invoice
-- opened). Expo push tokens; one row per install.
CREATE TABLE devices (
  token      TEXT PRIMARY KEY, -- ExponentPushToken[…]
  subject    TEXT NOT NULL,    -- who signed in on it
  created_at TEXT NOT NULL,
  seen_at    TEXT NOT NULL
);

-- Every alert, kept whether or not a phone got it, so nothing is lost if a
-- push fails. The app can list these too.
CREATE TABLE alerts (
  id         TEXT PRIMARY KEY, -- ULID
  type       TEXT NOT NULL,    -- 'booking', 'lead', 'invoice_opened'
  ref_id     TEXT,             -- the job, lead or invoice
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  pushed     INTEGER NOT NULL DEFAULT 0, -- phones that accepted it
  emailed    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX alerts_created ON alerts (created_at);
