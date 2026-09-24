-- Cutover imports from Housecall Pro and QuickBooks (tools/import). Each
-- imported row remembers where it came from, so running an import twice adds
-- nothing twice.

-- 'hcp:<job number>'. NULL for jobs made here.
ALTER TABLE jobs ADD COLUMN imported_from TEXT;
CREATE UNIQUE INDEX jobs_imported_from ON jobs (imported_from) WHERE imported_from IS NOT NULL;
-- Past work brought over for the customer's history. Paid and driven long
-- ago, so it never asks for a payment or a mileage entry.
ALTER TABLE jobs ADD COLUMN history INTEGER NOT NULL DEFAULT 0;

-- 'qb:<hash>' for a QuickBooks transaction.
ALTER TABLE entries ADD COLUMN import_ref TEXT;
CREATE UNIQUE INDEX entries_import_ref ON entries (import_ref) WHERE import_ref IS NOT NULL;
