import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const memoryFeature = await readFile(new URL('../src/features/memory/ui/MemoryFeature.tsx', import.meta.url), 'utf8');

assert.match(source, /function NavigationAnnouncement\(\)/, 'navigation announcement component must exist');
assert.match(source, /\.bottom-nav \[aria-current="page"\]/, 'the active bottom-navigation item must be observed');
assert.match(source, /\[data-app-screen-label\]/, 'nested immersive screens must be able to expose their current label');
assert.match(source, /!element\.closest\('\[hidden\]'\)/, 'labels inside inactive tab panels must be ignored');
assert.match(source, /contextualLabel \|\| current/, 'nested screen labels must take precedence over the parent navigation tab');
assert.match(source, /new MutationObserver\(announceCurrentScreen\)/, 'screen changes must be observed without continuous polling');
assert.match(source, /observer\.observe\(document\.body,/, 'the observer must include body-level portal navigation');
assert.doesNotMatch(source, /observer\.observe\(root,/, 'the observer must not be limited to the React root');
assert.match(source, /attributeFilter: \['aria-current', 'data-app-screen-label', 'hidden'\]/, 'the observer must cover navigation, nested screens, and tab visibility');
assert.match(source, /observer\.disconnect\(\)/, 'the navigation observer must be cleaned up');
assert.doesNotMatch(source, /setInterval\(/, 'navigation announcements must not use continuous polling');
assert.match(source, /role="status"/, 'announcements must use a status live region');
assert.match(source, /aria-live="polite"/, 'screen changes must be announced politely');
assert.match(source, /aria-atomic="true"/, 'the entire screen-change message must be announced');
assert.match(source, /lastLabelRef\.current === null/, 'the initial screen must not be redundantly announced');
assert.match(source, /\$\{label\}画面を表示しました/, 'the message must name the newly displayed screen');
assert.match(source, /const APP_TITLE = 'StudyCommander 学習司令塔'/, 'the stable app title must be defined once');
assert.match(source, /document\.title = `\$\{label\} \| \$\{APP_TITLE\}`/, 'the document title must follow the active screen');

assert.match(memoryFeature, /const MEMORY_SCREEN_LABELS/, 'memory views must define stable screen labels');
assert.match(memoryFeature, /data-app-screen-label=\{MEMORY_SCREEN_LABELS\[view\.name\]\}/, 'every memory view must publish its current screen label');
assert.match(memoryFeature, /study: '暗記学習'/, 'immersive study mode must have a specific screen label');
assert.match(memoryFeature, /result: '暗記学習結果'/, 'study results must have a specific screen label');

console.log('navigation announcement contract: ok');
