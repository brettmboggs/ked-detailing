-- Visits per tracking link per day (Chicago date). The website pings once per
-- browser per link per day when someone lands on a tagged link, so this counts
-- scans and clicks, not just the people who later asked for a price. No names,
-- no IP addresses: a day and a number.
CREATE TABLE link_visits (
  link_id TEXT NOT NULL, -- tracked_links.id
  day     TEXT NOT NULL, -- YYYY-MM-DD, America/Chicago
  visits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
);

-- The QR card printed in September 2026 (docs/qr/kedservice-qr-card.png) points at
-- https://kedservice.com/?utm_source=qr&utm_medium=print with no campaign tag.
-- Saved as a link so its scans and the people it brings show up with the others.
INSERT OR IGNORE INTO tracked_links (id, name, channel, utm_source, utm_medium, utm_campaign, created_at, created_by)
VALUES ('01M3CKCEP8QRCARD0000000000', 'Website QR card', 'cards', 'qr', 'print', '', '2026-09-25T15:36:45.000Z', 'setup');
