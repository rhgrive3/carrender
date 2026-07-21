import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const todaySource = readFileSync(new URL('../src/screens/TodayScreen.tsx', import.meta.url), 'utf8');
const taskRowSource = readFileSync(new URL('../src/components/cards/TaskRow.tsx', import.meta.url), 'utf8');
const recordSource = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');
const memorySource = readFileSync(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');
const timerContextSource = readFileSync(new URL('../src/components/timer/TimerContext.tsx', import.meta.url), 'utf8');
const timerOverlaySource = readFileSync(new URL('../src/components/timer/TimerOverlay.tsx', import.meta.url), 'utf8');
const timerOpenSource = readFileSync(new URL('../src/components/timer/openTimerOverlay.ts', import.meta.url), 'utf8');
const quickStartSource = readFileSync(new URL('../src/components/timer/QuickStartSheet.tsx', import.meta.url), 'utf8');
const uxSource = readFileSync(new URL('../src/styles/ux-audit.css', import.meta.url), 'utf8');
const designSource = readFileSync(new URL('../src/styles/design-system.css', import.meta.url), 'utf8');
const recordFixSource = readFileSync(new URL('../src/styles/record-chart-fixes.css', import.meta.url), 'utf8');

assert.match(todaySource, /const \[recordTask, setRecordTask\] = useState<StudyTask \| null>\(null\)/, '今日画面は最優先タスクの記録対象を保持する');
assert.match(todaySource, /完了を記録/, '最優先タスクから完了記録を直接開ける');
assert.match(todaySource, /POSTPONE_TASK/, '最優先タスクを今日画面から延期できる');
assert.match(todaySource, /!topTaskOwnsActiveTimer && \([\s\S]*明日以降へ/, '実際に計測中のタスクだけ延期操作を隠す');
assert.doesNotMatch(todaySource, /topTask\.status !== 'doing'[\s\S]*明日以降へ/, '保存上の古いdoing状態だけで延期操作を隠さない');
assert.match(todaySource, /taskLocator:\s*\{/, '今日画面からの記録も再計算後のタスク参照を復旧できる');
assert.match(todaySource, /timer\.target\?\.taskId === task\.id[\s\S]*openTimerOverlay\(\)/, '今日画面の続行操作は既存タイマーを開く');
assert.match(todaySource, /!topTaskOwnsActiveTimer && \([\s\S]*完了を記録/, '計測中の最優先タスクに手動完了導線を重ねない');
assert.match(todaySource, /topTaskOwnsActiveTimer && <span className="status-badge status-accent">進行中<\/span>/, '最優先タスクの進行中表示は実タイマーに一致させる');
assert.match(taskRowSource, /const ownsActiveTimer = timer\.target\?\.taskId === task\.id/, '通常タスク行は実タイマー所有を正本にする');
assert.doesNotMatch(taskRowSource, /const isDoing = task\.status === 'doing'/, '古いdoing状態を現在の計測状態として扱わない');
assert.match(taskRowSource, /!ownsActiveTimer && \([\s\S]*aria-label=\{`\$\{task\.title\}を延期`\}/, '実際に計測中のタスクだけ延期操作を表示しない');
assert.match(taskRowSource, /!ownsActiveTimer && lock !== 'none'[\s\S]*ロックを解除/, '古いdoing状態でも実タイマーがなければ予定ロックを解除できる');
assert.doesNotMatch(taskRowSource, /task\.status !== 'doing'[\s\S]*ロックを解除/, '保存上の古いdoing状態だけでロック解除を隠さない');
assert.match(taskRowSource, /const unlock = \(\) => \{[\s\S]*task\.status === 'doing'[\s\S]*type: 'UPDATE_TASK'[\s\S]*status: 'planned'[\s\S]*placementLock: 'none'/, '古いdoing状態の解除操作は未着手へ戻してロックを実際に外す');
assert.match(taskRowSource, /onClick=\{unlock\}/, 'ロック解除ボタンは復旧処理を通す');
assert.match(taskRowSource, /if \(ownsActiveTimer\) \{[\s\S]*計測中のタスクは延期できません/, '操作関数を直接呼ばれても実タイマー所有中は延期しない');
assert.match(taskRowSource, /if \(ownsActiveTimer\) \{[\s\S]*openTimerOverlay\(\)/, '通常タスク行の続行操作は既存タイマーを開く');
assert.match(taskRowSource, /!ownsActiveTimer && \([\s\S]*完了として記録/, '計測中タスクに別の手動記録を作らせない');
assert.match(taskRowSource, /ownsActiveTimer \? '続ける' : '開始'/, '実際に同じタイマーを持つタスクだけを続行表示にする');
assert.match(taskRowSource, /ownsActiveTimer \? '計測中' : '未完了'/, '支援技術向け状態も実タイマーに一致させる');
assert.match(timerOpenSource, /querySelector<HTMLButtonElement>\('\.timer-mini'\)[\s\S]*minimized\.click\(\)/, '最小化タイマーを続行操作から展開する');
assert.match(timerOpenSource, /querySelector<HTMLElement>\('\.timer-overlay'\)[\s\S]*overlay\.focus\(\)/, '既に開いているタイマーへフォーカスを戻す');
assert.match(timerContextSource, /if \(persistedRef\.current\) return false/, '最小化中も既存タイマーを中央で上書き防止する');
assert.match(timerOverlaySource, /className=\{`timer-mini/, '実行中タイマーを最小化して他画面を操作できる');
assert.match(timerOverlaySource, /timer\.running \? \([\s\S]*変更するには一度タイマーを停止してください/, '実行中の誤操作でタイマー種別を変えない');
assert.match(quickStartSource, /if \(!started\)/, 'フリータイマー開始も既存タイマーの拒否結果を扱う');
assert.match(quickStartSource, /const material = materials\.find\(\(m\) => m\.id === materialId\)/, '選択中科目で利用可能な教材だけを開始対象にする');
assert.match(quickStartSource, /setMaterialId\(\(current\) => materials\.some\(\(item\) => item\.id === current\) \? current : ''\)/, '教材の科目変更・休止・アーカイブ後は古い選択を解除する');
assert.match(quickStartSource, /materialId: material\?\.id \?\? null/, '非表示になった教材IDをタイマー記録へ持ち込まない');

assert.doesNotMatch(recordSource, /recentTargets/, '不要な最近の教材候補を計算しない');
assert.doesNotMatch(recordSource, /最近使った教材/, '手入力記録に最近の教材候補を表示しない');
assert.match(recordSource, /const compactPreset = Boolean\(preset && !session && activeTaskTarget\)/, '実際のタスク参照を維持する新規記録だけを簡潔表示にする');
assert.match(recordSource, /<Disclosure title="必要なら内容を変更" summary=\{detailSummary\}>/, '完了量・集中度・メモは必要な時だけ展開する');
assert.match(recordSource, /preset\.source === 'timer'/, '記録元に応じて表示を分ける');
assert.match(recordSource, /予定から記録/, '手動完了をタイマー記録と誤表示しない');
assert.match(recordSource, /compactPreset \? 'この内容で保存'/, '既定値のまま短い導線で保存できる');

assert.doesNotMatch(recordFixSource, /\.sheet > \.field:has\(/, '非表示機能をDOM構造依存CSSへ埋め込まない');
assert.match(uxSource, /\.today-v2 \.next-action:not\(\.next-action-complete\):not\(\.next-action-empty\)/, '次のタスクを通常カード相当の密度へ整える');
assert.match(uxSource, /\.material-detail-panel \{[\s\S]*padding: 14px;/, '選択中教材の詳細パネルをコンパクトにする');
assert.match(uxSource, /\.material-detail-metrics \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, '教材指標を縦積みせず横並びにする');
assert.match(uxSource, /min-height: 44px;/, '主要操作のタッチ領域を維持する');
assert.doesNotMatch(designSource, /\.record-log-list\s*\{\s*columns:/, '日付見出しと同日の学習ログをCSS段組みで分断しない');

assert.match(memorySource, /苦手中心に10問ずつ覚える/, '暗記ホームで既定の出題方針を説明する');
assert.match(memorySource, /activeSession && !window\.confirm\(`前回の暗記学習/, '途中の暗記学習を破棄する前に確認する');
assert.match(memorySource, />カードを管理<\/button>/, 'カード一覧の操作目的を明確にする');
assert.match(memorySource, />出題設定<\/button>/, '問題数と方向の設定導線を明確にする');

console.log('✅ daily learning flows keep their compact, explicit UX');