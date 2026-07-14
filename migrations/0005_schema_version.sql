-- Runtime/deploy compatibility marker. Bump this value in the same migration
-- whenever Pages Functions begin requiring a newer D1 schema.
CREATE TABLE IF NOT EXISTS app_schema_version (
  component TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  applied_at TEXT NOT NULL
);

INSERT INTO app_schema_version (component, version, applied_at)
VALUES ('studycommander', 5, datetime('now'))
ON CONFLICT(component) DO UPDATE SET
  version = excluded.version,
  applied_at = excluded.applied_at;
