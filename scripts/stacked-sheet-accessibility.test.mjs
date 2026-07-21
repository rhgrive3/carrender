import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../src/components/timer/TimerOverlay.tsx', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../src/screens/PlanScreen.tsx', import.meta.url), 'utf8');
const material = readFileSync(new URL('../src/components/materials/MaterialFormSheet.tsx', import.meta.url), 'utf8');
const memoryDialog = readFileSync(new URL('../src/features/memory/ui/MemoryDialog.tsx', import.meta.url), 'utf8');
const memoryHome = readFileSync(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');
const memorySetDetail = readFileSync(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8');
const pwa = readFileSync(new URL('../src/lib/pwa.ts', import.meta.url), 'utf8');

assert.match(source, /const modalStack: HTMLElement\[\] = \[\]/);
assert.match(source, /const isTopmost = index === modalStack\.length - 1/);
assert.match(source, /backdrop\.setAttribute\('inert', ''\)/);
assert.match(source, /backdrop\.setAttribute\('aria-hidden', 'true'\)/);
assert.match(source, /backdrop\.removeAttribute\('inert'\)/);
assert.match(source, /backdrop\.removeAttribute\('aria-hidden'\)/);
assert.match(source, /if \(backdropRef\.current\?\.hasAttribute\('inert'\)\) return/);
assert.match(source, /ref=\{backdropRef\}/);
assert.match(source, /let bodyOverflowState: string \| null = null/);
assert.match(source, /if \(modalStack\.length === 0\) \{[\s\S]*bodyOverflowState = document\.body\.style\.overflow;[\s\S]*document\.body\.style\.overflow = 'hidden'/);
assert.match(source, /if \(modalStack\.length !== 0\) return;[\s\S]*document\.body\.style\.overflow = bodyOverflowState/);
assert.doesNotMatch(source, /const prev = document\.body\.style\.overflow/);
assert.match(source, /<h2 className="sheet-title" id=\{titleId\}>\{title\}<\/h2>/);
assert.doesNotMatch(source, /<div className="sheet-title" id=\{titleId\}>/);
assert.doesNotMatch(source, /sheet-grabber/, 'ドラッグ非対応のシートにスワイプ可能と誤解させるグラバーを表示しない');

assert.match(source, /function getInitialFocusTarget\(root: HTMLElement\)/, 'sheets must choose an explicit initial focus target');
assert.match(source, /focusable\.find\(\(element\) => !element\.classList\.contains\('sheet-close'\)\)/, 'initial focus must skip the dismiss control when a primary operation exists');
assert.match(source, /\?\? focusable\[0\][\s\S]*\?\? root/, 'close button and sheet body must remain safe fallbacks');
assert.match(source, /getInitialFocusTarget\(sheet\)\.focus\(\)/, 'opening a sheet must focus the primary operation instead of the close button');
assert.doesNotMatch(source, /const firstFocusable = getFocusableElements\(sheet\)\[0\]/, 'raw DOM order must not make the close button the default initial focus again');

assert.match(source, /let portalBackgroundStates: Array<\{ element: HTMLElement; hadInert: boolean; ariaHidden: string \| null \}> = \[\]/);
assert.match(source, /\[\.\.\.document\.body\.children\]/);
assert.match(source, /element !== appRoot && element !== backdrop && !element\.classList\.contains\('sheet-backdrop'\)/);
assert.match(source, /portalBackgroundStates\.forEach\(\(\{ element \}\) => \{[\s\S]*element\.setAttribute\('inert', ''\);[\s\S]*element\.setAttribute\('aria-hidden', 'true'\)/);
assert.match(source, /function restorePortalBackground\(\)/);
assert.match(source, /if \(!hadInert\) element\.removeAttribute\('inert'\)/);
assert.match(source, /if \(ariaHidden === null\) element\.removeAttribute\('aria-hidden'\)/);
assert.match(source, /restorePortalBackground\(\)/);

assert.match(source, /export function acquireModalIsolation\(backdrop: HTMLElement\)/, 'modal isolation must be reusable by full-screen overlays');
assert.match(source, /export function trapModalTabKey\(e: KeyboardEvent, root: HTMLElement\)/, 'modal focus trapping must be shared rather than duplicated');
assert.match(source, /const restoreModalIsolation = acquireModalIsolation\(backdropRef\.current\)/, 'sheets must use the shared modal stack');
assert.match(source, /trapModalTabKey\(e, sheetRef\.current\)/, 'sheets must use the shared focus trap');

assert.match(source, /backdropPointerRef = useRef<\{ pointerId: number; x: number; y: number \} \| null>/, 'backdrop dismissal must track a complete pointer gesture');
assert.match(source, /event\.isPrimary[\s\S]*event\.button === 0[\s\S]*event\.target === event\.currentTarget/, 'only a primary left/touch pointer that starts on the backdrop may dismiss');
assert.match(source, /event\.pointerId !== start\.pointerId \|\| event\.target !== event\.currentTarget/, 'the same pointer must finish on the backdrop');
assert.match(source, /Math\.hypot\(event\.clientX - start\.x, event\.clientY - start\.y\)/, 'backdrop dismissal must measure movement');
assert.match(source, /if \(moved <= 10\) requestClose\(\)/, 'drag and scroll gestures must not close the sheet, and taps must use the guarded close path');
assert.match(source, /onPointerCancel=\{\(\) => \{[\s\S]*backdropPointerRef\.current = null/, 'cancelled gestures must not retain stale dismissal state');
assert.doesNotMatch(source, /onClick=\{\(e\) => \{[\s\S]*e\.target === e\.currentTarget[\s\S]*onClose\(\)/, 'click-only backdrop dismissal must not return');

assert.match(source, /export function sheetControlSnapshot/, 'the common control snapshot must be reusable by memory dialogs');
assert.match(source, /dialogName\.includes\('記録'\)[\s\S]*dialogName\.includes\('教材'\)[\s\S]*dialogName\.includes\('タスク'\)[\s\S]*dialogName\.endsWith\('の詳細計画'\)/, 'record, scheduler input, task, and day-detail forms must opt into unsaved protection');
assert.match(source, /const DAY_DETAIL_MEMO_SELECTOR = 'textarea\[id\^="day-memo-"\]'/, 'auto-saved day load controls must not create a false dirty prompt');
assert.match(source, /onClick=\{requestBack\}/, 'Sheet back must use the same local dirty state as close and Escape');
assert.match(source, /onClickCapture=\{guardDraftDiscardingAction\}/, 'draft-discarding task and day actions must be intercepted before child handlers run');
assert.match(source, /event\.nativeEvent\.stopImmediatePropagation\(\)/, 'cancelled draft-discarding actions must not reach the original operation');
assert.doesNotMatch(pwa, /sheetBackUnsavedGuard/, 'unsaved protection must stay local to the active Sheet rather than dispatching a page-wide beforeunload event');

assert.match(plan, /title="タスク詳細"/, 'task edits must inherit the Sheet dirty contract');
assert.match(plan, /title="タスクを追加"/, 'manual task creation must inherit the Sheet dirty contract');
assert.match(plan, /title=\{`\$\{formatDateShort\(selectedDay\)\} の詳細計画`\}/, 'day memo must inherit the Sheet dirty contract');
assert.match(material, /title=\{isEdit \? '教材を編集' : '教材を追加'\}/, 'scheduler-driving material inputs must inherit the Sheet dirty contract');

assert.match(memoryDialog, /sheetControlSnapshot/, 'memory dialogs must reuse the common form snapshot');
assert.match(memoryDialog, /protectUnsavedChanges \?\? title\.includes\('暗記セット'\)/, 'memory set create and edit dialogs must protect unsaved names and descriptions');
assert.match(memoryDialog, /window\.addEventListener\('beforeunload', onBeforeUnload\)/, 'memory set input must also survive accidental reload attempts');
assert.match(memoryDialog, /requestCloseRef\.current\(\)/, 'Escape, backdrop and close button must use the guarded memory close path');
assert.match(memoryHome, /title="暗記セットを追加"/, 'the create-set dialog must use the protected title contract');
assert.match(memorySetDetail, /title="暗記セットを編集"/, 'the edit-set dialog must use the protected title contract');

assert.match(timer, /import \{ Sheet, acquireModalIsolation, trapModalTabKey \} from '\.\.\/ui\/Sheet'/, 'the timer must reuse the common modal accessibility contract');
assert.match(timer, /createPortal\([\s\S]*document\.body/, 'the fixed timer must be portalled outside the inert app root');
assert.match(timer, /role="dialog" aria-modal="true" aria-label="学習タイマー"/, 'the full-screen timer must expose a true modal dialog');
assert.match(timer, /const restoreModalIsolation = acquireModalIsolation\(root\)/, 'the timer must isolate the app and body-level navigation');
assert.match(timer, /if \(root\.hasAttribute\('inert'\)\) return;[\s\S]*trapModalTabKey\(event, root\)/, 'only the topmost timer modal may trap focus');
assert.match(timer, /<Sheet open=\{confirmDiscard\}[\s\S]*title="タイマーを破棄しますか\?"/, 'discard confirmation must join the shared stacked-modal system');
assert.doesNotMatch(timer, /role="alertdialog"/, 'discard confirmation must not remain an unisolated inline modal');

console.log('✅ Sheets and memory dialogs protect unsaved core form input while preserving modal accessibility and local ownership');
await import('./settings-navigation-guard.test.mjs');
