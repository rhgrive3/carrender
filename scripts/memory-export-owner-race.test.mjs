import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryImportExport.tsx', import.meta.url), 'utf8');

assert.match(source, /const \[exporting, setExporting\] = useState\(false\)/u, '出力中状態を明示する');
assert.match(source, /const exportInFlightRef = useRef\(false\)/u, '出力を同期ロックでsingle-flight化する');
assert.match(source, /repositoryRef\.current = repository/u, '現在の所有者リポジトリを追跡する');
assert.match(source, /isCurrentRepository[\s\S]*repositoryRef\.current === actionRepository/u, '開始時と現在のリポジトリが一致する場合だけ結果を反映する');
assert.match(source, /const exportAi = async[\s\S]*await actionRepository\.loadContent\(\);[\s\S]*if \(!isCurrentRepository\(actionRepository\)\) return;[\s\S]*downloadJson/u, 'AI用JSONは所有者切替後にダウンロードしない');
assert.match(source, /const exportSelectedSet = async[\s\S]*await actionRepository\.loadSnapshot\(\);[\s\S]*if \(!isCurrentRepository\(actionRepository\)\) return;[\s\S]*createSelectedSetExport/u, '選択セットは所有者切替後にダウンロードしない');
assert.match(source, /const exportBackup = async[\s\S]*await actionRepository\.exportAll\(\);[\s\S]*if \(!isCurrentRepository\(actionRepository\)\) return;[\s\S]*createFullMemoryBackup/u, '完全バックアップは所有者切替後にダウンロードしない');
assert.match(source, /<section className="memory-import" aria-busy=\{busy\}>/u, '出力中状態を画面全体へ通知する');
assert.match(source, /<fieldset disabled=\{exporting\} className="memory-export-grid">/u, '出力中は対象や統計条件を変更できない');

console.log('memory export owner race contract: ok');
