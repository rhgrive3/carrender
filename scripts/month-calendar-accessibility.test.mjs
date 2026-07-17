import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/ui/MonthCalendar.tsx', import.meta.url), 'utf8');

assert.match(source, /if \(!onSelectDay\)/u, '閲覧専用と選択可能なカレンダーを分岐する');
assert.match(source, /return <div key=\{d\} className=\{cls\}/u, '閲覧専用セルは通常要素として表示する');
assert.doesNotMatch(source, /disabled=\{!onSelectDay\}/u, '閲覧専用セルをdisabledボタンとして公開しない');
assert.match(source, /type="button"[\s\S]*onClick=\{\(\) => onSelectDay\(d\)\}/u, '選択可能なセルだけをボタンとして維持する');
assert.match(source, /aria-pressed=\{selectedDate === d\}/u, '選択状態を支援技術へ公開する');
assert.match(source, /role="group" aria-label=\{calendarLabel\} data-month-calendar/u, 'カレンダー全体へ年月を含む名前を付ける');
assert.match(source, /WEEKDAY_FULL_LABELS/u, '日付の読み上げへ曜日を含める');
assert.match(source, /<span className="sr-only">\{dateLabel\}<\/span>/u, 'セル内容を隠さず完全な日付を読み上げる');
assert.doesNotMatch(source, /aria-label=\{`\$\{Number\(month\.slice\(5\)\)/u, '日付だけのaria-labelで学習時間を上書きしない');
assert.match(source, /tabIndex=\{defaultFocusableDate === d \? 0 : -1\}/u, '選択可能な日付をroving tabindexへまとめる');
assert.match(source, /ArrowLeft[\s\S]*ArrowRight[\s\S]*ArrowUp[\s\S]*ArrowDown/u, '方向キーで日付を移動できる');
assert.match(source, /Home[\s\S]*End/u, 'HomeとEndで月初・月末へ移動できる');
assert.match(source, /onKeyDown=\{\(event\) => moveSelection\(event, d\)\}/u, '日付ボタンへキーボード操作を接続する');
assert.match(source, /aria-hidden="true" \/>/u, '月初前の空セルを読み上げ対象外にする');

console.log('✅ Month calendar exposes named, readable, keyboard-efficient controls');
