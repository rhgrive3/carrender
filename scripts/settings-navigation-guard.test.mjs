import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/screens/SettingsSheet.tsx', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../src/styles/accessibility-polish.css', import.meta.url), 'utf8');

assert.match(app, /settingsDirtyRef = useRef\(false\)/, '設定draftの状態を履歴処理と共有する');
assert.match(app, /settingsCloseApprovedRef = useRef\(false\)/, '画面内で承認済みの閉操作を戻る操作と区別する');
assert.match(app, /const leavingSettings = settingsOpenRef\.current && event\.state\?\.overlay !== 'settings'/, 'popstateで設定から離れる操作を検出する');
assert.match(app, /leavingSettings && !approved && settingsDirtyRef\.current[\s\S]*window\.confirm/, '端末・ブラウザの戻る操作でも未保存確認を行う');
assert.match(app, /window\.history\.pushState\([\s\S]*overlay: 'settings'/, '破棄をキャンセルしたら設定の履歴状態を復元する');
assert.match(app, /<SettingsSheet[\s\S]*onDirtyChange=\{handleSettingsDirtyChange\}/, '設定画面からShellへdirty状態を通知する');

assert.match(settings, /goalDirty \|\| availabilityDirty \|\| newEventDirty \|\| dayExceptionDirty \|\| subjectDraftDirty/, '閉じると失われる全draftを未保存判定へ含める');
assert.match(settings, /window\.addEventListener\('beforeunload', warnBeforeUnload\)/, '再読み込み・タブ終了でも未保存変更を保護する');
assert.match(settings, /<SubjectManager onDirtyChange=\{setSubjectDraftDirty\}/, '科目編集のdirty状態も親へ伝える');
assert.match(settings, /page === 'subjects' && nextPage !== 'subjects' && subjectDraftDirty[\s\S]*!window\.confirm/, '科目編集を設定一覧へ戻る操作でも破棄しない');
assert.match(settings, /const switchEditingTarget = \(next: Subject\)[\s\S]*editingDirty && !window\.confirm/, '未保存の科目を別の編集対象で上書きしない');
assert.match(settings, /const loadDayException = \(plan: DayPlanOverride\)[\s\S]*dayExceptionDirty && !window\.confirm/, '未保存の日別例外を別の編集対象で上書きしない');
assert.match(settings, /settingsPage: nextPage, settingsDepth: 2/, '設定の子ページを端末の戻る履歴へ積む');
assert.match(settings, /Number\(window\.history\.state\?\.settingsDepth\) === 2[\s\S]*window\.history\.back\(\)/, '設定内の戻る操作はまず一覧へ戻す');
assert.match(app, /const settingsDepth = Number\(window\.history\.state\?\.settingsDepth\) === 2 \? 2 : 1[\s\S]*window\.history\.go\(-settingsDepth\)/, '閉じる操作は子ページからでも設定全体を一度で閉じる');

assert.match(app, /const newlyOnboarded = state\.onboarded && !wasOnboardedRef\.current/, '初期設定完了への遷移を検出する');
assert.match(app, /newlyOnboarded[\s\S]*window\.scrollTo\(\{ top: 0, behavior: 'auto' \}\)/, '初期設定のスクロール位置を今日画面へ持ち越さない');
assert.match(polish, /@media \(max-width: 359px\)[\s\S]*\.next-action-buttons[\s\S]*grid-template-columns: 1fr/, '320px端末では主操作を縦に並べる');
assert.match(polish, /@media \(max-width: 359px\)[\s\S]*\.today-task-stack \.task-card:not\(\.done\)[\s\S]*grid-template-columns: 5px minmax\(0, 1fr\)/, '320px端末ではタスク操作列を下段へ逃がす');

console.log('✅ settings history guard and narrow-screen layout contracts passed');
