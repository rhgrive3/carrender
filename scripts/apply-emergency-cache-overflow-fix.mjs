import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const storagePath = 'src/lib/storage.ts';
let storage = readFileSync(storagePath, 'utf8');

const constantsNeedle = "const UPDATED_KEY = 'studycommander_state_updated_at_v1';\n";
const constantsReplacement = `${constantsNeedle}\n/**\n * localStorage is only a synchronous emergency cache. Keep well below the\n * implementation-defined browser quota so normal app data never competes with\n * auth/sync metadata and stale snapshots cannot survive a failed replacement.\n */\nexport const EMERGENCY_CACHE_MAX_CHARS = 1_800_000;\nlet emergencyCacheSuppressed = false;\n`;
if (!storage.includes(constantsNeedle)) throw new Error('storage constants anchor not found');
storage = storage.replace(constantsNeedle, constantsReplacement);

const saveNeedle = `function saveSerialized(state: AppState): void {\n  localStorage.setItem(KEY, JSON.stringify(state));\n  localStorage.setItem(UPDATED_KEY, new Date().toISOString());\n  publishStateSaveFailure(null);\n}\n\nfunction reportStateSaveFailure(error: unknown): void {\n  console.error('保存に失敗しました', error);\n  const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');\n  publishStateSaveFailure({\n    message: quota\n      ? '端末保存容量を超えました。ページを閉じる前にJSONを書き出してください'\n      : '端末への保存に失敗しました。ページを閉じる前に同期またはJSON書き出しを確認してください',\n    at: new Date().toISOString(),\n  });\n}\n`;

const saveReplacement = `function isStorageQuotaError(error: unknown): boolean {\n  return error instanceof DOMException\n    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');\n}\n\nfunction clearEmergencyCache(): void {\n  try {\n    localStorage.removeItem(KEY);\n    localStorage.removeItem(UPDATED_KEY);\n  } catch {\n    // The cache is optional. IndexedDB and cloud persistence remain authoritative.\n  }\n}\n\nfunction suppressEmergencyCache(reason: string): void {\n  emergencyCacheSuppressed = true;\n  clearEmergencyCache();\n  publishStateSaveFailure(null);\n  console.info(reason);\n}\n\nfunction saveSerialized(state: AppState): void {\n  if (emergencyCacheSuppressed) return;\n\n  const serialized = JSON.stringify(state);\n  if (serialized.length > EMERGENCY_CACHE_MAX_CHARS) {\n    suppressEmergencyCache('AppStateが緊急localStorageキャッシュの安全上限を超えたため、IndexedDB保存のみ継続します');\n    return;\n  }\n\n  try {\n    localStorage.setItem(KEY, serialized);\n    localStorage.setItem(UPDATED_KEY, new Date().toISOString());\n    publishStateSaveFailure(null);\n  } catch (error) {\n    if (isStorageQuotaError(error)) {\n      suppressEmergencyCache('ブラウザのlocalStorage上限へ達したため、緊急キャッシュを解除してIndexedDB保存のみ継続します');\n      return;\n    }\n    throw error;\n  }\n}\n\nfunction reportStateSaveFailure(error: unknown): void {\n  console.error('保存に失敗しました', error);\n  publishStateSaveFailure({\n    message: '端末への保存に失敗しました。ページを閉じる前に同期またはJSON書き出しを確認してください',\n    at: new Date().toISOString(),\n  });\n}\n`;
if (!storage.includes(saveNeedle)) throw new Error('storage save block anchor not found');
storage = storage.replace(saveNeedle, saveReplacement);

const clearNeedle = `export function clearOwnedState(): void {\n  if (saveTimer) clearTimeout(saveTimer);\n  saveTimer = null;\n`;
const clearReplacement = `export function clearOwnedState(): void {\n  if (saveTimer) clearTimeout(saveTimer);\n  saveTimer = null;\n  emergencyCacheSuppressed = false;\n  publishStateSaveFailure(null);\n`;
if (!storage.includes(clearNeedle)) throw new Error('clearOwnedState anchor not found');
storage = storage.replace(clearNeedle, clearReplacement);
writeFileSync(storagePath, storage);

const testPath = 'scripts/emergency-cache-overflow.test.ts';
writeFileSync(testPath, `import assert from 'node:assert/strict';\nimport type { AppState } from '../src/types';\nimport {\n  EMERGENCY_CACHE_MAX_CHARS,\n  clearOwnedState,\n  saveStateNow,\n  subscribeStateSaveFailure,\n} from '../src/lib/storage';\n\nconst STATE_KEY = 'studycommander_state_v1';\nconst UPDATED_KEY = 'studycommander_state_updated_at_v1';\n\nclass ControlledStorage {\n  readonly values = new Map<string, string>();\n  setCalls = 0;\n  failure: Error | DOMException | null = null;\n\n  getItem(key: string): string | null { return this.values.get(key) ?? null; }\n  removeItem(key: string): void { this.values.delete(key); }\n  setItem(key: string, value: string): void {\n    this.setCalls += 1;\n    if (this.failure) throw this.failure;\n    this.values.set(key, value);\n  }\n}\n\nconst storage = new ControlledStorage();\nObject.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });\n\nlet latestFailure: string | null = null;\nconst unsubscribe = subscribeStateSaveFailure((failure) => { latestFailure = failure?.message ?? null; });\n\nstorage.values.set(STATE_KEY, 'stale-emergency-copy');\nstorage.values.set(UPDATED_KEY, '2026-07-16T00:00:00.000Z');\nconst oversized = { payload: 'x'.repeat(EMERGENCY_CACHE_MAX_CHARS + 1) } as unknown as AppState;\nsaveStateNow(oversized);\nassert.equal(storage.getItem(STATE_KEY), null, 'oversized state removes the stale emergency snapshot');\nassert.equal(storage.getItem(UPDATED_KEY), null, 'oversized state removes the stale emergency timestamp');\nassert.equal(latestFailure, null, 'oversized optional cache is not surfaced as a user-facing save failure');\nconst callsAfterOversized = storage.setCalls;\nsaveStateNow({ payload: 'small' } as unknown as AppState);\nassert.equal(storage.setCalls, callsAfterOversized, 'suppressed emergency cache does not retry on every state change');\n\nclearOwnedState();\nstorage.values.set(STATE_KEY, 'older-copy');\nstorage.failure = new DOMException('quota reached', 'QuotaExceededError');\nsaveStateNow({ payload: 'small' } as unknown as AppState);\nassert.equal(storage.getItem(STATE_KEY), null, 'quota failure removes the older snapshot instead of leaving rollback data');\nassert.equal(latestFailure, null, 'quota failure degrades to IndexedDB without duplicate warning UI');\n\nclearOwnedState();\nstorage.failure = new Error('storage blocked');\nsaveStateNow({ payload: 'small' } as unknown as AppState);\nassert.match(latestFailure ?? '', /端末への保存に失敗/, 'non-quota storage failures remain visible');\n\nunsubscribe();\nconsole.log('✅ emergency cache overflow regressions passed');\n`);

const packagePath = 'package.json';
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const marker = 'vite-node scripts/local-settings-recovery.test.ts';
if (!pkg.scripts['test:regressions'].includes(marker)) throw new Error('package regression anchor not found');
pkg.scripts['test:regressions'] = pkg.scripts['test:regressions'].replace(
  marker,
  `${marker} && vite-node scripts/emergency-cache-overflow.test.ts`,
);
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

rmSync('scripts/apply-emergency-cache-overflow-fix.mjs');
rmSync('.github/workflows/apply-emergency-cache-overflow-fix.yml');
