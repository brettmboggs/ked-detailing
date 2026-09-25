-- Follow-ups part 2 (docs/crm.md): automatic email. A follow-up the daily
-- rules decide to email carries its subject and an email_state:
--   queued   waiting for the next send (the same run, normally)
--   sending  claimed by a run; never picked up again, so nothing goes twice
--   sent     Resend took it (the follow-up's status is 'sent' too)
--   failed   Resend refused it, or they had no email or unsubscribed: it
--            stays open for Jacob as a text, with the reason in email_note
-- NULL email_state means it's Jacob's to do by hand (text, call or email).
ALTER TABLE follow_ups ADD COLUMN subject TEXT;
ALTER TABLE follow_ups ADD COLUMN email_state TEXT CHECK (email_state IN ('queued', 'sending', 'sent', 'failed'));
ALTER TABLE follow_ups ADD COLUMN email_note TEXT;
ALTER TABLE follow_ups ADD COLUMN sent_at TEXT;
CREATE INDEX follow_ups_email ON follow_ups (email_state, due_date) WHERE email_state IS NOT NULL;
CREATE INDEX follow_ups_sent ON follow_ups (sent_at) WHERE sent_at IS NOT NULL;
