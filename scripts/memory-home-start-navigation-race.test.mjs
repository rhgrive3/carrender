import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const mountedRef = useRef\(false\)[\s\S]*const startActionTokenRef = useRef\(0\)[\s\S]*useEffect\(\(\) => \{[\s\S]*mountedRef\.current = true;[\s\S]*return \(\) => \{[\s\S]*mountedRef\.current = false;[\s\S]*startActionTokenRef\.current \+= 1;[\s\S]*startInFlight\.current = false;[\s\S]*\};[\s\S]*\}, \[\]\)/u,
  '暗記ホーム離脱時に開始処理の操作トークンと排他状態を無効化する',
);
assert.match(
  source,
  /const repositoryRef = useRef\(repository\)[\s\S]*useLayoutEffect\(\(\) => \{[\s\S]*repositoryRef\.current = repository;[\s\S]*startActionTokenRef\.current \+= 1;[\s\S]*startInFlight\.current = false;[\s\S]*setStartingSetId\(undefined\);[\s\S]*setSnapshot\(null\);[\s\S]*setSnapshotError\(undefined\);[\s\S]*setQuery\(''\);[\s\S]*setCreateSetOpen\(false\);[\s\S]*setConflictsOpen\(false\);[\s\S]*\}, \[repository\]\)/u,
  '所有者切替時に旧開始トークン・snapshot・検索・ダイアログ・開始状態を描画前に破棄する',
);
assert.match(
  source,
  /const targetRepository = repository;[\s\S]*const actionToken = startActionTokenRef\.current \+ 1;[\s\S]*startActionTokenRef\.current = actionToken;[\s\S]*repository: targetRepository/u,
  '開始処理は開始時のrepositoryと操作トークンを固定する',
);
assert.match(
  source,
  /createSimpleStudySession\([\s\S]*if \(!mountedRef\.current \|\| repositoryRef\.current !== targetRepository \|\| startActionTokenRef\.current !== actionToken\) return;[\s\S]*await refresh\(\);[\s\S]*if \(!mountedRef\.current \|\| repositoryRef\.current !== targetRepository \|\| startActionTokenRef\.current !== actionToken\) return;[\s\S]*navigate\(\{ name: 'study', sessionId: created\.session\.id \}\)/u,
  '離脱・所有者切替・後続開始後に古い処理から更新や学習画面遷移を行わない',
);
assert.match(
  source,
  /catch \(caught\) \{[\s\S]*repositoryRef\.current === targetRepository && startActionTokenRef\.current === actionToken[\s\S]*toast/u,
  '古い開始失敗を現在画面へ通知しない',
);
assert.match(
  source,
  /finally \{[\s\S]*if \(startActionTokenRef\.current === actionToken\) \{[\s\S]*startInFlight\.current = false;[\s\S]*setStartingSetId\(undefined\)[\s\S]*\}/u,
  '古い開始処理のfinallyが新しい開始処理の排他状態を解除しない',
);

console.log('memory home owner/start action token race contract: ok');
