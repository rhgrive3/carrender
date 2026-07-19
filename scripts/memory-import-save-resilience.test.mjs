import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryImportExport.tsx', import.meta.url), 'utf8');

assert.match(source, /useRef\(false\)[\s\S]*saveInFlightRef/u, '取込保存は同期ロックで多重実行を防ぐ');
assert.match(source, /const refreshAfterSave = async[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*catch/u, '保存成功後の一覧更新失敗を取込失敗から分離する');
assert.match(source, /requestSync\(true\)\.catch/u, '同期要求の失敗を未処理にしない');
assert.match(source, /if \(!mountedRef\.current\) return;[\s\S]*navigate/u, '離脱後の古い保存完了で画面遷移しない');
assert.match(source, /const busy = saving \|\| exporting/u, '保存と出力の共通処理中状態を持つ');
assert.match(source, /<section className="memory-import" aria-busy=\{busy\}>/u, '取込画面全体の処理中状態を支援技術へ伝える');
assert.match(source, /<fieldset disabled=\{saving\}/u, '保存中は取込内容と保存先を変更できない');
assert.match(source, /aria-label="戻る" disabled=\{busy\}/u, '保存または出力中の画面離脱を防ぐ');
assert.doesNotMatch(source, /await refresh\(\);\s*void requestSync\(true\);/u, '保存後処理を旧構造へ戻さない');

console.log('memory import save resilience contract: ok');
