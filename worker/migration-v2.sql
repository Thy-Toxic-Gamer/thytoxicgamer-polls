-- Run this file exactly once only when upgrading a version 1 Poll database.
-- Do not run it on a database already using the version 2 schema.

PRAGMA foreign_keys = ON;

ALTER TABLE polls
  ADD COLUMN poll_style TEXT NOT NULL DEFAULT 'multiple';

ALTER TABLE polls
  ADD COLUMN results_mode TEXT NOT NULL DEFAULT 'after_vote';

ALTER TABLE poll_options
  ADD COLUMN tile_code TEXT;

ALTER TABLE poll_options
  ADD COLUMN tile_variant INTEGER;

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
