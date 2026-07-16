import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');

assert.match(source, /const \[reloadKey, setReloadKey\] = useState\(0\)/, '暗記学習の再読込状態を保持する');
assert.match(source, /setSession\(undefined\);[\s\S]*?setBundle\(undefined\);[\s\S]*?setLoadError\(undefined\)/, '再読込前に古いセッション・内容・エラーを消す');
assert.match(source, /\[navigate, refresh, reloadKey, repository, sessionId\]/, '再読込操作でセッション読込effectを再実行する');
assert.match(source, /role="alert"[\s\S]*?セッションを開けませんでした[\s\S]*?再読み込み[\s\S]*?setReloadKey/, '読込失敗時に理由と再試行導線を表示する');
assert.match(source, /再読み込み[\s\S]*?暗記ホームへ戻る/, '再試行できない恒久エラーではホームへ戻れる');

console.log('✅ memory study retry contract passed');
