import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(source, /if \(!open\) \{\s*initializedTargetRef\.current = null;/, '閉じたシートは次回表示前に初期化対象を解除する');
assert.match(source, /const targetKey = session[\s\S]*?`session:\$\{session\.id\}`/, '編集対象セッションごとに再初期化する');
assert.match(source, /setSubjectId\(session\?\.subjectId \?\? preset\?\.subjectId/, '科目を新しい対象から復元する');
assert.match(source, /setMaterialId\(session\?\.materialId \?\? preset\?\.materialId/, '教材を新しい対象から復元する');
assert.match(source, /setMemo\(session\?\.memo \?\? ''\)/, '前回入力したメモを次の記録へ持ち越さない');
assert.match(source, /setFocus\(session\?\.focus \?\? null\)/, '集中度を次の記録へ持ち越さない');
assert.match(source, /const preservesReference = !session \|\| \(session\.subjectId === subjectId && session\.materialId === selectedMaterialId\);/, '科目または教材を変更した編集を参照変更として判定する');
assert.match(source, /rangeLabel: preservesReference[\s\S]*?: material\?\.name \?\? ''/, '参照変更時は旧教材の表示名を残さず新教材名へ同期する');
assert.match(source, /completedTask: Boolean\(preservesReference/, '参照変更時は旧タスクとの完了関連も切り離す');

console.log('✅ record sheet state reset regressions passed');
