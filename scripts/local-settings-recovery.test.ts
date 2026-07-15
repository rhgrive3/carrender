import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalizeCloudSettings } from '../src/lib/appStateChunks';
import { defaultSettings } from '../src/data/defaults';

const defaults = defaultSettings();
const oversized = {
  ...defaults,
  theme: 'dark' as const,
  maxDailyMinutes: 420,
  timer: {
    ...defaults.timer,
    pomodoro: { ...defaults.timer.pomodoro, workMinutes: 50 },
    legacyPayload: 'x'.repeat(1_200_000),
  },
  legacyPayload: 'x'.repeat(1_200_000),
};

const canonical = canonicalizeCloudSettings(oversized as typeof defaults);
assert.equal(canonical.theme, 'dark', '現行のテーマ設定を維持する');
assert.equal(canonical.maxDailyMinutes, 420, '現行の学習時間設定を維持する');
assert.equal(canonical.timer.pomodoro.workMinutes, 50, '現行のタイマー設定を維持する');
assert.ok(JSON.stringify(canonical).length < 10_000, '巨大な未知設定を端末復元前に除去する');
assert.equal('legacyPayload' in canonical, false, 'top-levelの未知設定を残さない');
assert.equal('legacyPayload' in canonical.timer, false, 'nestedの未知設定を残さない');

const persistenceSource = readFileSync(new URL('../src/state/MainStatePersistence.tsx', import.meta.url), 'utf8');
assert.match(persistenceSource, /canonicalizeCloudSettings/, 'IndexedDB・localStorage復元前に設定を正規化する');
assert.match(persistenceSource, /saveStateNow\(canonicalLocalState\)/, '縮小済み状態で緊急バックアップを置き換える');

const bannerSource = readFileSync(new URL('../src/components/SyncStatusBanner.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(bannerSource, /端末の空き容量を確認/, 'ブラウザ上限をiPad本体容量として案内しない');
assert.match(bannerSource, /ブラウザ内の保存上限/, 'localStorage固有の上限だと説明する');

console.log('✅ local settings recovery regressions passed');
