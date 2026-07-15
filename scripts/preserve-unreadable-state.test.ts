import assert from 'node:assert/strict';
import { preserveUnreadableState } from '../src/lib/preserveUnreadableState';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const stateKey = 'studycommander_state_v1';
const backupKey = 'studycommander_state_migration_backup';

{
  const storage = new MemoryStorage();
  const broken = '{"onboarded":true,"subjects":[';
  storage.setItem(stateKey, broken);
  assert.equal(preserveUnreadableState(storage), true);
  assert.equal(storage.getItem(backupKey), broken, '途中で壊れたJSONを初期状態で上書きする前に退避する');
}

{
  const storage = new MemoryStorage();
  const wrongShape = JSON.stringify({ onboarded: true, subjects: [] });
  storage.setItem(stateKey, wrongShape);
  assert.equal(preserveUnreadableState(storage), true);
  assert.equal(storage.getItem(backupKey), wrongShape, 'JSONとして読めてもAppStateでないデータを退避する');
}

{
  const storage = new MemoryStorage();
  const valid = JSON.stringify({
    onboarded: false,
    subjects: [],
    materials: [],
    tasks: [],
    sessions: [],
    settings: {},
  });
  storage.setItem(stateKey, valid);
  assert.equal(preserveUnreadableState(storage), false);
  assert.equal(storage.getItem(backupKey), null, '正常な保存データは不要にバックアップしない');
}

console.log('✅ unreadable local state preservation regressions passed');
