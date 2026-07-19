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
  /if \(mountedRef\.current\) navigate\(\{ name: 'study', sessionId: created\.session\.id \}\)/u,
  '離脱後に古いセッション作成完了から学習画面へ遷移しない',
);
assert.match(
  source,
  /catch \(caught\) \{[\s\S]*if \(mountedRef\.current\) toast/u,
  '離脱後に古い開始失敗を現在画面へ通知しない',
);
assert.match(
  source,
  /finally \{[\s\S]*startInFlight\.current = false;[\s\S]*if \(mountedRef\.current\) setStartingSetId\(undefined\)/u,
  '離脱後にアンマウント済み画面の状態を更新しない',
);

console.log('memory home start navigation race contract: ok');
