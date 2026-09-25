-- Add-ons Jacob finds at the car ("your headlights are yellowed, $60 to fix").
-- He offers them with a note and a photo; the customer says yes or no through
-- a private link (jobs.extras_token), or tells him in person. A yes adds a
-- line to the job's price and its invoice. See api/src/extras.ts.
CREATE TABLE job_extras (
  id          TEXT PRIMARY KEY, -- ULID
  job_id      TEXT NOT NULL REFERENCES jobs (id),
  add_on_id   TEXT,             -- the price list's add-on, when it came from there
  label       TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0), -- cents
  note        TEXT,             -- what he found, shown to the customer
  photo_id    TEXT REFERENCES photos (id),
  status      TEXT NOT NULL DEFAULT 'offered'
                CHECK (status IN ('offered', 'approved', 'declined', 'withdrawn')),
  decided_by  TEXT CHECK (decided_by IN ('customer', 'owner')),
  sent_at     TEXT,             -- first time it went out in a text or email
  decided_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX job_extras_job ON job_extras (job_id);

-- The customer's link for them: SITE_URL/approve/?a=<token>. Made the first
-- time Jacob sends one, and the same for every add-on on that job.
ALTER TABLE jobs ADD COLUMN extras_token TEXT;
CREATE UNIQUE INDEX jobs_extras_token ON jobs (extras_token);
