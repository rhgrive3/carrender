import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const todaySource = readFileSync(new URL('../src/screens/TodayScreen.tsx', import.meta.url), 'utf8');
const recordSource = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');
const memorySource = readFileSync(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(todaySource, /const \[recordTask, setRecordTask\] = useState<StudyTask \| null>\(null\)/, '今日画面は最優先タスクの記録対象を保持する');
assert.match(todaySource, /完了を記録/, '最優先タスクから完了記録を直接開ける');
assert.match(todaySource, /POSTPONE_TASK/, '最優先タスクを今日画面から延期できる');
assert.match(todaySource, /topTask\.status !== 'doing'[\s\S]*明日以降へ/, '計測中のタスクには延期操作を表示しない');
assert.match(todaySource, /taskLocator:\s*\{/, '今日画面からの記録も再計算後のタスク参照を復旧できる');

assert.match(recordSource, /const recentTargets = useMemo\(\(\) => \{/, '手入力では最近の教材候補を作る');
assert.match(recordSource, /最近使った教材/, '最近使った教材をワンタップで選べる');
assert.match(recordSource, /const compactPreset = Boolean\(preset && !session && hasTaskTarget\)/, '予定からの新規記録だけを簡潔表示にする');
assert.match(recordSource, /<Disclosure title="必要なら内容を変更" summary=\{detailSummary\}>/, '完了量・集中度・メモは必要な時だけ展開する');
assert.match(recordSource, /preset\.source === 'timer'/, '記録元に応じて表示を分ける');
assert.match(recordSource, /予定から記録/, '手動完了をタイマー記録と誤表示しない');
assert.match(recordSource, /compactPreset \? 'この内容で保存'/, '既定値のまま短い導線で保存できる');

assert.match(memorySource, /苦手中心に10問ずつ覚える/, '暗記ホームで既定の出題方針を説明する');
assert.match(memorySource, />カードを管理<\/button>/, 'カード一覧の操作目的を明確にする');
assert.match(memorySource, />出題設定<\/button>/, '問題数と方向の設定導線を明確にする');

console.log('✅ daily learning flows keep their shortened, explicit UX');
