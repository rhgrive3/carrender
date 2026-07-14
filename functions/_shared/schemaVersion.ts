import type { Env } from './env';

export const D1_SCHEMA_COMPONENT = 'studycommander';
export const REQUIRED_D1_SCHEMA_VERSION = 5;

export interface D1SchemaCompatibility {
  compatible: boolean;
  requiredVersion: number;
  currentVersion: number | null;
  missingMigrations: number[];
  reason?: 'versionTableMissing' | 'versionRowMissing' | 'outdated';
}

function missingVersions(currentVersion: number | null): number[] {
  const start = Math.max(1, (currentVersion ?? 0) + 1);
  return Array.from(
    { length: Math.max(0, REQUIRED_D1_SCHEMA_VERSION - start + 1) },
    (_, index) => start + index,
  );
}

export async function readD1SchemaCompatibility(env: Env): Promise<D1SchemaCompatibility> {
  let row: { version: number } | null;
  try {
    row = await env.DB.prepare(
      'SELECT version FROM app_schema_version WHERE component = ?',
    ).bind(D1_SCHEMA_COMPONENT).first<{ version: number }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*app_schema_version/i.test(message)) {
      return {
        compatible: false,
        requiredVersion: REQUIRED_D1_SCHEMA_VERSION,
        currentVersion: null,
        missingMigrations: missingVersions(null),
        reason: 'versionTableMissing',
      };
    }
    throw error;
  }

  if (!row || !Number.isInteger(row.version)) {
    return {
      compatible: false,
      requiredVersion: REQUIRED_D1_SCHEMA_VERSION,
      currentVersion: null,
      missingMigrations: missingVersions(null),
      reason: 'versionRowMissing',
    };
  }

  const currentVersion = row.version;
  if (currentVersion < REQUIRED_D1_SCHEMA_VERSION) {
    return {
      compatible: false,
      requiredVersion: REQUIRED_D1_SCHEMA_VERSION,
      currentVersion,
      missingMigrations: missingVersions(currentVersion),
      reason: 'outdated',
    };
  }

  return {
    compatible: true,
    requiredVersion: REQUIRED_D1_SCHEMA_VERSION,
    currentVersion,
    missingMigrations: [],
  };
}
