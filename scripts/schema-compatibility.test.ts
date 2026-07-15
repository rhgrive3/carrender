import assert from 'node:assert/strict';
import type { Env } from '../functions/_shared/env';
import {
  readD1SchemaCompatibility,
  REQUIRED_D1_SCHEMA_VERSION,
} from '../functions/_shared/schemaVersion';
import { onRequestGet as getSchemaStatus } from '../functions/api/schema';
import { checkSchemaCompatibility } from '../src/lib/schemaCompatibility';

function fakeEnv(input: { row?: { version: number } | null; error?: Error }): Env {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            if (input.error) throw input.error;
            return input.row ?? null;
          },
        }),
      }),
    },
  } as unknown as Env;
}

{
  const result = await readD1SchemaCompatibility(fakeEnv({ error: new Error('D1_ERROR: no such table: app_schema_version') }));
  assert.equal(result.compatible, false);
  assert.equal(result.reason, 'versionTableMissing');
  assert.equal(result.currentVersion, null);
  assert.ok(result.missingMigrations.includes(REQUIRED_D1_SCHEMA_VERSION));
}

{
  const result = await readD1SchemaCompatibility(fakeEnv({ row: { version: REQUIRED_D1_SCHEMA_VERSION - 1 } }));
  assert.equal(result.compatible, false);
  assert.equal(result.reason, 'outdated');
  assert.deepEqual(result.missingMigrations, [REQUIRED_D1_SCHEMA_VERSION]);
}

{
  const result = await readD1SchemaCompatibility(fakeEnv({ row: { version: REQUIRED_D1_SCHEMA_VERSION } }));
  assert.equal(result.compatible, true);
  assert.equal(result.currentVersion, REQUIRED_D1_SCHEMA_VERSION);
  assert.deepEqual(result.missingMigrations, []);
}

{
  const fetcher = async () => new Response(JSON.stringify({
    compatible: true,
    requiredVersion: REQUIRED_D1_SCHEMA_VERSION,
    currentVersion: REQUIRED_D1_SCHEMA_VERSION,
    missingMigrations: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await checkSchemaCompatibility(fetcher as typeof fetch);
  assert.equal(result.status, 'compatible');
}

{
  const fetcher = async () => new Response(JSON.stringify({
    compatible: false,
    requiredVersion: REQUIRED_D1_SCHEMA_VERSION,
    currentVersion: REQUIRED_D1_SCHEMA_VERSION - 1,
    missingMigrations: [REQUIRED_D1_SCHEMA_VERSION],
    code: 'D1_SCHEMA_OUTDATED',
  }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const result = await checkSchemaCompatibility(fetcher as typeof fetch);
  assert.equal(result.status, 'incompatible');
  if (result.status === 'incompatible') {
    assert.deepEqual(result.response.missingMigrations, [REQUIRED_D1_SCHEMA_VERSION]);
  }
}

{
  const fetcher = async () => new Response(JSON.stringify({
    compatible: false,
    requiredVersion: null,
    currentVersion: null,
    missingMigrations: [],
    error: 'D1 schema versionを確認できません: transient database error',
    code: 'D1_SCHEMA_CHECK_FAILED',
  }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const result = await checkSchemaCompatibility(fetcher as typeof fetch);
  assert.equal(result.status, 'unavailable', '一時的なD1確認失敗ではPWA起動を停止しない');
}

{
  const fetcher = async () => { throw new TypeError('offline'); };
  const result = await checkSchemaCompatibility(fetcher as typeof fetch);
  assert.equal(result.status, 'unavailable', 'ネットワーク不通はPWAのオフライン起動を妨げない');
}

{
  const response = await getSchemaStatus({
    env: fakeEnv({ error: new Error('D1_INTERNAL: account=private-account internal_detail=not-for-client') }),
  } as Parameters<typeof getSchemaStatus>[0]);
  const body = await response.json() as { error?: string; code?: string };
  assert.equal(response.status, 503);
  assert.equal(body.code, 'D1_SCHEMA_CHECK_FAILED');
  assert.equal(body.error, 'D1 schema versionを確認できません。時間をおいて再試行してください');
  assert.doesNotMatch(JSON.stringify(body), /private-account|not-for-client|D1_INTERNAL/,
    'D1の内部エラーや識別情報を利用者向け応答へ含めない');
}

console.log('✅ schema compatibility regressions passed');
