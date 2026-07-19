import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');
const dialogStart = source.indexOf('function CreateSetDialog');
const homeStart = source.indexOf('export function MemoryHome');
assert.ok(dialogStart >= 0 && homeStart > dialogStart, '暗記セット作成ダイアログを取得できる');
const dialog = source.slice(dialogStart, homeStart);

assert.match(
  dialog,
  /const mountedRef = useRef\(false\)[\s\S]*useEffect\(\(\) => \{[\s\S]*mountedRef\.current = true;[\s\S]*return \(\) => \{[\s\S]*mountedRef\.current = false;[\s\S]*saveInFlight\.current = false;[\s\S]*\};[\s\S]*\}, \[\]\)/u,
  '暗記セット作成ダイアログ離脱時に進行中操作を無効化する',
);
assert.match(dialog, /if \(mountedRef\.current\) onClose\(\)/u, '離脱後に古い作成完了からダイアログを閉じない');
assert.match(dialog, /catch \(caught\) \{[\s\S]*if \(mountedRef\.current\) toast/u, '離脱後に古い作成失敗を現在画面へ通知しない');
assert.match(dialog, /finally \{[\s\S]*saveInFlight\.current = false;[\s\S]*if \(mountedRef\.current\) setSaving\(false\)/u, '離脱後にアンマウント済みダイアログのstateを更新しない');

console.log('memory create set unmount race contract: ok');
