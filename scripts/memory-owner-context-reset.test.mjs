import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8');

assert.match(source, /import \{[^}]*useLayoutEffect[^}]*\} from 'react'/u, '所有者切替の描画前リセットにuseLayoutEffectを使う');
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{[\s\S]*?activeRepository\.current = null;[\s\S]*?syncInFlight\.current = null;[\s\S]*?syncForceQueued\.current = false;[\s\S]*?setRepository\(null\);[\s\S]*?setReady\(false\);[\s\S]*?setError\(null\);[\s\S]*?setSyncStatus\('idle'\);[\s\S]*?setSyncError\(null\);[\s\S]*?setView\(\{ name: 'home' \}\);[\s\S]*?setSets\(\[\]\);[\s\S]*?setActiveSession\(null\);[\s\S]*?setPendingCount\(0\);[\s\S]*?setConflictCount\(0\);[\s\S]*?\}, \[owner\]\)/u,
  '所有者切替時に旧repositoryを切り離し、ready状態・画面・一覧・セッション・同期状態を描画前に破棄する',
);

console.log('memory owner context reset regression test passed');
