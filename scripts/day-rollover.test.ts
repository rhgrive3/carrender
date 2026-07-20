import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveDayRollover } from '../src/lib/dayRollover';

assert.equal(resolveDayRollover('2026-07-15', '2026-07-15'), '2026-07-15', '同じ日は画面状態を維持する');
assert.equal(resolveDayRollover('2026-07-15', '2026-07-16'), '2026-07-16', '日付が変わったら新しい基準日へ更新する');

const boundarySource = readFileSync(new URL('../src/components/DayRolloverBoundary.tsx', import.meta.url), 'utf8');
assert.match(boundarySource, /visibilitychange/, 'iPad PWAが前面へ戻った時に日付を確認する');
assert.match(boundarySource, /pageshow/, 'ページ復元時にも日付を確認する');
assert.match(boundarySource, /window\.addEventListener\('focus'/, 'フォーカス復帰時にも日付を確認する');
assert.match(boundarySource, /window\.setInterval/, '前面表示を続けたまま日付をまたいでも定期的に確認する');
assert.match(boundarySource, /document\.visibilityState === 'visible'/, '背面中の不要な定期確認を避ける');
assert.match(boundarySource, /window\.clearInterval\(intervalId\)/, 'アンマウント時に日付確認タイマーを解放する');

const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(mainSource, /<App key=\{dayKey\} \/>/, '日付変更時に日付依存画面を再初期化する');

console.log('✅ day rollover regressions passed');
