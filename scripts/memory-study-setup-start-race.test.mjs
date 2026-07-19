import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryStudySetup.tsx', import.meta.url), 'utf8');

assert.match(source, /const mountedRef = useRef\(false\)/u, '画面のマウント状態を追跡する');
assert.match(source, /const startTokenRef = useRef\(0\)/u, '開始処理を一意のトークンで識別する');
assert.match(source, /repositoryRef\.current = repository/u, '現在の所有者リポジトリを追跡する');
assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*?startTokenRef\.current \+= 1;[\s\S]*?startInFlight\.current = false;[\s\S]*?setStarting\(false\);[\s\S]*?\}, \[repository\]\)/u,
  '所有者切替時に古い開始操作を無効化する',
);
assert.match(
  source,
  /const isCurrentAction = \(\) => mountedRef\.current[\s\S]*?repositoryRef\.current === actionRepository[\s\S]*?startTokenRef\.current === actionToken/u,
  '開始時と現在の画面・所有者・操作トークンが一致する場合だけ結果を反映する',
);
assert.match(source, /if \(isCurrentAction\(\)\) navigate/u, '離脱または所有者切替後に学習画面へ遷移しない');
assert.match(source, /catch \(caught\) \{[\s\S]*?if \(isCurrentAction\(\)\) toast/u, '古い開始失敗を現在画面へ通知しない');
assert.match(
  source,
  /finally \{[\s\S]*?if \(startTokenRef\.current === actionToken\)[\s\S]*?startInFlight\.current = false;[\s\S]*?if \(mountedRef\.current\) setStarting\(false\)/u,
  '古い処理のfinallyが新しい開始状態を解除しない',
);
assert.doesNotMatch(source, /navigate\(\{ name: 'study',[\s\S]*?\}\);\s*\} catch/u, '無条件の学習画面遷移へ戻さない');

console.log('memory study setup start race contract: ok');
