import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('const mounted = useRef(true)'), true);
assert.equal(source.includes('if (!mounted.current) return;'), true);
assert.equal(source.includes('if (mounted.current) toast(caught instanceof Error'), true);
assert.equal(source.includes('if (mounted.current) setUndoing(false)'), true);

const refreshAt = source.indexOf('await refresh();');
const syncAt = source.indexOf('void requestSync(true).catch(() => {', refreshAt);
const guardAt = source.indexOf('if (!mounted.current) return;', syncAt);
const navigateAt = source.indexOf("navigate({ name: 'study'", guardAt);
assert.equal(refreshAt < syncAt && syncAt < guardAt && guardAt < navigateAt, true);
assert.equal(source.includes('void requestSync(true);', refreshAt), false, '取り消し後の同期失敗を未処理のPromise rejectionにしない');
assert.equal(source.includes('取り消し結果は端末へ保存済み。同期失敗は次回の自動同期へ委ねる。'), true, '同期失敗時の継続方針を明記する');

assert.match(source, /new Set\(session\?\.needsReviewTargetIds \?\? \[\]\)/u, '重複した復習対象IDを結果画面で1件へ正規化する');
assert.equal(source.includes('<small>次回も優先</small><b>{needsReview.length}</b>'), true, '表示件数も重複除外後の一覧と一致させる');
assert.match(source, /return \{[\s\S]*?targetId,[\s\S]*?label:/u, '表示名と安定した学習対象IDを組で保持する');
assert.equal(source.includes('needsReview.map(({ targetId, label }) => <span key={targetId} role="listitem">{label}</span>)'), true, '同名カードでもtargetIdをReact keyに使い、一覧項目として伝える');
assert.equal(source.includes('needsReview.map((label) => <span key={label}>'), false, '重複しうる表示名をkeyへ戻さない');

assert.equal(source.includes('aria-busy={undoing}'), true, '取り消し処理中であることをボタン自身へ公開する');
assert.equal(source.includes("{undoing ? '取り消し中…' : '最後を取り消す'}"), true, '処理中はボタン表示を進捗表示へ切り替える');
assert.equal(source.includes('role="status" aria-live="polite">{undoing ? \'最後の回答を取り消しています\' : \'\'}</span>'), true, 'VoiceOverへ取り消し開始を通知する');

assert.match(source, /role="alert"[\s\S]*?aria-atomic="true"[\s\S]*?aria-labelledby="memory-result-error-title"[\s\S]*?aria-describedby="memory-result-error-detail"/u, '読込エラーを見出しと詳細を含む一まとまりの通知として伝える');
assert.equal(source.includes('role="group" aria-label="読込エラーの操作"'), true, '読込失敗時の再試行と離脱を一組の操作として伝える');
assert.match(source, /role="status" aria-live="polite" aria-atomic="true" aria-busy="true"/u, '読込中の状態を一まとまりの進行中通知として伝える');
assert.equal(source.includes('aria-describedby="memory-result-summary"'), true, '結果画面とカード数・回答数の要約を関連付ける');
assert.equal(source.includes('aria-label={`覚えた ${counts.remembered}件`}'), true, '集計カードの名称と件数を単独でも理解できる読み上げへまとめる');
assert.equal(source.includes('aria-label={`次回も優先 ${needsReview.length}件`}'), true, '復習優先件数も単独で意味が伝わるようにする');

console.log('memory result undo race contract passed');
