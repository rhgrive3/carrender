import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../src/components/timer/TimerOverlay.tsx', import.meta.url), 'utf8');
const backGuard = readFileSync(new URL('../src/lib/sheetBackUnsavedGuard.ts', import.meta.url), 'utf8');
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

assert.match(backGuard, /document\.addEventListener\('click', onClick, true\)/, 'Sheet back guard must run in capture phase before onBack discards state');
assert.match(backGuard, /new Event\('beforeunload', \{ cancelable: true \}\)/, 'Sheet back guard must reuse the same dirty contract as reload protection');
assert.match(backGuard, /window\.confirm\('保存されていない入力を破棄して前の画面へ戻りますか\？'\)/u, 'Sheet back guard must ask before discarding changed controls');
assert.match(backGuard, /event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*event\.stopImmediatePropagation\(\)/, 'cancelled back navigation must not reach the original onBack handler');
assert.match(pwa, /import '\.\/sheetBackUnsavedGuard';/, 'the back guard must be installed before React mounts');

assert.match(timer, /import \{ Sheet, acquireModalIsolation, trapModalTabKey \} from '\.\.\/ui\/Sheet'/, 'the timer must reuse the common modal accessibility contract');
assert.match(timer, /createPortal\([\s\S]*document\.body/, 'the fixed timer must be portalled outside the inert app root');
assert.match(timer, /role="dialog" aria-modal="true" aria-label="学習タイマー"/, 'the full-screen timer must expose a true modal dialog');
assert.match(timer, /const restoreModalIsolation = acquireModalIsolation\(root\)/, 'the timer must isolate the app and body-level navigation');
assert.match(timer, /if \(root\.hasAttribute\('inert'\)\) return;[\s\S]*trapModalTabKey\(event, root\)/, 'only the topmost timer modal may trap focus');
assert.match(timer, /<Sheet open=\{confirmDiscard\}[\s\S]*title="タイマーを破棄しますか\?"/, 'discard confirmation must join the shared stacked-modal system');
assert.doesNotMatch(timer, /role="alertdialog"/, 'discard confirmation must not remain an unisolated inline modal');

console.log('✅ Sheets and the full-screen timer share background isolation, stacked-modal ordering, focus trapping, primary initial focus, scroll lock, semantic dialog naming, safe backdrop dismissal, and unsaved back protection');
await import('./settings-navigation-guard.test.mjs');
