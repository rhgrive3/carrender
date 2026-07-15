import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const regressionsPath = 'scripts/regressions.test.ts';
let regressions = readFileSync(regressionsPath, 'utf8');
const oldBlock = `console.log('--- 端末保存失敗の可視化 ---');\n{\n  let reported: string | null = null;\n  const unsubscribe = subscribeStateSaveFailure((failure) => { reported = failure?.message ?? null; });\n  globalThis.localStorage = {\n    getItem: () => null,\n    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },\n    removeItem: () => {},\n    clear: () => {},\n    key: () => null,\n    length: 0,\n  } as Storage;\n  saveStateNow(state());\n  check('端末保存容量超過を黙殺せず利用者向け状態へ通知', reported?.includes('端末保存容量') === true, reported);\n  unsubscribe();\n}\n`;
const newBlock = `console.log('--- 端末保存容量超過のフォールバック ---');\n{\n  let reported: string | null = null;\n  const unsubscribe = subscribeStateSaveFailure((failure) => { reported = failure?.message ?? null; });\n  globalThis.localStorage = {\n    getItem: () => null,\n    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },\n    removeItem: () => {},\n    clear: () => {},\n    key: () => null,\n    length: 0,\n  } as Storage;\n  saveStateNow(state());\n  check('端末保存容量超過は警告を重複表示せずIndexedDBへフォールバック', reported === null, reported);\n  unsubscribe();\n}\n`;
if (!regressions.includes(oldBlock)) throw new Error('legacy quota regression block not found');
regressions = regressions.replace(oldBlock, newBlock);
writeFileSync(regressionsPath, regressions);

const persistencePath = 'src/state/MainStatePersistence.tsx';
let persistence = readFileSync(persistencePath, 'utf8');
const oldComment = ` * Restores the account-scoped IndexedDB snapshot before AppProvider starts its\n * cloud reconciliation. localStorage remains the synchronous emergency cache;\n * when it exists for this owner it wins because pagehide can update it after an\n * asynchronous IndexedDB write was suspended by iOS.\n`;
const newComment = ` * Restores the account-scoped IndexedDB snapshot before AppProvider starts its\n * cloud reconciliation. localStorage remains a synchronous emergency cache, but\n * it wins only when its timestamp is newer than IndexedDB (for example, an iOS\n * pagehide update whose asynchronous IndexedDB write was suspended).\n`;
if (!persistence.includes(oldComment)) throw new Error('bootstrap comment anchor not found');
persistence = persistence.replace(oldComment, newComment);
writeFileSync(persistencePath, persistence);

rmSync('scripts/apply-emergency-cache-regression-update.mjs');
rmSync('.github/workflows/apply-emergency-cache-regression-update.yml');
