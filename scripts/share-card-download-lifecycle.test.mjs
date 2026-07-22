import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/sharecard.ts', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../src/components/ui/AppErrorBoundary.tsx', import.meta.url), 'utf8');

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

assert.equal(source.includes("const examLabel = daysToExam > 0 ? `あと${daysToExam}日` : daysToExam === 0 ? '今日' : `${Math.abs(daysToExam)}日経過`;"), true, '試験日前・当日・経過後を自然な文言へ分ける');
assert.equal(source.includes('`あと${diffDays(ref, state.goal.examDate)}日`'), false, '期限切れ目標を負の残日数で表示しない');
assert.equal(source.includes("if ((minutesByDate.get(d) ?? 0) <= 0) d = addDays(d, -1);"), true, '今日が0分の記録だけでも昨日までの連続学習を共有画像へ残す');
assert.equal(source.includes('if (!minutesByDate.has(d)) d = addDays(d, -1);'), false, '0分記録の存在だけで今日から連続判定を始めない');

assert.equal(source.includes('let shareInFlight: Promise<ShareStudyCardResult> | null = null;'), true, '進行中の共有処理を保持する');
assert.equal(source.includes('if (shareInFlight) return shareInFlight;'), true, '連打時は新しいCanvas生成や共有要求を開始しない');
assert.match(source, /setShareButtonBusy\(true\);[\s\S]*shareInFlight = performShareStudyCard\(state, ref\)\.finally\(\(\) => \{[\s\S]*?shareInFlight = null;[\s\S]*?setShareButtonBusy\(false\);/u, '共有中は操作を無効化し、完了後に必ず戻す');
assert.match(source, /button\.disabled = busy;[\s\S]*button\.setAttribute\('aria-busy', String\(busy\)\);[\s\S]*シェア画像を生成中/u, '共有ボタンへ視覚・読み上げ双方の処理中状態を反映する');
assert.equal(source.includes('new MutationObserver(() => updateShareButtons(true))'), true, '共有中の画面再描画でも新しいボタンへ処理中状態を引き継ぐ');
assert.equal(source.includes("shareBusyObserver.observe(document.body, { childList: true, subtree: true });"), true, 'DOMの追加だけを監視して再描画を検知する');
assert.match(source, /shareBusyObserver\?\.disconnect\(\);[\s\S]*shareBusyObserver = null;[\s\S]*if \(!busy/u, '共有完了後は監視を解除して不要なDOM監視を残さない');
assert.equal(source.includes('共有シート表示中に画面が再描画されても、新しく生成されたボタンへ処理中状態を引き継ぐ。'), true, '再描画を監視する理由を明記する');
assert.equal(source.includes('共有シート表示中の連打でCanvas生成や共有要求を重複させず'), true, '同時実行を防ぐ理由を明記する');

const clickAt = source.indexOf('a.click();');
const delayedRevokeAt = source.indexOf('window.setTimeout(() => URL.revokeObjectURL(url), 1_000);');
assert.ok(clickAt >= 0, 'ダウンロードリンクを起動する');
assert.ok(delayedRevokeAt > clickAt, 'ダウンロード開始後にObject URLを遅延解放する');
assert.equal(source.includes('\n  URL.revokeObjectURL(url);\n'), false, 'click直後にObject URLを同期解放しない');
assert.equal(source.includes('iOS Safariではclick直後のURL解放でダウンロード開始前に参照が失われる場合がある。'), true);

const recoveryClickAt = recoverySource.indexOf('link.click();');
const recoveryDelayAt = recoverySource.indexOf('window.setTimeout(() => {', recoveryClickAt);
const recoveryRevokeAt = recoverySource.indexOf('URL.revokeObjectURL(cleanupUrl);', recoveryDelayAt);
assert.ok(recoveryClickAt >= 0, '復旧JSONのダウンロードリンクを起動する');
assert.ok(recoveryDelayAt > recoveryClickAt && recoveryRevokeAt > recoveryDelayAt, '復旧JSONのObject URLをclick後に遅延解放する');
assert.equal(recoverySource.includes('link.click();\n      URL.revokeObjectURL(url);'), false, '復旧JSONをclick直後に同期解放しない');
assert.match(recoverySource, /document\.body\.appendChild\(link\);[\s\S]*link\.click\(\);[\s\S]*const cleanupUrl = url;[\s\S]*const cleanupLink = link;[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*cleanupLink\.remove\(\);[\s\S]*URL\.revokeObjectURL\(cleanupUrl\);/u, 'iOS向けにanchorをDOMへ追加し、成功時は遅延cleanupする');
assert.match(recoverySource, /catch \(caught\) \{[\s\S]*link\?\.remove\(\);[\s\S]*if \(url\) URL\.revokeObjectURL\(url\);[\s\S]*backupStatus: 'failed'/u, '保存準備失敗時は作成済みanchorとURLを即時cleanupする');
assert.match(recoverySource, /try \{[\s\S]*loadState\(\)[\s\S]*exportJSON\(state\)[\s\S]*\} catch \(caught\) \{[\s\S]*backupStatus: 'failed'/u, '復旧JSONの読込・変換・保存準備失敗を画面状態へ変換する');
assert.equal(recoverySource.includes('復旧用JSONの保存を開始しました。'), true, '保存開始を利用者へ通知する');
assert.equal(recoverySource.includes("role={this.state.backupStatus === 'failed' ? 'alert' : 'status'}"), true, '保存結果を支援技術へ通知する');
assert.equal(recoverySource.includes('端末内データを確認できませんでした:'), true, '初期読込失敗も復旧画面内に表示する');

console.log('✅ share card and recovery download lifecycle regressions passed');
