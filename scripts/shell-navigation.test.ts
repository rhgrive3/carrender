import assert from 'node:assert/strict';
import { readStoredShellTab, SHELL_TAB_STORAGE_KEY, storeShellTab } from '../src/lib/shellNavigation';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();
assert.equal(readStoredShellTab(storage), 'today', '保存値がなければ今日を開く');

storeShellTab(storage, 'analytics');
assert.equal(storage.getItem(SHELL_TAB_STORAGE_KEY), 'analytics', '選択した主要タブを保存する');
assert.equal(readStoredShellTab(storage), 'analytics', '保存した主要タブを復元する');

storage.setItem(SHELL_TAB_STORAGE_KEY, 'unknown');
assert.equal(readStoredShellTab(storage), 'today', '不正な保存値は今日へフォールバックする');

const blockedStorage = {
  getItem(): string | null { throw new Error('blocked'); },
  setItem(): void { throw new Error('blocked'); },
};
assert.equal(readStoredShellTab(blockedStorage), 'today', 'ストレージ読み込み不可でも起動できる');
assert.doesNotThrow(() => storeShellTab(blockedStorage, 'plan'), 'ストレージ書き込み不可でも操作を継続できる');

console.log('✅ shell navigation regressions passed');
