-- Persistent per-IP and per-username login throttling.
CREATE TABLE IF NOT EXISTS auth_login_limits (
  rate_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_limits_updated_at
  ON auth_login_limits(updated_at);
