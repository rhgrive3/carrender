export interface SchemaCompatibilityResponse {
  compatible: boolean;
  requiredVersion: number | null;
  currentVersion: number | null;
  missingMigrations: number[];
  error?: string;
  code?: string;
}

export type SchemaCompatibilityCheck =
  | { status: 'compatible'; response: SchemaCompatibilityResponse }
  | { status: 'incompatible'; response: SchemaCompatibilityResponse }
  | { status: 'unavailable'; error: string };

function normalizeResponse(value: unknown): SchemaCompatibilityResponse | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.compatible !== 'boolean') return null;
  const requiredVersion = record.requiredVersion === null || Number.isInteger(record.requiredVersion)
    ? record.requiredVersion as number | null
    : null;
  const currentVersion = record.currentVersion === null || Number.isInteger(record.currentVersion)
    ? record.currentVersion as number | null
    : null;
  const missingMigrations = Array.isArray(record.missingMigrations)
    ? record.missingMigrations.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
  return {
    compatible: record.compatible,
    requiredVersion,
    currentVersion,
    missingMigrations,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
  };
}

export async function checkSchemaCompatibility(
  fetcher: typeof fetch = fetch,
  timeoutMs = 6_000,
): Promise<SchemaCompatibilityCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/schema', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const body = normalizeResponse(await response.json().catch(() => null));
    if (!body) return { status: 'unavailable', error: `schema check returned ${response.status}` };
    if (response.ok && body.compatible) return { status: 'compatible', response: body };
    if (body.code === 'D1_SCHEMA_OUTDATED' || !body.compatible) {
      return { status: 'incompatible', response: body };
    }
    return { status: 'unavailable', error: body.error ?? `schema check returned ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unavailable', error: message };
  } finally {
    clearTimeout(timeout);
  }
}
