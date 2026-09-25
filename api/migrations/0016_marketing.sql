-- Marketing (docs/crm.md, part 4): tracking links for each place Jacob
-- advertises, and what campaigns need to send in small batches.
-- Settings (referral rewards, review link, playbook ticks) live in
-- settings under the key 'marketing'.

-- A link for one place he advertises (van magnet, door hangers, Instagram
-- bio...). The site records utm_source / utm_campaign on the first visit, so
-- leads and customers are matched to a link by those two (lowercase).
CREATE TABLE tracked_links (
  id           TEXT PRIMARY KEY, -- ULID
  name         TEXT NOT NULL,
  channel      TEXT NOT NULL, -- which preset it came from, e.g. 'van', 'door-hangers', 'other'
  utm_source   TEXT NOT NULL,
  utm_medium   TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL
);
CREATE UNIQUE INDEX tracked_links_utm ON tracked_links (utm_source, utm_campaign);

-- Which ready-made template a campaign started from, if any.
ALTER TABLE campaigns ADD COLUMN template TEXT;

-- Sending works through the queue a batch at a time.
CREATE INDEX campaign_sends_status ON campaign_sends (campaign_id, status);
CREATE INDEX campaign_sends_customer ON campaign_sends (customer_id);
-- Today's email count (Resend's free plan allows 100 a day), and review asks.
CREATE INDEX IF NOT EXISTS activities_kind_created ON activities (kind, created_at);
