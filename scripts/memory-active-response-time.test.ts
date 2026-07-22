import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ActiveElapsedTimer } from '../src/features/memory/domain/activeElapsedTime';

const timer = new ActiveElapsedTimer(1_000, true);
assert.equal(timer.read(4_000), 3_000, '表示中の時間を計測する');
timer.pause(4_000);
assert.equal(timer.read(64_000), 3_000, '非表示中の時間を加算しない');
timer.pause(64_000);
assert.equal(timer.read(64_000), 3_000, 'visibilitychangeとpagehideの重複停止で二重加算しない');
timer.start(64_000);
timer.start(65_000);
assert.equal(timer.read(66_000), 5_000, 'pageshowとvisibleの重複開始で開始時刻を上書きしない');

timer.reset(70_000, true);
assert.equal(timer.read(72_000), 2_000, '次カードでは0から計測する');
timer.pause(71_000);
assert.equal(timer.read(72_000), 1_000, '時刻が後退しても負の時間を加算しない');
timer.reset(Number.NaN, true);
assert.equal(timer.read(Number.POSITIVE_INFINITY), 0, '非有限値を保存候補へ流さない');

const studySource = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');
assert.match(studySource, /new ActiveElapsedTimer\(performance\.now\(\), document\.visibilityState !== 'hidden'\)/u, '初期表示状態に応じて回答時間計測を開始する');
assert.match(studySource, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/u, 'visibilitychangeを監視する');
assert.match(studySource, /window\.addEventListener\('pagehide', pauseTimer\)/u, 'pagehideで計測を停止する');
assert.match(studySource, /window\.addEventListener\('pageshow', resumeTimer\)/u, 'pageshowで計測を再開する');
assert.match(studySource, /document\.removeEventListener\('visibilitychange', onVisibilityChange\)/u, 'visibility listenerをcleanupする');
assert.match(studySource, /responseTimer\.current\.reset\(performance\.now\(\), document\.visibilityState !== 'hidden'\)/u, 'カード・session切替で計測値を破棄する');
assert.match(studySource, /const responseMsAtReveal = useRef<number>\(\)/u, '各問題の最初の答え表示時点を保持する');
assert.match(studySource, /if \(next && responseMsAtReveal\.current === undefined\) \{\s*responseMsAtReveal\.current = responseTimer\.current\.read\(performance\.now\(\)\);\s*\}/u, '初めて答えを表示した時点で想起時間を固定する');
assert.match(studySource, /responseMs: responseMsAtReveal\.current \?\? responseTimer\.current\.read\(performance\.now\(\)\)/u, '自己評価までの確認時間を加算せず、未取得時だけ現在値へfallbackする');
assert.equal((studySource.match(/responseMsAtReveal\.current = undefined;/gu) ?? []).length >= 4, true, 'session・次カード・回答完了・Undoで固定値を破棄する');
assert.doesNotMatch(studySource, /responseMs: responseTimer\.current\.read\(performance\.now\(\)\)/u, '自己評価時点までの全時間を直接保存しない');
assert.doesNotMatch(studySource, /performance\.now\(\) - questionStarted\.current/u, '非表示時間を含む単純差分へ戻さない');

console.log('memory active response time contracts passed');
