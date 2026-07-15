import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalizeCloudSettings } from '../src/lib/appStateChunks';
import { defaultSettings } from '../src/data/defaults';
import { canonicalizeLocalSettings } from '../src/state/MainStatePersistence';

const defaults = defaultSettings();
const historyData = {
  planRevisions: [{
    id: 'revision-1',
    generationId: 'generation-1',
    createdAt: '2026-07-15T00:00:00.000Z',
    reason: '回帰テスト',
    fromDate: '2026-07-15',
    placements: [],
    changes: [],
    materialChanges: [],
  }],
  monthlySummaries: [],
};
const oversized = {
  ...defaults,
  theme: 'dark' as const,
  maxDailyMinutes: 420,
  historyData,
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
assert.ok(JSON.stringify(canonical).length < 10_000, '巨大な未知設定をクラウド設定本体から除去する');
assert.equal('legacyPayload' in canonical, false, 'top-levelの未知設定を残さない');
assert.equal('legacyPayload' in canonical.timer, false, 'nestedの未知設定を残さない');
assert.equal('historyData' in canonical, false, 'クラウド設定本体では履歴を別chunkへ分離する');

const localCanonical = canonicalizeLocalSettings(oversized as typeof defaults);
assert.equal('legacyPayload' in localCanonical, false, '端末復元でも未知設定を除去する');
assert.equal('legacyPayload' in localCanonical.timer, false, '端末復元でもnested未知設定を除去する');
assert.deepEqual(
  (localCanonical as typeof defaults & { historyData: typeof historyData }).historyData,
  historyData,
  '端末復元の正規化で計画履歴を削除しない',
);

const persistenceSource = readFileSync(new URL('../src/state/MainStatePersistence.tsx', import.meta.url), 'utf8');
assert.match(persistenceSource, /canonicalizeLocalSettings/, 'IndexedDB・localStorage復元前に履歴保持型の設定正規化を使う');
assert.match(persistenceSource, /saveStateNow\(canonicalLocalState\)/, '縮小済み状態で緊急バックアップを置き換える');

const bannerSource = readFileSync(new URL('../src/components/SyncStatusBanner.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(bannerSource, /端末の空き容量を確認/, 'ブラウザ上限をiPad本体容量として案内しない');
assert.match(bannerSource, /ブラウザ内の保存上限/, 'localStorage固有の上限だと説明する');

console.log('✅ local settings recovery regressions passed');
