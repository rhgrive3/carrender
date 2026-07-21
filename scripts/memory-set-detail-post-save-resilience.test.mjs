import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8');
const dialogSource = await readFile(new URL('../src/features/memory/ui/MemoryDialog.tsx', import.meta.url), 'utf8');
const dialogStyles = await readFile(new URL('../src/styles/memory-dialog-polish.css', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const refreshAfterMutation = async[\s\S]*Promise\.allSettled\(\[reload\(isCurrent\), refresh\(\)\]\)[\s\S]*if \(isCurrent\(\)\) setReloadKey/,
  '保存後の詳細再読込と一覧更新を操作自体の成功条件から分離し、現在のセットだけ再試行する',
);
assert.match(
  source,
  /const requestSyncSafely = \(\) => \{[\s\S]*requestSync\(true\)\.catch\(\(\) => undefined\)/,
  'セット詳細の同期失敗を未処理Promiseにしない',
);
assert.equal(
  source.match(/requestSyncSafely\(\);/gu)?.length,
  4,
  'カード除外・確認済み化・セット更新・セット削除の全経路で安全に同期する',
);
assert.doesNotMatch(
  source,
  /void requestSync\(true\)(?!\.catch)/u,
  'セット詳細から同期を未処理のまま開始しない',
);
assert.doesNotMatch(
  source,
  /await Promise\.all\(\[reload\(\), refresh\(\)\]\)/u,
  '表示更新失敗を保存失敗として扱う旧実装へ戻さない',
);
assert.match(
  source,
  /await deleteMemorySet[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*\} catch \(caught\)[\s\S]*requestSyncSafely\(\);[\s\S]*if \(isCurrent\(\)\) navigate\(\{ name: 'home' \}\)/u,
  'セット削除後の一覧更新失敗でも同期を続け、現在のセットだけホームへ遷移する',
);
assert.match(
  source,
  /const actionInFlightRef = useRef\(false\)/u,
  'セット詳細の変更操作を再描画前から排他制御する',
);
assert.match(
  source,
  /const actionTokenRef = useRef\(0\)[\s\S]*const activeSetIdRef = useRef\(setId\)/u,
  'セット切替をまたぐ古い操作完了を識別する',
);
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{[\s\S]*activeSetIdRef\.current = setId;[\s\S]*actionTokenRef\.current \+= 1;[\s\S]*setBundle\(null\);[\s\S]*setQuery\(''\);[\s\S]*setEditingSet\(false\);[\s\S]*return \(\) => \{[\s\S]*activeSetIdRef\.current = '';[\s\S]*actionTokenRef\.current \+= 1;[\s\S]*actionInFlightRef\.current = false;[\s\S]*\};[\s\S]*\}, \[repository, setId\]\)/u,
  'セットまたは所有者切替時は旧表示・検索条件・編集状態・操作トークンを描画前に無効化する',
);
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{[\s\S]*if \(!repository\) \{[\s\S]*setBundle\(null\);[\s\S]*return;[\s\S]*repository\.loadSetBundle\(\[setId\]\)[\s\S]*\}, \[reloadKey, repository, setId\]\)/u,
  'セット読込開始とrepository消失時の旧表示除去を描画前に行う',
);
assert.match(
  source,
  /const runAction = async[\s\S]*if \(actionInFlightRef\.current\) return;[\s\S]*const actionToken = \+\+actionTokenRef\.current;[\s\S]*const isCurrent = \(\) => activeSetIdRef\.current === actionSetId && actionTokenRef\.current === actionToken;[\s\S]*if \(isCurrent\(\)\) \{[\s\S]*actionInFlightRef\.current = false;[\s\S]*setActionBusy\(false\);/u,
  '古い操作のfinallyが新しいセットの処理中状態を解除しない',
);
assert.match(
  source,
  /if \(isCurrent\(\)\) toast\(caught instanceof Error \? caught\.message : fallback\)/u,
  '古い操作の失敗通知を新しいセットや離脱後の画面へ表示しない',
);
assert.match(
  source,
  /const reload = async \(shouldApply:[\s\S]*if \(!shouldApply\(\)\) return;[\s\S]*setBundle\(next\)/u,
  '古いセットの再読込結果で現在表示を上書きしない',
);
assert.doesNotMatch(
  source,
  /const runAction = async[\s\S]*if \(actionBusy\) return;/u,
  'React stateだけを多重実行防止に使う旧実装へ戻さない',
);
assert.match(
  source,
  /const nextName = setName\.trim\(\);[\s\S]*const nextDescription = setDescription;[\s\S]*updateMemorySet\(repository, set, \{ name: nextName, description: nextDescription/u,
  '保存開始時のセット名と説明を固定し、処理中の画面状態に依存しない',
);
assert.match(
  source,
  /<button type="button" className="btn btn-primary" aria-busy=\{actionBusy\} disabled=\{actionBusy \|\| !setName\.trim\(\)\}/u,
  'セット更新ボタンで保存中状態を支援技術へ通知する',
);
assert.match(
  source,
  /<fieldset disabled=\{actionBusy\} aria-busy=\{actionBusy\}>[\s\S]*memory-edit-set-name[\s\S]*memory-edit-set-description[\s\S]*<\/fieldset>/u,
  'セット保存中は名前と説明を変更できないよう編集欄全体を固定する',
);
assert.match(
  source,
  /id="memory-edit-set-name" autoFocus value=\{setName\} onChange=\{\(event\) => setSetName\(event\.target\.value\)\}/u,
  'セット名入力は制御inputのまま初期フォーカスする',
);
assert.match(
  source,
  /const targets = useMemo\([\s\S]*includeUnverifiedAi: false[\s\S]*\.filter\(\(target\) => !target\.exerciseId && target\.mode === 'output'\)/u,
  'セット詳細でも通常学習へ実際に出題できる対象を算出する',
);
assert.match(
  source,
  /disabled=\{targets\.length === 0 \|\| actionBusy\}[\s\S]*targets\.length === 0 \? '出題できるカードなし' : '学習を始める'/u,
  '通常学習対象が0件なら開始操作を無効化して理由を表示する',
);
assert.doesNotMatch(
  source,
  /disabled=\{bundle\.senses\.length === 0 \|\| actionBusy\}[\s\S]*学習を始める/u,
  '生カード件数だけで学習可否を決める旧実装へ戻さない',
);

assert.match(dialogSource, /const onCloseRef = useRef\(onClose\)/u, '閉じる処理は最新callbackをrefで参照する');
assert.match(
  dialogSource,
  /useEffect\(\(\) => \{\s*onCloseRef\.current = onClose;\s*\}, \[onClose\]\)/u,
  '再描画時はcallbackだけ更新し、フォーカス管理を再初期化しない',
);
assert.match(
  dialogSource,
  /if \(dialog\.current && !dialog\.current\.contains\(document\.activeElement\)\) \{\s*dialog\.current\.focus\(\{ preventScroll: true \}\);/u,
  'autoFocus済みの入力欄からダイアログ本体へフォーカスを奪わない',
);
assert.match(
  dialogSource,
  /if \(event\.isComposing \|\| event\.keyCode === 229\) return;[\s\S]*onCloseRef\.current\(\)/u,
  '日本語IMEの変換候補を閉じるEscapeでは暗記ダイアログを閉じない',
);
assert.match(dialogSource, /acquireModalIsolation\(backdrop\.current\)/u, '暗記ダイアログ表示中は背面UIを操作・読み上げ対象から外す');
assert.match(dialogSource, /backdrop\.current\?\.hasAttribute\('inert'\)/u, '背面へ回った暗記ダイアログのキーボード処理を止める');
assert.match(dialogSource, /trapModalTabKey\(event, dialog\.current\)/u, '共通の表示判定を使ってフォーカスをダイアログ内へ保つ');
assert.match(
  dialogSource,
  /onPointerDown=[\s\S]*backdropPointerRef\.current[\s\S]*onPointerUp=[\s\S]*Math\.hypot[\s\S]*moved <= 10/u,
  '背景のタップ完了時だけ閉じ、スワイプやドラッグ開始で誤って閉じない',
);
assert.match(
  dialogSource,
  /window\.cancelAnimationFrame\(focusFrame\)[\s\S]*restoreModalIsolation\(\)[\s\S]*previous\?\.isConnected[\s\S]*previous\.focus\(\{ preventScroll: true \}\);[\s\S]*\}, \[\]\);/u,
  'フォーカス管理effectはマウント中に一度だけ動き、閉じる時だけ有効な元操作へ戻す',
);
assert.doesNotMatch(dialogSource, /dialog\.current\?\.focus\(\);/u, 'iOSキーボードを閉じる旧focus強制処理へ戻さない');
assert.match(dialogStyles, /\.memory-dialog \{[\s\S]*width: min\(560px, 100%\)[\s\S]*border-radius: 26px/u, '編集ダイアログを読みやすいカード形状へ整える');
assert.match(dialogStyles, /\.memory-dialog-body input,[\s\S]*font-size: 16px/u, 'iOSで入力時ズームを起こさない文字サイズにする');
assert.match(dialogStyles, /#memory-edit-set-name \{[\s\S]*font-weight: 750/u, 'セット名を主入力として視覚的に強調する');
assert.match(dialogStyles, /@media \(max-width: 560px\)[\s\S]*place-items: end center[\s\S]*\.memory-dialog-footer > \.btn \{[\s\S]*width: 100%/u, 'iPhoneでは下部シート型にして保存操作を押しやすくする');
assert.match(mainSource, /import '\.\/styles\/memory-dialog-polish\.css';/u, '暗記ダイアログ改善CSSを読み込む');

console.log('memory set detail post-save, iOS rename focus, and IME regressions passed');
