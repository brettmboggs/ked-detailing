-- Who is using the app and the web admin, and how much the website is seen.

-- Owners only: each app open (or return to it) and each screen, from the
-- iPhone app and the web admin. Throttled, so a screen counts once per
-- 10 minutes. Kept 180 days.
CREATE TABLE usage_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  who     TEXT NOT NULL,                                    -- owner email (or Apple sub)
  client  TEXT NOT NULL CHECK (client IN ('app', 'admin')),
  kind    TEXT NOT NULL CHECK (kind IN ('open', 'screen')),
  path    TEXT,
  version TEXT
);
CREATE INDEX usage_events_at ON usage_events (at);
CREATE INDEX usage_events_who ON usage_events (who, at);

-- The public website: page views per day and page, nothing about the visitor.
-- `owner` is 1 for views from a browser signed into the web admin, so Jacob
-- checking his own site doesn't read as customer traffic.
CREATE TABLE site_views (
  day   TEXT NOT NULL,
  path  TEXT NOT NULL,
  owner INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, owner)
);
