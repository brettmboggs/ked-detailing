-- Inventory: what Jacob keeps in the van. Counts can be fractions (0.25 gal),
-- so they're REAL, rounded to 3 places on every change.
CREATE TABLE inventory_items (
  id          TEXT PRIMARY KEY, -- ULID
  name        TEXT NOT NULL,
  barcode     TEXT UNIQUE,      -- normalised: UPC-A stored as its 13-digit EAN form
  unit        TEXT NOT NULL,    -- 'bottle', 'gal', 'pack', …
  on_hand     REAL NOT NULL DEFAULT 0,
  reorder_at  REAL,             -- low once on_hand is at or below this
  reorder_url TEXT,
  cost        INTEGER,          -- cents per unit, from the last restock
  notes       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Every change to a count, so a wrong number can be traced back.
CREATE TABLE stock_movements (
  id         TEXT PRIMARY KEY, -- ULID
  item_id    TEXT NOT NULL REFERENCES inventory_items (id),
  delta      REAL NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('restock', 'used', 'adjust')),
  job_id     TEXT REFERENCES jobs (id),
  on_hand    REAL NOT NULL,    -- the count after this change
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX stock_movements_item ON stock_movements (item_id, created_at);
CREATE INDEX stock_movements_job ON stock_movements (job_id);

-- What a package usually uses, to pre-fill "what did you use" on a finished job.
CREATE TABLE service_usage (
  service TEXT NOT NULL,       -- pricing service id: 'level-1', 'marine', …
  item_id TEXT NOT NULL REFERENCES inventory_items (id),
  amount  REAL NOT NULL CHECK (amount > 0),
  PRIMARY KEY (service, item_id)
);
