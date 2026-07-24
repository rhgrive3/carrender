import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [resultSource, detailSource, homeSource, setupSource, studySource, contextSource, materialsSource, conflictsSource, backupRestoreSource] = await Promise.all([
  readFile(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryStudySetup.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/MaterialsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryConflictsDialog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryBackupRestore.tsx', import.meta.url), 'utf8'),
]);

assert.match(resultSource, /if \(!loaded\) throw new Error\('学習結果が見つかりません'\)/, '削除済み・不明な結果を無限ローディングにしない');
assert.match(resultSource, /\.catch\(\(caught\) => \{[\s\S]*?setLoadError/, '結果読込のPromise拒否を画面状態へ反映する');
assert.match(resultSource, /role="alert"[\s\S]*?学習結果を開けませんでした[\s\S]*?再読み込み/, '結果読込失敗時に理由と再試行手段を表示する');
assert.match(resultSource, /applyResult\(initial\)[\s\S]*await requestSync\(true\)/, '端末内結果を同期完了前に表示する');
assert.match(resultSource, /syncWarning[\s\S]*端末の結果を表示しています。同期は暗記ホームから再試行できます。/, '同期失敗時もローカル結果と再試行案内を維持する');

assert.match(detailSource, /if \(!next\.sets\[0\]\) throw new Error\('暗記セットが見つかりません'\)/, '削除済みセットを無限ローディングにしない');
assert.match(detailSource, /setLoadError\(caught instanceof Error/, 'セット詳細の読込失敗を保持する');
assert.match(detailSource, /const runAction = async[\s\S]*?catch \(caught\)[\s\S]*?toast/, 'セット編集・削除の保存失敗を未処理にしない');
assert.match(detailSource, /role="alert"[\s\S]*?暗記セットを開けませんでした[\s\S]*?再読み込み/, 'セット詳細に読込失敗と再試行を表示する');

assert.match(homeSource, /repository\.loadSnapshot\(\)[\s\S]*?\.catch\(\(caught\) => \{[\s\S]*?setSnapshotError/, '暗記ホームのスナップショット読込失敗を処理する');
assert.match(homeSource, /createMemorySet[\s\S]*?catch \(caught\)[\s\S]*?暗記セットを作成できませんでした/, 'セット作成失敗を利用者へ通知する');
assert.match(homeSource, /!snapshot && snapshotError[\s\S]*?role="alert"[\s\S]*?再読み込み/, '初回読込失敗で空画面にせず再試行を出す');
assert.match(homeSource, /createSimpleStudySession[\s\S]*?await refresh\(\);[\s\S]*?requestSync\(true\)[\s\S]*?navigate\(\{ name: 'study'/, 'ホームから作成した学習セッションを即時同期してから学習画面へ進む');
assert.match(setupSource, /createSimpleStudySession[\s\S]*?await refresh\(\);[\s\S]*?requestSync\(true\)[\s\S]*?navigate\(\{ name: 'study'/, '学習設定から作成したセッションも即時同期してから学習画面へ進む');

assert.match(studySource, /const mounted = useRef\(true\)/, '学習画面の生存状態を追跡する');
assert.match(studySource, /const activeSessionId = useRef\(sessionId\)[\s\S]*?activeSessionId\.current = sessionId/, '同じ画面インスタンス内で切り替わった現在セッションを追跡する');
assert.match(studySource, /const actionInFlight = useRef\(false\)/, 'Reactの再描画前でも回答操作を排他できる同期ロックを持つ');
assert.match(studySource, /const actionToken = useRef\(0\)/, 'セッション切替後の古い操作を識別する世代トークンを持つ');
assert.match(studySource, /const requestSyncSafely = \(force: boolean\) => \{[\s\S]*?requestSync\(force\)\.catch/, '暗記学習の同期失敗を明示的に吸収する');

assert.match(contextSource, /IndexedDBを開けない場合だけ暗記機能全体のエラーにする/, '端末データ初期化と同期失敗を別の状態として扱う');
assert.match(contextSource, /const requestSync = useCallback\([\s\S]*?catch \(caught\)[\s\S]*?const failure = classifiedSyncFailure\(caught\)/, '同期前のIndexedDB読込失敗も共通分類する');
assert.match(contextSource, /const syncInFlight = useRef<Promise<void> \| null>\(null\)/, '同期中Promiseを保持して多重実行を判定する');

assert.match(conflictsSource, /const \[loading, setLoading\] = useState\(true\)/, '同期差分の初回読込中を空状態と区別する');
assert.match(conflictsSource, /const \[loadError, setLoadError\] = useState<string>\(\)/, '同期差分の読込失敗を保持する');
assert.match(conflictsSource, /role="status" aria-live="polite" aria-busy="true"[\s\S]*同期差分を読み込んでいます/, '同期差分の読込中を支援技術へ通知する');
assert.match(conflictsSource, /loadError && conflicts\.length === 0[\s\S]*role="alert"[\s\S]*再読み込み/, '初回読込失敗を空状態にせず再試行を提示する');
assert.match(conflictsSource, /const loadInFlightRef = useRef\(false\)/, '同期差分の追加読込をsingle-flightで保護する');
assert.match(conflictsSource, /repositoryRef\.current !== actionRepository \|\| loadGenerationRef\.current !== generation/, '旧repositoryの読込結果を現在画面へ反映しない');
assert.match(conflictsSource, /disabled=\{busy \|\| loadingMore\}[\s\S]*aria-busy=\{loadingMore\}/, '追加読込中の多重実行を防ぎ状態を通知する');
assert.match(conflictsSource, /toast\('サーバー版を採用しました'\)[\s\S]*requestSync\(true\)\.catch[\s\S]*refreshAfterResolution/, '競合解決成功を一覧再読込失敗と分離する');
assert.doesNotMatch(conflictsSource, /useEffect\(\(\) => \{ setNextCursor\(undefined\); void load\(false\); \}/, '未処理Promiseで初回競合読込を開始する旧実装へ戻さない');

assert.match(
  backupRestoreSource,
  /catch \(caught\) \{\n\s+if \(!isCurrentAction\(\)\) return;[\s\S]*?安全側で再送します/,
  'receipt確認失敗時も旧repositoryの復元操作を即時中止する',
);
assert.match(
  backupRestoreSource,
  /if \(!isCurrentAction\(\)\) return;\n\s+await actionRepository\.replaceFromBackup/,
  '破壊的な完全置換の直前にrepositoryとtokenを再確認する',
);
assert.match(
  backupRestoreSource,
  /catch \(caught\) \{\n\s+if \(!isCurrentAction\(\)\) return;[\s\S]*?console\.warn[\s\S]*?break;/,
  '同一ownerのreceipt失敗では安全側再送として復元を継続する',
);
assert.match(
  backupRestoreSource,
  /let receiptCommitWarning = false;[\s\S]*?commitSyncResponse[\s\S]*?catch \(caught\) \{[\s\S]*?if \(!isCurrentAction\(\)\) return;[\s\S]*?receiptCommitWarning = true;/,
  '全件置換後のreceipt反映失敗を復元本体の失敗と分離する',
);
assert.match(
  backupRestoreSource,
  /receiptCommitWarning[\s\S]*?requestSync\(true\)/,
  'receipt反映失敗でも通常同期へ進む',
);
assert.match(
  backupRestoreSource,
  /receiptCommitWarning[\s\S]*?回答履歴の同期状態を再確認しています/,
  'receipt反映失敗を部分成功として通知する',
);
assert.match(
  backupRestoreSource,
  /receiptCommitWarning[\s\S]*?skipped > 0[\s\S]*?既存の回答\$\{skipped\}件は再送を省略/,
  'receipt反映成功時の既存回答スキップ表示を維持する',
);
assert.match(
  backupRestoreSource,
  /let refreshWarning = false;[\s\S]*?await refresh\(\);[\s\S]*?catch \(caught\) \{[\s\S]*?if \(!isCurrentAction\(\)\) return;[\s\S]*?refreshWarning = true;/,
  '全件置換後の一覧更新失敗を復元本体の失敗と分離する',
);
assert.match(
  backupRestoreSource,
  /refreshWarning[\s\S]*?画面を更新できませんでした。アプリを再読み込みしてください[\s\S]*?receiptCommitWarning/,
  '一覧更新失敗を通常成功やreceipt警告より優先して通知する',
);
assert.match(
  backupRestoreSource,
  /refreshWarning[\s\S]*?requestSync\(true\)/,
  '一覧更新失敗でも通常同期へ進む',
);

assert.match(materialsSource, /class MemoryFeatureBoundary extends Component/, '暗記機能だけを囲うErrorBoundaryを持つ');
assert.match(materialsSource, /getDerivedStateFromError[\s\S]*componentDidCatch/, '暗記chunk・描画失敗を境界内で捕捉して診断する');
assert.match(materialsSource, /useMemo\(createMemoryFeatureComponent, \[memoryFeatureVersion\]\)/, '再試行時にrejected lazy Promiseを再利用せずimporterを作り直す');
assert.match(materialsSource, /暗記機能を再読み込み[\s\S]*教材へ戻る/, '暗記だけ再試行する操作と通常教材へ戻る操作を提供する');
assert.match(materialsSource, /Failed to fetch dynamically imported module[\s\S]*アプリを更新/, 'chunk hash不一致が疑われる場合だけ全体更新導線を示す');
assert.match(materialsSource, /<MemoryFeatureBoundary[\s\S]*<Suspense[\s\S]*<MemoryFeature \/>/, 'Suspenseとlazy失敗を暗記領域内へ閉じ込める');

console.log('✅ memory resilience and feature-boundary contracts passed');
