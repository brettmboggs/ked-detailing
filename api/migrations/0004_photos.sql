-- Photos: receipts for the books, before/after shots for jobs. The image
-- bytes live in KV (PHOTO_KV), or R2 if the account ever enables it; this is
-- the index.
CREATE TABLE photos (
  id           TEXT PRIMARY KEY, -- ULID
  object_key   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('receipt', 'job')),
  stage        TEXT CHECK (stage IN ('before', 'after')), -- job photos only
  job_id       TEXT REFERENCES jobs (id),
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  caption      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX photos_job ON photos (job_id);
