import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const mountedRef = useRef\(false\)[\s\S]*useEffect\(\(\) => \{[\s\S]*mountedRef\.current = true;[\s\S]*return \(\) => \{[\s\S]*mountedRef\.current = false;[\s\S]*startInFlight\.current = false;[\s\S]*\};[\s\S]*\}, \[\]\)/u,
  '暗記ホーム離脱時に開始処理を無効化する',
);
assert.match(
  source,
  /const repositoryRef = useRef\(repository\)[\s\S]*repositoryRef\.current = repository;[\s\S]*startInFlight\.current = false;[\s\S]*setStartingSetId\(undefined\);[\s\S]*\}, \[repository\]\)/u,
  '所有者切替時に進行中の開始表示と排他状態を破棄する',
);
assert.match(
  source,
  /const targetRepository = repository;[\s\S]*repository: targetRepository/u,
  '開始処理は開始時のrepositoryを固定する',
);
assert.match(
  source,
  /if \(mountedRef\.current && repositoryRef\.current === targetRepository\) navigate\(\{ name: 'study', sessionId: created\.session\.id \}\)/u,
  '離脱または所有者切替後に古いセッション作成完了から学習画面へ遷移しない',
);
assert.match(
  source,
  /catch \(caught\) \{[\s\S]*if \(mountedRef\.current && repositoryRef\.current === targetRepository\) toast/u,
  '離脱または所有者切替後に古い開始失敗を現在画面へ通知しない',
);
assert.match(
  source,
  /finally \{[\s\S]*startInFlight\.current = false;[\s\S]*if \(mountedRef\.current && repositoryRef\.current === targetRepository\) setStartingSetId\(undefined\)/u,
  '離脱または所有者切替後に古い開始処理から状態を更新しない',
);

console.log('memory home start navigation race contract: ok');
