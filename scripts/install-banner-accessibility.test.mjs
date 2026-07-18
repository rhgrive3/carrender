import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/pwa/InstallBanner.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /<section[\s\S]*?role="region"[\s\S]*?aria-labelledby=\{BANNER_TITLE_ID\}[\s\S]*?aria-describedby=\{`\$\{BANNER_DESCRIPTION_ID\} \$\{BANNER_STATUS_ID\}`\}[\s\S]*?aria-busy=\{busy\}/,
  'インストール案内を名前・説明・処理状態を持つregionとして公開する',
);
assert.match(
  source,
  /id=\{BANNER_DESCRIPTION_ID\}[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/,
  '遅れて表示されるインストール案内をVoiceOverへ一まとまりで通知する',
);
assert.match(
  source,
  /id=\{BANNER_STATUS_ID\}[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"[\s\S]*?\{status\}/,
  'インストール処理の進行・キャンセル・失敗を独立したライブ領域で通知する',
);
assert.match(source, /const \[busy, setBusy\] = useState\(false\)/, 'ネイティブプロンプトの処理中状態をReact stateで保持する');
assert.match(source, /if \(busy\) return;[\s\S]*?setBusy\(true\)/, '連打で複数のネイティブプロンプトを開始しない');
assert.match(
  source,
  /const result = await promptInstall\(\)[\s\S]*?result === 'dismissed'[\s\S]*?result === 'unavailable'/,
  'キャンセルと利用不能を成功扱いせず利用者へ説明する',
);
assert.match(
  source,
  /catch \{[\s\S]*?インストール確認を開けませんでした[\s\S]*?finally \{[\s\S]*?setBusy\(false\)/,
  '失敗を通知し、成功・失敗を問わず操作状態を復元する',
);
assert.match(
  source,
  /<button[\s\S]*?type="button"[\s\S]*?aria-busy=\{busy\}[\s\S]*?disabled=\{busy\}[\s\S]*?onClick=\{\(\) => \{ void install\(\); \}\}/,
  'インストールボタンを処理中は視覚・読み上げ・操作の全てで無効化する',
);
assert.match(source, /\{busy \? '確認中…' : 'インストール'\}/, '処理中はボタン表示でも進行状態を伝える');
assert.match(
  source,
  /aria-label="インストール案内を閉じる"[\s\S]*?disabled=\{busy\}[\s\S]*?onClick=\{dismiss\}/,
  'ネイティブプロンプト処理中に案内だけを閉じて状態を失わない',
);
assert.doesNotMatch(source, /void promptInstall\(\)\.catch/, '結果を捨てる旧ハンドラへ戻さない');
assert.doesNotMatch(source, /role="complementary"\s+aria-label="アプリのインストール"/, '汎用ラベルだけの補足ランドマークへ戻さない');

console.log('✅ install banner accessibility and interaction contract passed');
