import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(source, /function NavigationAnnouncement\(\)/, 'navigation announcement component must exist');
assert.match(source, /\.bottom-nav \[aria-current="page"\]/, 'the active bottom-navigation item must be observed');
assert.match(source, /new MutationObserver\(announceCurrentScreen\)/, 'screen changes must be observed without continuous polling');
assert.match(source, /attributeFilter: \['aria-current'\]/, 'the observer must be limited to active-navigation changes');
assert.match(source, /observer\.disconnect\(\)/, 'the navigation observer must be cleaned up');
assert.doesNotMatch(source, /setInterval\(/, 'navigation announcements must not use continuous polling');
assert.match(source, /role="status"/, 'announcements must use a status live region');
assert.match(source, /aria-live="polite"/, 'screen changes must be announced politely');
assert.match(source, /aria-atomic="true"/, 'the entire screen-change message must be announced');
assert.match(source, /lastLabelRef\.current === null/, 'the initial screen must not be redundantly announced');
assert.match(source, /\$\{label\}画面を表示しました/, 'the message must name the newly displayed screen');
assert.match(source, /const APP_TITLE = 'StudyCommander 学習司令塔'/, 'the stable app title must be defined once');
assert.match(source, /document\.title = `\$\{label\} \| \$\{APP_TITLE\}`/, 'the document title must follow the active screen');

console.log('navigation announcement contract: ok');
