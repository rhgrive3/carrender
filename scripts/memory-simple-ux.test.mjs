import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = async (path) => await readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const feature = await read('src/features/memory/ui/MemoryFeature.tsx');
const home = await read('src/features/memory/ui/MemoryHome.tsx');
const setup = await read('src/features/memory/ui/MemoryStudySetup.tsx');
const editor = await read('src/features/memory/ui/MemoryEditor.tsx');
const study = await read('src/features/memory/ui/MemoryStudy.tsx');
const result = await read('src/features/memory/ui/MemoryResult.tsx');
const simpleSession = await read('src/features/memory/application/simpleSession.ts');

assert.doesNotMatch(feature, /MemoryAnalytics/u, '分析画面をfeatureから外す');
await assert.rejects(access(new URL('../src/features/memory/ui/MemoryAnalytics.tsx', import.meta.url)), '分析画面ファイルを削除する');
assert.match(home, /10問始める/u, 'ホームの主操作は10問開始');
assert.match(home, /createSimpleStudySession/u, 'ホームはカード専用セッションを使う');
assert.doesNotMatch(home, /Input／Output差|Composition/u, 'ホームへ専門的な分析を出さない');
assert.match(setup, /日本語 → 英語/u);
assert.match(setup, /英語 → 日本語/u);
assert.doesNotMatch(setup, /文中で使う|ミックス|AI未確認|回答方式/u, '学習設定から不要な選択肢を削除する');
assert.doesNotMatch(editor, /問題形式・指定表現|EXERCISE_TYPES|MemoryExerciseDraft/u, 'カード編集から問題作成機能を削除する');
assert.match(editor, /別の英語を追加/u, '自然な別解登録は残す');
assert.doesNotMatch(study, /gradeAnswer|multiple_choice|guided_composition|free_composition|ERROR_LABELS|ミス分類/u, '学習画面から自動問題・細分類を削除する');
assert.match(study, /まだ/u);
assert.match(study, /あやしい/u);
assert.match(study, /覚えた/u);
assert.doesNotMatch(result, /苦手分析|Learning Target|Composition/u, '結果画面から分析導線と専門用語を削除する');
assert.match(simpleSession, /!target\.exerciseId/u, '旧問題データを出題対象から除外する');
assert.match(simpleSession, /includeUnverifiedAi: false/u, '未確認AIデータを通常学習へ混ぜない');

console.log('🎉 ALL PASS (memory simple UX contract)');
