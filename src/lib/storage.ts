import type { AppState, ValidationIssue } from '../types';
import {
  validateAppStatePayload,
  type AppStateValidationResult,
} from '../../functions/_shared/appState';
import {
  isAppStateShape as isLegacyAppStateShape,
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

function malformedShapeIssue(): ValidationIssue {
  return {
    targetId: 'appState',
    field: 'root',
    value: undefined,
    reason: '学習データの基本構造が正しくありません',
    suggestion: '正常なJSONバックアップから復元してください',
  };
}

/**
 * API・localStorage・IndexedDB・JSON importで同じ純粋validatorを使う。
 * migrationで修復可能な旧versionは最低形状だけ確認して移行し、
 * 現行stateへ正規化した後にAPIと同じ厳密validatorを適用する。
 */
export function migrateState(input: AppState): MigrationResult {
  if (!isLegacyAppStateShape(input)) {
    return { ok: false, state: input, errors: [malformedShapeIssue()] };
  }

  const migrated = migrateLegacyState(input);
  if (!migrated.ok) return migrated;

  const validation = validateAppStatePayload(migrated.state);
  if (!validation.ok) {
    return { ok: false, state: migrated.state, errors: [validationIssue(validation)] };
  }
  return migrated;
}

export function isAppStateShape(value: unknown): value is AppState {
  return isLegacyAppStateShape(value) && migrateState(value).ok;
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLegacyAppStateShape(parsed)) {
      localStorage.setItem(BACKUP_KEY, raw);
      console.error('保存データの基本構造が不正です');
      return null;
    }
    const migration = migrateState(parsed);
    if (!migration.ok) {
      localStorage.setItem(BACKUP_KEY, raw);
      console.error('一部の保存データに検証または移行エラーがあります', migration.errors);
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
  if (!isLegacyAppStateShape(parsed)) throw new Error('不正なデータ形式です: 学習データの基本構造が正しくありません');
  const migration = migrateState(parsed);
  if (!migration.ok) {
    throw new Error(`移行できない項目があります: ${migration.errors.map((error) => `${error.targetId}.${error.field}: ${error.reason}`).join(', ')}`);
  }
  return migration.state;
}
