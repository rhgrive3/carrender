import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const screen = read('src/screens/MaterialsScreen.tsx');
const shelf = read('src/components/materials/MaterialShelf.tsx');
const card = read('src/components/materials/MaterialShelfCard.tsx');
const detail = read('src/components/materials/MaterialDetail.tsx');
const form = read('src/components/materials/MaterialFormSheet.tsx');
const css = read('src/styles/material-shelf.css');
const main = read('src/main.tsx');

assert.match(screen, /className="screen materials-screen"/, '教材画面を専用の本棚レイアウトにする');
assert.match(screen, /materials-add-button/, '教材追加を文字付きの主要操作として表示する');
assert.match(screen, /if \(timer\.target\)/, '別教材の計測中にタイマーを上書きしない');
assert.match(screen, /timer\.start\(\{ taskId: null,[\s\S]*materialId: material\.id/, '教材から直接タイマーを開始できる');
assert.match(screen, /const started = timer\.start[\s\S]*if \(!started\)/, '同一フレームの競合でも開始拒否を成功通知しない');
assert.match(shelf, /placeholder="教材名・科目で検索"/, '教材名と科目で検索できる');
assert.match(shelf, /aria-label="科目で絞り込む"/, '科目チップで絞り込める');
assert.match(shelf, /option value="deadline">期限が近い順/, '期限や進捗で並べ替えられる');
assert.match(shelf, /material-subject-group/, '教材を科目ごとの棚に整理する');
assert.match(shelf, /materials-overview/, '使用中冊数・要確認・今日量を一覧前に示す');
assert.match(shelf, /!wideDetail && \([\s\S]*<Sheet open=\{Boolean\(mobileSelected\)\}/, 'モバイルでは選択直後に教材詳細シートを開く');
assert.match(card, /material-cover-tile/, '教材を見分けやすい表紙タイルを表示する');
assert.match(card, /material-quick-action primary/, '一覧から計測を始められる');
assert.match(card, /aria-label=\{`\$\{material\.name\}を編集`\}/, '一覧から直接編集できる');
assert.match(detail, /この教材で計測/, '詳細にも主要な計測操作を置く');
assert.match(form, /adjustCompletedRanges\(totalAmount, existingCompletedRanges, doneAmount\)/, '教材保存前に完了範囲を入力値へ合わせる');
assert.match(form, /doneAmount:\s*normalizedDoneAmount[\s\S]*completedRanges,/, '完了量と完了範囲を同じ計算結果から保存する');
assert.match(css, /\.material-quick-action[\s\S]*min-height:\s*48px/, '教材のクイック操作を十分なタッチ領域にする');
assert.match(css, /\.materials-add-button[\s\S]*min-height:\s*44px/, '教材追加ボタンを44px以上にする');
assert.match(main, /import '\.\/styles\/material-shelf\.css';/, '教材棚のスタイルを読み込む');

console.log('✅ materials shelf UX contracts passed');
