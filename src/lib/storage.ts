import type { AppState, ValidationIssue } from '../types';
import {
  validateAppStatePayload,
  type AppStateValidationResult,
} from '../../functions/_shared/appState';
import {
  migrateState as migrateLegacyState,
  type MigrationResult,
} from './storageLegacy';

export * from './storageLegacy';

const KEY = 'studycommander_state_v1';
const BACKUP_KEY = 'studycommander_state_migration_backup';

function validationIssue(result: AppStateValidationResult): ValidationIssue {
  const reason = result.error ?? '学習データの形式が正しくありません';
  const field = /^([A-Za-z][A-Za-z0-9_.]*)/u.exec(reason)?.[1] ?? 'root';
  return {
    targetId: 'appState',
    field,
    value: undefined,
    reason,
    suggestion: '破損した項目を修正するか、正常なバックアップから復元してください',
  };
}

function validationMessage(result: AppStateValidationResult): string {
  return result.error ? `不正なデータ形式です: ${result.error}` : '不正なデータ形式です';
}

/**
 * API・localStorage・IndexedDB・JSON importで同じ純粋validatorを使う。
 * 旧versionは移行前にlegacy互換条件で検証し、移行後は現行条件でもう一度検証する。
 */
export function migrateState(input: AppState): MigrationResult {
  const beforeMigration = validateAppStatePayload(input, { allowLegacyGoalDateOverflow: true });
  if (!beforeMigration.ok) {
    return { ok: false, state: input, errors: [validationIssue(beforeMigration)] };
  }

  const migrated = migrateLegacyState(input);
  if (!migrated.ok) return migrated;

  const afterMigration = validateAppStatePayload(migrated.state);
  if (!afterMigration.ok) {
    return { ok: false, state: migrated.state, errors: [validationIssue(afterMigration)] };
  }
  return migrated;
}

export function isAppStateShape(value: unknown): value is AppState {
  return validateAppStatePayload(value, { allowLegacyGoalDateOverflow: true }).ok;
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const validation = validateAppStatePayload(parsed, { allowLegacyGoalDateOverflow: true });
    if (!validation.ok) {
      localStorage.setItem(BACKUP_KEY, raw);
      console.error('保存データの形式が不正です', validation.error);
      return null;
    }
    const migration = migrateState(parsed as AppState);
    if (!migration.ok) {
      localStorage.setItem(BACKUP_KEY, raw);
      console.error('一部の保存データに移行エラーがあります', migration.errors);
      return null;
    }
    return migration.state;
  } catch (error) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
    } catch {
      // 緊急cacheを読めない場合もIndexedDB・cloud復元は継続する。
    }
    console.error('保存データの検証または移行に失敗しました', error);
    return null;
  }
}

export function importJSON(json: string): AppState {
  const parsed: unknown = JSON.parse(json);
  const validation = validateAppStatePayload(parsed, { allowLegacyGoalDateOverflow: true });
  if (!validation.ok) throw new Error(validationMessage(validation));
  const migration = migrateState(parsed as AppState);
  if (!migration.ok) {
    throw new Error(`移行できない項目があります: ${migration.errors.map((error) => `${error.targetId}.${error.field}: ${error.reason}`).join(', ')}`);
  }
  return migration.state;
}
