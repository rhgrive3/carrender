import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../src/components/timer/TimerOverlay.tsx', import.meta.url), 'utf8');

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
assert.match(source, /<div className="sheet-grabber" aria-hidden="true" \/>/);

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

assert.match(timer, /import \{ Sheet, acquireModalIsolation, trapModalTabKey \} from '\.\.\/ui\/Sheet'/, 'the timer must reuse the common modal accessibility contract');
assert.match(timer, /createPortal\([\s\S]*document\.body/, 'the fixed timer must be portalled outside the inert app root');
assert.match(timer, /role="dialog" aria-modal="true" aria-label="学習タイマー"/, 'the full-screen timer must expose a true modal dialog');
assert.match(timer, /const restoreModalIsolation = acquireModalIsolation\(root\)/, 'the timer must isolate the app and body-level navigation');
assert.match(timer, /if \(root\.hasAttribute\('inert'\)\) return;[\s\S]*trapModalTabKey\(event, root\)/, 'only the topmost timer modal may trap focus');
assert.match(timer, /<Sheet open=\{confirmDiscard\}[\s\S]*title="タイマーを破棄しますか\?"/, 'discard confirmation must join the shared stacked-modal system');
assert.doesNotMatch(timer, /role="alertdialog"/, 'discard confirmation must not remain an unisolated inline modal');

console.log('✅ Sheets and the full-screen timer share background isolation, stacked-modal ordering, focus trapping, scroll lock, and semantic dialog naming');
