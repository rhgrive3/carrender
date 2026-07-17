import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('const mounted = useRef(true)'), true);
assert.equal(source.includes('if (!mounted.current) return;'), true);
assert.equal(source.includes('if (mounted.current) toast(caught instanceof Error'), true);
assert.equal(source.includes('if (mounted.current) setUndoing(false)'), true);

const refreshAt = source.indexOf('await refresh();');
const syncAt = source.indexOf('void requestSync(true);', refreshAt);
const guardAt = source.indexOf('if (!mounted.current) return;', syncAt);
const navigateAt = source.indexOf("navigate({ name: 'study'", guardAt);
assert.equal(refreshAt < syncAt && syncAt < guardAt && guardAt < navigateAt, true);

assert.equal(source.includes('return {\n      targetId,\n      label:'), true, '表示名と安定した学習対象IDを組で保持する');
assert.equal(source.includes('needsReview.map(({ targetId, label }) => <span key={targetId} role="listitem">{label}</span>)'), true, '同名カードでもtargetIdをReact keyに使い、一覧項目として伝える');
assert.equal(source.includes('needsReview.map((label) => <span key={label}>'), false, '重複しうる表示名をkeyへ戻さない');

assert.equal(source.includes('aria-busy={undoing}'), true, '取り消し処理中であることをボタン自身へ公開する');
assert.equal(source.includes("{undoing ? '取り消し中…' : '最後を取り消す'}"), true, '処理中はボタン表示を進捗表示へ切り替える');
assert.equal(source.includes('role="status" aria-live="polite">{undoing ? \'最後の回答を取り消しています\' : \'\'}</span>'), true, 'VoiceOverへ取り消し開始を通知する');

console.log('memory result undo race contract passed');
