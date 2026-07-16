import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [resultSource, detailSource, homeSource, studySource, contextSource] = await Promise.all([
  readFile(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8'),
]);

assert.match(resultSource, /if \(!loaded\) throw new Error\('学習結果が見つかりません'\)/, '削除済み・不明な結果を無限ローディングにしない');
assert.match(resultSource, /\.catch\(\(caught\) => \{[\s\S]*?setLoadError/, '結果読込のPromise拒否を画面状態へ反映する');
assert.match(resultSource, /role="alert"[\s\S]*?学習結果を開けませんでした[\s\S]*?再読み込み/, '結果読込失敗時に理由と再試行手段を表示する');

assert.match(detailSource, /if \(!next\.sets\[0\]\) throw new Error\('暗記セットが見つかりません'\)/, '削除済みセットを無限ローディングにしない');
assert.match(detailSource, /setLoadError\(caught instanceof Error/, 'セット詳細の読込失敗を保持する');
assert.match(detailSource, /const runAction = async[\s\S]*?catch \(caught\)[\s\S]*?toast/, 'セット編集・削除の保存失敗を未処理にしない');
assert.match(detailSource, /role="alert"[\s\S]*?暗記セットを開けませんでした[\s\S]*?再読み込み/, 'セット詳細に読込失敗と再試行を表示する');

assert.match(homeSource, /repository\.loadSnapshot\(\)[\s\S]*?\.catch\(\(caught\) => \{[\s\S]*?setSnapshotError/, '暗記ホームのスナップショット読込失敗を処理する');
assert.match(homeSource, /createMemorySet[\s\S]*?catch \(caught\)[\s\S]*?暗記セットを作成できませんでした/, 'セット作成失敗を利用者へ通知する');
assert.match(homeSource, /!snapshot && snapshotError[\s\S]*?role="alert"[\s\S]*?再読み込み/, '初回読込失敗で空画面にせず再試行を出す');

assert.match(studySource, /const mounted = useRef\(true\)/, '学習画面の生存状態を追跡する');
assert.match(studySource, /await refresh\(\);[\s\S]*?requestSync[\s\S]*?if \(!mounted\.current\) return;[\s\S]*?setSession/, '回答保存後は同期を維持しつつ、離脱済み画面へ状態を反映しない');
assert.match(studySource, /if \(mounted\.current\) toast/, '離脱後に古い学習画面のエラーToastを出さない');

assert.match(contextSource, /IndexedDBを開けない場合だけ暗記機能全体のエラーにする/, '端末データ初期化と同期失敗を別の状態として扱う');
assert.match(contextSource, /const requestSync = useCallback\(async[\s\S]*?catch \(caught\)[\s\S]*?setSyncStatus\(offline \? 'offline' : 'error'\)/, '同期前のIndexedDB読込失敗も未処理Promiseにしない');
assert.match(contextSource, /setSyncError\(caught instanceof Error \? caught\.message : '暗記データを同期できませんでした'\)/, '起動時の同期失敗を端末データの致命エラーと分離する');

console.log('✅ memory resilience contracts passed');
