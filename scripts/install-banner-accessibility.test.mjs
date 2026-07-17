import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/pwa/InstallBanner.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /<section[\s\S]*?role="region"[\s\S]*?aria-labelledby=\{BANNER_TITLE_ID\}[\s\S]*?aria-describedby=\{BANNER_DESCRIPTION_ID\}/,
  'インストール案内を名前と説明を持つregionとして公開する',
);
assert.match(
  source,
  /id=\{BANNER_DESCRIPTION_ID\}[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/,
  '遅れて表示されるインストール案内をVoiceOverへ一まとまりで通知する',
);
assert.match(
  source,
  /<button[\s\S]*?type="button"[\s\S]*?aria-describedby=\{BANNER_DESCRIPTION_ID\}[\s\S]*?インストール/,
  'インストール操作へ案内内容を関連付け、暗黙のsubmitを防ぐ',
);
assert.match(
  source,
  /<button[\s\S]*?type="button"[\s\S]*?aria-label="インストール案内を閉じる"[\s\S]*?aria-describedby=\{BANNER_DESCRIPTION_ID\}/,
  '閉じる操作の対象を単独フォーカス時にも判別できる名前にする',
);
assert.doesNotMatch(source, /role="complementary"\s+aria-label="アプリのインストール"/, '汎用ラベルだけの補足ランドマークへ戻さない');

console.log('✅ install banner accessibility contract passed');
