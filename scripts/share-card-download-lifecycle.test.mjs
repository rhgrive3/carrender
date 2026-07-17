import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/sharecard.ts', import.meta.url), 'utf8');

const shareFunctionAt = source.indexOf('async function performShareStudyCard');
const outerTryAt = source.indexOf('\n  try {', shareFunctionAt);
const buildAt = source.indexOf('const blob = buildShareCard(state, ref);', shareFunctionAt);
const failedCatchAt = source.indexOf("\n  } catch {\n    return 'failed';\n  }", buildAt);
assert.ok(shareFunctionAt >= 0, 'シェア処理を公開する');
assert.ok(outerTryAt >= 0 && outerTryAt < buildAt, 'Canvas生成より前から例外を捕捉する');
assert.ok(failedCatchAt > buildAt, '画像生成やダウンロード準備の例外をfailedへ変換する');
assert.equal(source.includes('端末のメモリ不足や実装制限で例外になることがある。'), true, '失敗経路を残す理由を明記する');
assert.equal(source.includes("type ShareStudyCardResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';"), true, '共有キャンセルを独立した結果として型へ含める');
assert.equal(source.includes("if ((e as Error).name === 'AbortError') return 'cancelled';"), true, '利用者キャンセルを共有成功として扱わない');
assert.equal(source.includes("if ((e as Error).name === 'AbortError') return 'shared';"), false, '共有キャンセルを成功結果へ戻さない');

assert.equal(source.includes('let shareInFlight: Promise<ShareStudyCardResult> | null = null;'), true, '進行中の共有処理を保持する');
assert.equal(source.includes('if (shareInFlight) return shareInFlight;'), true, '連打時は新しいCanvas生成や共有要求を開始しない');
assert.match(source, /shareInFlight = performShareStudyCard\(state, ref\)\.finally\(\(\) => \{[\s\S]*?shareInFlight = null;/u, '完了後は次の共有操作を受け付ける');
assert.equal(source.includes('共有シート表示中の連打でCanvas生成や共有要求を重複させず'), true, '同時実行を防ぐ理由を明記する');

const clickAt = source.indexOf('a.click();');
const delayedRevokeAt = source.indexOf('window.setTimeout(() => URL.revokeObjectURL(url), 1_000);');
assert.ok(clickAt >= 0, 'ダウンロードリンクを起動する');
assert.ok(delayedRevokeAt > clickAt, 'ダウンロード開始後にObject URLを遅延解放する');
assert.equal(source.includes('\n  URL.revokeObjectURL(url);\n'), false, 'click直後にObject URLを同期解放しない');
assert.equal(source.includes('iOS Safariではclick直後のURL解放でダウンロード開始前に参照が失われる場合がある。'), true);

console.log('✅ share card download lifecycle regressions passed');
