import type { Env } from '../_shared/env';
import { json } from '../_shared/http';
import { readD1SchemaCompatibility } from '../_shared/schemaVersion';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const status = await readD1SchemaCompatibility(env);
    if (status.compatible) return json(status);
    return json({
      ...status,
      error: 'D1 migrationが不足しています。npm run d1:migrate を実行してから再デプロイしてください',
      code: 'D1_SCHEMA_OUTDATED',
    }, { status: 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({
      compatible: false,
      requiredVersion: null,
      currentVersion: null,
      missingMigrations: [],
      error: `D1 schema versionを確認できません: ${message}`,
      code: 'D1_SCHEMA_CHECK_FAILED',
    }, { status: 503 });
  }
};
