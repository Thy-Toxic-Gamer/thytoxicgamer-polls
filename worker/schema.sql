PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'cancelled')),
  poll_style TEXT NOT NULL DEFAULT 'multiple',
  results_mode TEXT NOT NULL DEFAULT 'after_vote',
  reminder_interval_seconds INTEGER,
  next_reminder_at INTEGER
);

CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  tile_code TEXT,
  tile_variant INTEGER,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS votes (
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, voter_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  admin_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  exchanged_at INTEGER,
  session_token_hash TEXT UNIQUE,
  session_expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS poll_events (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'poll_opened',
      'poll_closed',
      'poll_cancelled',
      'poll_reminder'
    )
  ),
  event_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  UNIQUE (poll_id, event_key),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_access_token
  ON admin_sessions(access_token_hash);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_session_token
  ON admin_sessions(session_token_hash);

CREATE INDEX IF NOT EXISTS idx_poll_events_pending
  ON poll_events(acknowledged_at, created_at);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id
  ON poll_options(poll_id, position);

CREATE INDEX IF NOT EXISTS idx_polls_created_at
  ON polls(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_votes_option_id
  ON votes(option_id);
