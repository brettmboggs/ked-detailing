-- One-time sign-in links for the web admin (kedservice.com/admin), emailed to
-- an owner address. Only a hash of the token is kept, like sessions.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX login_links_email ON login_links (email, created_at);
