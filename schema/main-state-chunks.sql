-- Apply after schema/schema.sql when provisioning a fresh database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS main_state_generations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staging', 'committed')),
  base_updated_at TEXT,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, generation_id),
  UNIQUE (user_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS main_state_chunks (
  user_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  section_name TEXT NOT NULL CHECK (section_name IN (
    'meta', 'goal', 'settings', 'subjects', 'materials', 'tasks', 'sessions',
    'planHistory', 'availability', 'dayPlans', 'fixedEvents'
  )),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  data_json TEXT NOT NULL CHECK (json_valid(data_json) AND json_type(data_json) = 'array'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, generation_id, section_name, chunk_index),
  FOREIGN KEY (user_id, generation_id)
    REFERENCES main_state_generations(user_id, generation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS main_state_heads (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  FOREIGN KEY (user_id, generation_id)
    REFERENCES main_state_generations(user_id, generation_id)
);

CREATE INDEX IF NOT EXISTS idx_main_state_generations_user_status_created
  ON main_state_generations(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_main_state_chunks_generation
  ON main_state_chunks(user_id, generation_id, section_name, chunk_index);
