import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');
const dialogStart = source.indexOf('function CreateSetDialog');
const homeStart = source.indexOf('export function MemoryHome');
assert.ok(dialogStart >= 0 && homeStart > dialogStart, '暗記セット作成ダイアログを取得できる');
const dialog = source.slice(dialogStart, homeStart);

assert.match(
  dialog,
  /const mountedRef = useRef\(false\)[\s\S]*const repositoryRef = useRef\(repository\)[\s\S]*const actionTokenRef = useRef\(0\)/u,
  '暗記セット作成は所有者と操作世代を追跡する',
);
assert.match(
  dialog,
  /useEffect\(\(\) => \{[\s\S]*mountedRef\.current = true;[\s\S]*return \(\) => \{[\s\S]*mountedRef\.current = false;[\s\S]*actionTokenRef\.current \+= 1;[\s\S]*saveInFlight\.current = false;[\s\S]*\};[\s\S]*\}, \[\]\)/u,
  '暗記セット作成ダイアログ離脱時に進行中操作を無効化する',
);
assert.match(
  dialog,
  /useLayoutEffect\(\(\) => \{[\s\S]*repositoryRef\.current = repository;[\s\S]*actionTokenRef\.current \+= 1;[\s\S]*saveInFlight\.current = false;[\s\S]*setSaving\(false\);[\s\S]*setName\(''\);[\s\S]*\}, \[repository\]\)/u,
  '所有者切替時は旧入力・busy状態・操作世代を描画前に破棄する',
);
assert.match(dialog, /const targetRepository = repository;[\s\S]*const actionToken = actionTokenRef\.current \+ 1/u, '保存開始時の所有者と操作世代を固定する');
assert.match(
  dialog,
  /await createMemorySet\(targetRepository, \{ name: name\.trim\(\) \}\);[\s\S]*if \(!mountedRef\.current \|\| repositoryRef\.current !== targetRepository \|\| actionTokenRef\.current !== actionToken\) return;[\s\S]*await refresh\(\)/u,
  '旧所有者の作成完了から現在所有者の一覧を更新しない',
);
assert.match(
  dialog,
  /if \(!mountedRef\.current \|\| repositoryRef\.current !== targetRepository \|\| actionTokenRef\.current !== actionToken\) return;[\s\S]*void requestSync\(true\)\.catch\(\(\) => undefined\);[\s\S]*onClose\(\)/u,
  '旧所有者の作成完了から現在所有者を同期したりダイアログを閉じたりしない',
);
assert.match(
  dialog,
  /catch \(caught\) \{[\s\S]*mountedRef\.current && repositoryRef\.current === targetRepository && actionTokenRef\.current === actionToken[\s\S]*toast/u,
  '離脱・所有者切替後に古い作成失敗を現在画面へ通知しない',
);
assert.match(
  dialog,
  /finally \{[\s\S]*if \(actionTokenRef\.current === actionToken\) \{[\s\S]*saveInFlight\.current = false;[\s\S]*mountedRef\.current && repositoryRef\.current === targetRepository[\s\S]*setSaving\(false\)/u,
  '古い作成処理のfinallyから新しい所有者の保存ロックを解除しない',
);
assert.match(dialog, /<fieldset disabled=\{saving\} aria-busy=\{saving\}>/u, '保存中はセット名入力を固定する');
assert.match(dialog, /aria-busy=\{saving\}/u, '保存ボタンは処理中状態を支援技術へ伝える');

console.log('memory create set owner/unmount race contract: ok');
