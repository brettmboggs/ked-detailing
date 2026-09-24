-- Invoices: what a customer owes for a job, and the private link they pay it
-- through. Whether one is paid is never stored: it's read from the books (the
-- job's income entries), so "Mark paid", a matched bank deposit and Stripe all
-- settle it the same way, and voiding a payment reopens it.
CREATE TABLE invoices (
  id          TEXT PRIMARY KEY, -- ULID
  number      INTEGER NOT NULL UNIQUE, -- what the customer sees: 1001, 1002, …
  job_id      TEXT NOT NULL REFERENCES jobs (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'void')),
  lines       TEXT NOT NULL,    -- JSON [{ label, amount }], cents; a discount is negative
  total       INTEGER NOT NULL CHECK (total > 0),
  due_date    TEXT,             -- YYYY-MM-DD; null means due on receipt
  notes       TEXT,             -- shown to the customer
  token       TEXT NOT NULL UNIQUE, -- the pay link's secret
  sent_at     TEXT,
  viewed_at   TEXT,             -- first time the customer opened the link
  voided_at   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- One live invoice per job. To start over, void it and make another.
CREATE UNIQUE INDEX invoices_open_job ON invoices (job_id) WHERE status = 'open';
CREATE INDEX invoices_customer ON invoices (customer_id);
