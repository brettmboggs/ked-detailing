-- A private link per job, so the customer can see, move or cancel their
-- booking without calling. Existing jobs get one too.
ALTER TABLE jobs ADD COLUMN manage_token TEXT;
UPDATE jobs SET manage_token = lower(hex(randomblob(24))) WHERE manage_token IS NULL;
CREATE UNIQUE INDEX jobs_manage_token ON jobs (manage_token);
-- Why it was cancelled, and by whom ('customer' through the link, or Jacob).
ALTER TABLE jobs ADD COLUMN cancelled_by TEXT;
ALTER TABLE jobs ADD COLUMN cancel_reason TEXT;
