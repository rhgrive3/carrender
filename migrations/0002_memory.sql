-- Local-first memory feature. Content rows are tombstoned, attempts and voids are append-only,
-- and every relation carries user_id so ownership is enforced by composite foreign keys.

CREATE TABLE IF NOT EXISTS memory_sets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('word', 'phrase', 'expression', 'construction', 'composition')),
  label TEXT NOT NULL,
  lemma TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'import', 'ai')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified_ai')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_senses (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  prompt_ja TEXT NOT NULL,
  meaning_ja TEXT NOT NULL,
  sibling_group_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'import', 'ai')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified_ai')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, item_id, id),
  FOREIGN KEY (user_id, item_id) REFERENCES memory_items(user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_answers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  display_form TEXT NOT NULL,
  citation_form TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'import', 'ai')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified_ai')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, sense_id, id),
  FOREIGN KEY (user_id, sense_id) REFERENCES memory_senses(user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_examples (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  answer_id TEXT,
  english TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'import', 'ai')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified_ai')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, sense_id) REFERENCES memory_senses(user_id, id),
  FOREIGN KEY (user_id, sense_id, answer_id) REFERENCES memory_answers(user_id, sense_id, id)
);

CREATE TABLE IF NOT EXISTS memory_exercises (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  answer_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('flashcard', 'typed_output', 'fill_blank', 'reorder', 'multiple_choice', 'guided_composition', 'free_composition')),
  prompt TEXT NOT NULL,
  sibling_group_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'import', 'ai')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified_ai')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, sense_id, id),
  FOREIGN KEY (user_id, sense_id) REFERENCES memory_senses(user_id, id),
  FOREIGN KEY (user_id, sense_id, answer_id) REFERENCES memory_answers(user_id, sense_id, id)
);

CREATE TABLE IF NOT EXISTS memory_set_members (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, set_id, item_id),
  FOREIGN KEY (user_id, set_id) REFERENCES memory_sets(user_id, id),
  FOREIGN KEY (user_id, item_id) REFERENCES memory_items(user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_attempts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  answer_id TEXT,
  exercise_id TEXT,
  target_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('input', 'output', 'context', 'composition')),
  exercise_type TEXT NOT NULL CHECK (exercise_type IN ('flashcard', 'typed_output', 'fill_blank', 'reorder', 'multiple_choice', 'guided_composition', 'free_composition')),
  user_answer TEXT,
  normalized_answer TEXT,
  assessment TEXT NOT NULL CHECK (assessment IN ('correct', 'partial', 'incorrect', 'skipped')),
  error_types_json TEXT NOT NULL CHECK (json_valid(error_types_json)),
  hint_used INTEGER NOT NULL CHECK (hint_used IN (0, 1)),
  response_ms INTEGER NOT NULL CHECK (response_ms >= 0),
  created_at TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, attempt_id),
  FOREIGN KEY (user_id, session_id) REFERENCES memory_sessions(user_id, id),
  FOREIGN KEY (user_id, item_id) REFERENCES memory_items(user_id, id),
  FOREIGN KEY (user_id, item_id, sense_id) REFERENCES memory_senses(user_id, item_id, id),
  FOREIGN KEY (user_id, sense_id, answer_id) REFERENCES memory_answers(user_id, sense_id, id),
  FOREIGN KEY (user_id, sense_id, exercise_id) REFERENCES memory_exercises(user_id, sense_id, id)
);

CREATE TABLE IF NOT EXISTS memory_attempt_voids (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  void_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  PRIMARY KEY (user_id, void_id),
  UNIQUE (user_id, attempt_id),
  FOREIGN KEY (user_id, attempt_id) REFERENCES memory_attempts(user_id, attempt_id),
  FOREIGN KEY (user_id, session_id) REFERENCES memory_sessions(user_id, id)
);

CREATE TABLE IF NOT EXISTS memory_stats (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('sense', 'answer', 'exercise')),
  target_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('input', 'output', 'context', 'composition')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  partial_count INTEGER NOT NULL DEFAULT 0 CHECK (partial_count >= 0),
  incorrect_count INTEGER NOT NULL DEFAULT 0 CHECK (incorrect_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  consecutive_correct INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_correct >= 0),
  consecutive_incorrect INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_incorrect >= 0),
  average_response_ms INTEGER NOT NULL DEFAULT 0 CHECK (average_response_ms >= 0),
  hint_count INTEGER NOT NULL DEFAULT 0 CHECK (hint_count >= 0),
  manual_weak INTEGER NOT NULL DEFAULT 0 CHECK (manual_weak IN (0, 1)),
  weakness_score REAL NOT NULL DEFAULT 0 CHECK (weakness_score >= 0 AND weakness_score <= 100),
  last_attempt_at TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  last_mutation_id TEXT,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, target_type, target_id, mode)
);

CREATE TABLE IF NOT EXISTS memory_sync_conflicts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conflict_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  base_revision INTEGER,
  local_record_json TEXT NOT NULL CHECK (json_valid(local_record_json)),
  server_record_json TEXT CHECK (server_record_json IS NULL OR json_valid(server_record_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('local', 'server', 'merged')),
  PRIMARY KEY (user_id, conflict_id),
  UNIQUE (user_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS memory_mutations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'conflict')),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS memory_sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_name TEXT NOT NULL CHECK (collection_name IN ('sets', 'setMembers', 'items', 'senses', 'answers', 'examples', 'exercises', 'attempts', 'stats', 'sessions')),
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  changed_at TEXT NOT NULL,
  UNIQUE (user_id, entity_type, entity_key, revision)
);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_updated ON memory_items(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_memory_senses_user_item ON memory_senses(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_memory_answers_user_sense ON memory_answers(user_id, sense_id);
CREATE INDEX IF NOT EXISTS idx_memory_examples_user_sense ON memory_examples(user_id, sense_id);
CREATE INDEX IF NOT EXISTS idx_memory_exercises_user_sense ON memory_exercises(user_id, sense_id);
CREATE INDEX IF NOT EXISTS idx_memory_set_members_user_set ON memory_set_members(user_id, set_id);
CREATE INDEX IF NOT EXISTS idx_memory_set_members_user_item ON memory_set_members(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_memory_attempts_user_created ON memory_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_attempts_user_session ON memory_attempts(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_memory_attempts_user_sense_mode ON memory_attempts(user_id, sense_id, mode, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_attempts_user_answer_mode ON memory_attempts(user_id, answer_id, mode, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_attempts_user_exercise_mode ON memory_attempts(user_id, exercise_id, mode, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_stats_user_weakness ON memory_stats(user_id, weakness_score);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_user_status_updated ON memory_sessions(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_memory_conflicts_user_unresolved ON memory_sync_conflicts(user_id, resolved_at, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_mutations_user_created ON memory_mutations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_changes_user_seq ON memory_sync_changes(user_id, seq);
