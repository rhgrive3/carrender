import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const storagePath = 'src/lib/storage.ts';
let storage = readFileSync(storagePath, 'utf8');
const cacheNeedle = `function clearEmergencyCache(): void {\n  try {\n    localStorage.removeItem(KEY);\n    localStorage.removeItem(UPDATED_KEY);\n  } catch {\n    // The cache is optional. IndexedDB and cloud persistence remain authoritative.\n  }\n}\n`;
const cacheReplacement = `export function getStateUpdatedAt(): string | null {\n  try {\n    return localStorage.getItem(UPDATED_KEY);\n  } catch {\n    return null;\n  }\n}\n\nexport function clearEmergencyStateCache(): void {\n  try {\n    localStorage.removeItem(KEY);\n    localStorage.removeItem(UPDATED_KEY);\n  } catch {\n    // The cache is optional. IndexedDB and cloud persistence remain authoritative.\n  }\n}\n`;
if (!storage.includes(cacheNeedle)) throw new Error('emergency cache helper anchor not found');
storage = storage.replace(cacheNeedle, cacheReplacement).replaceAll('clearEmergencyCache();', 'clearEmergencyStateCache();');
writeFileSync(storagePath, storage);

const dbPath = 'src/lib/appStateIndexedDb.ts';
let db = readFileSync(dbPath, 'utf8');
const dbNeedle = `    return migration.state;\n  }\n\n  async loadSyncMetadata(): Promise<MainSyncMetadata | null> {\n`;
const dbReplacement = `    return migration.state;\n  }\n\n  async loadStateSavedAt(): Promise<string | null> {\n    await this.writeChain.catch(() => undefined);\n    const database = await this.database();\n    const transaction = database.transaction(MAIN_STATE_STORES.meta, 'readonly');\n    const meta = await requestResult(transaction.objectStore(MAIN_STATE_STORES.meta).get('state')) as StateMetaRecord | undefined;\n    await transactionComplete(transaction);\n    return meta?.savedAt ?? null;\n  }\n\n  async loadSyncMetadata(): Promise<MainSyncMetadata | null> {\n`;
if (!db.includes(dbNeedle)) throw new Error('IndexedDB savedAt anchor not found');
db = db.replace(dbNeedle, dbReplacement);
writeFileSync(dbPath, db);

const persistencePath = 'src/state/MainStatePersistence.tsx';
let persistence = readFileSync(persistencePath, 'utf8');
const importNeedle = `import { getStateOwner, loadState, migrateState, saveStateNow, setStateOwner } from '../lib/storage';`;
const importReplacement = `import {\n  clearEmergencyStateCache,\n  getStateOwner,\n  getStateUpdatedAt,\n  loadState,\n  migrateState,\n  saveStateNow,\n  setStateOwner,\n} from '../lib/storage';`;
if (!persistence.includes(importNeedle)) throw new Error('persistence storage import anchor not found');
persistence = persistence.replace(importNeedle, importReplacement);

const helperNeedle = `export function canonicalizeLocalSettings(input: AppState['settings']): AppState['settings'] {\n  return canonicalizeSettingsWithHistory(input) ?? canonicalizeCloudSettings(input);\n}\n`;
const helperReplacement = `${helperNeedle}\nexport function shouldUseEmergencyStateCache(\n  localUpdatedAt: string | null,\n  indexedDbUpdatedAt: string | null,\n  hasIndexedDbState: boolean,\n): boolean {\n  if (!hasIndexedDbState) return true;\n  if (!localUpdatedAt) return false;\n  if (!indexedDbUpdatedAt) return true;\n  const localTime = Date.parse(localUpdatedAt);\n  const indexedDbTime = Date.parse(indexedDbUpdatedAt);\n  if (!Number.isFinite(localTime)) return false;\n  if (!Number.isFinite(indexedDbTime)) return true;\n  return localTime >= indexedDbTime;\n}\n`;
if (!persistence.includes(helperNeedle)) throw new Error('freshness helper anchor not found');
persistence = persistence.replace(helperNeedle, helperReplacement);

const promiseNeedle = `        const [storedState, storedSyncMetadata] = await Promise.all([\n          repository.loadState(),\n          repository.loadSyncMetadata(),\n        ]);`;
const promiseReplacement = `        const [storedState, storedSyncMetadata, storedStateSavedAt] = await Promise.all([\n          repository.loadState(),\n          repository.loadSyncMetadata(),\n          repository.loadStateSavedAt(),\n        ]);`;
if (!persistence.includes(promiseNeedle)) throw new Error('bootstrap Promise.all anchor not found');
persistence = persistence.replace(promiseNeedle, promiseReplacement);

const localNeedle = `        const cachedOwner = getStateOwner();\n        const localState = cachedOwner === null || cachedOwner === owner ? loadState() : null;\n        if (localState) {`;
const localReplacement = `        const cachedOwner = getStateOwner();\n        const cacheBelongsToOwner = cachedOwner === null || cachedOwner === owner;\n        const useEmergencyCache = cacheBelongsToOwner && shouldUseEmergencyStateCache(\n          getStateUpdatedAt(),\n          storedStateSavedAt,\n          Boolean(storedState),\n        );\n        if (cacheBelongsToOwner && !useEmergencyCache) clearEmergencyStateCache();\n        const localState = useEmergencyCache ? loadState() : null;\n        if (localState) {`;
if (!persistence.includes(localNeedle)) throw new Error('bootstrap local cache anchor not found');
persistence = persistence.replace(localNeedle, localReplacement);
writeFileSync(persistencePath, persistence);

const testPath = 'scripts/emergency-cache-overflow.test.ts';
let test = readFileSync(testPath, 'utf8');
const testImportNeedle = `import type { AppState } from '../src/types';\n`;
const testImportReplacement = `${testImportNeedle}import { shouldUseEmergencyStateCache } from '../src/state/MainStatePersistence';\n`;
if (!test.includes(testImportNeedle)) throw new Error('test import anchor not found');
test = test.replace(testImportNeedle, testImportReplacement);
const assertionsNeedle = `const storage = new ControlledStorage();\n`;
const assertionsReplacement = `assert.equal(shouldUseEmergencyStateCache(null, '2026-07-16T08:00:00.000Z', true), false, 'undated legacy cache never overwrites IndexedDB');\nassert.equal(shouldUseEmergencyStateCache('2026-07-16T07:00:00.000Z', '2026-07-16T08:00:00.000Z', true), false, 'older emergency cache never overwrites IndexedDB');\nassert.equal(shouldUseEmergencyStateCache('2026-07-16T09:00:00.000Z', '2026-07-16T08:00:00.000Z', true), true, 'newer pagehide cache may recover the latest edit');\nassert.equal(shouldUseEmergencyStateCache(null, null, false), true, 'legacy cache remains usable when IndexedDB has no state');\n\n${assertionsNeedle}`;
if (!test.includes(assertionsNeedle)) throw new Error('test assertions anchor not found');
test = test.replace(assertionsNeedle, assertionsReplacement);
writeFileSync(testPath, test);

rmSync('scripts/apply-emergency-cache-freshness-fix.mjs');
rmSync('.github/workflows/apply-emergency-cache-freshness-fix.yml');
