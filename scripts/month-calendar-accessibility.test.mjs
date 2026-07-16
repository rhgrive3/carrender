import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/ui/MonthCalendar.tsx', import.meta.url), 'utf8');

assert.match(source, /if \(!onSelectDay\)/u, '閲覧専用と選択可能なカレンダーを分岐する');
assert.match(source, /return <div key=\{d\} className=\{cls\}/u, '閲覧専用セルは通常要素として表示する');
assert.doesNotMatch(source, /disabled=\{!onSelectDay\}/u, '閲覧専用セルをdisabledボタンとして公開しない');
assert.match(source, /type="button"[\s\S]*onClick=\{\(\) => onSelectDay\(d\)\}/u, '選択可能なセルだけをボタンとして維持する');
assert.match(source, /aria-pressed=\{selectedDate === d\}/u, '選択状態を支援技術へ公開する');

console.log('✅ Month calendar exposes controls only when days are selectable');
