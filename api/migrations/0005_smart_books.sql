-- Rules learned from how Jacob files bank lines: the next line from the same
-- merchant, in the same direction, is filed the same way without asking.
CREATE TABLE bank_rules (
  id               TEXT PRIMARY KEY, -- ULID
  merchant         TEXT NOT NULL,    -- merchantKey() of the description
  direction        INTEGER NOT NULL CHECK (direction IN (-1, 1)), -- money out / in
  action           TEXT NOT NULL CHECK (action IN ('categorize', 'transfer', 'personal')),
  category_id      TEXT REFERENCES accounts (id),
  other_account_id TEXT REFERENCES accounts (id),
  payee_id         TEXT REFERENCES payees (id),
  hits             INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (merchant, direction)
);

ALTER TABLE bank_lines ADD COLUMN merchant TEXT;
-- JSON: what the books think this line is, for one-tap accept. Null if no idea.
ALTER TABLE bank_lines ADD COLUMN suggestion TEXT;
-- Filed automatically by one of Jacob's rules, so it shows in "auto-filed" to review.
ALTER TABLE bank_lines ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
