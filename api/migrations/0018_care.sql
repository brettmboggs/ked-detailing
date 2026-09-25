-- After-care: the weather nudge, the "your car's done" page, ceramic coating
-- certificates and the QR stickers that point at a car's page.

-- The National Weather Service answers a lat/lng with the forecast URL for its
-- grid square. That never changes for a place, so each ZIP looks it up once.
CREATE TABLE weather_grid (
  zip          TEXT PRIMARY KEY,
  forecast_url TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);

-- The customer's link to their finished job: photos, invoice, review button.
-- The link stops working at done_expires_at; the photos stay in the app.
ALTER TABLE jobs ADD COLUMN done_token TEXT;
ALTER TABLE jobs ADD COLUMN done_expires_at TEXT;
CREATE UNIQUE INDEX jobs_done_token ON jobs (done_token) WHERE done_token IS NOT NULL;

CREATE TABLE coatings (
  id                 TEXT PRIMARY KEY, -- ULID
  customer_id        TEXT NOT NULL REFERENCES customers (id),
  job_id             TEXT REFERENCES jobs (id),
  vehicle            TEXT,
  product            TEXT NOT NULL,
  applied_on         TEXT NOT NULL, -- YYYY-MM-DD
  warranty_months    INTEGER NOT NULL,
  maintenance_months INTEGER NOT NULL DEFAULT 12, -- 0: no upkeep required
  maintained         TEXT NOT NULL DEFAULT '[]', -- JSON [{ date, jobId }]
  notes              TEXT,
  token              TEXT NOT NULL UNIQUE, -- the certificate link
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  voided_at          TEXT
);
CREATE INDEX coatings_customer ON coatings (customer_id);
CREATE INDEX coatings_job ON coatings (job_id);

-- A sticker in the door jamb. Its QR code is <site>/c/<code>; scanning it in
-- the app ties it to a customer's car (and its coating, if it has one).
CREATE TABLE car_tags (
  code        TEXT PRIMARY KEY, -- uppercase letters and digits
  customer_id TEXT NOT NULL REFERENCES customers (id),
  vehicle     TEXT,
  job_id      TEXT REFERENCES jobs (id),
  coating_id  TEXT REFERENCES coatings (id),
  linked_at   TEXT NOT NULL,
  linked_by   TEXT NOT NULL
);
CREATE INDEX car_tags_customer ON car_tags (customer_id);
