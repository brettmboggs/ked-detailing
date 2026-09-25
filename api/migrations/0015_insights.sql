-- CRM insights (docs/crm.md, part 3): what each marketing channel cost, and
-- the weekly plain-English summary.

-- Money spent on a channel in a month: "Instagram boosts, September, $40".
-- Kept apart from the books on purpose: book entries are never edited (only
-- voided), and one ad bill often covers several channels, so tagging entries
-- would be both awkward and wrong. The books' Advertising total is shown next
-- to these so Jacob can see anything he hasn't split out yet.
CREATE TABLE marketing_spend (
  id         TEXT PRIMARY KEY, -- ULID
  month      TEXT NOT NULL,    -- YYYY-MM
  source     TEXT NOT NULL,    -- one of SOURCES in api/src/attribution.ts
  amount     INTEGER NOT NULL CHECK (amount > 0), -- cents
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX marketing_spend_month ON marketing_spend (month, source);

-- The weekly note to Jacob. Written by Claude when ANTHROPIC_API_KEY is set,
-- else built from the rules alone (`source` says which).
CREATE TABLE insight_summaries (
  id          TEXT PRIMARY KEY, -- ULID
  week_start  TEXT NOT NULL,    -- YYYY-MM-DD, the Monday of the week it covers
  week_end    TEXT NOT NULL,    -- YYYY-MM-DD, that Sunday
  source      TEXT NOT NULL CHECK (source IN ('claude', 'rules')),
  model       TEXT,
  body        TEXT NOT NULL,    -- plain text, paragraphs split by blank lines
  numbers     TEXT NOT NULL,    -- JSON: the figures and actions it was written from
  note        TEXT,             -- why it fell back to the rules, if it did
  input_tokens  INTEGER,
  output_tokens INTEGER,
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,    -- 'cron' or the owner who asked for it
  created_at  TEXT NOT NULL
);
CREATE INDEX insight_summaries_week ON insight_summaries (week_start, created_at DESC);
