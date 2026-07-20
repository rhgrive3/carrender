import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryImportExport.tsx', import.meta.url), 'utf8');
const feature = await readFile(new URL('../src/features/memory/ui/MemoryFeature.tsx', import.meta.url), 'utf8');

assert.match(source, /useRef\(false\)[\s\S]*saveInFlightRef/u, '取込保存は同期ロックで多重実行を防ぐ');
assert.match(source, /const refreshAfterSave = async[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*catch/u, '保存成功後の一覧更新失敗を取込失敗から分離する');
assert.match(source, /requestSync\(true\)\.catch/u, '同期要求の失敗を未処理にしない');
assert.match(source, /if \(!mountedRef\.current\) return;[\s\S]*navigate/u, '離脱後の古い保存完了で画面遷移しない');
assert.match(source, /const busy = saving \|\| exporting \|\| aiInspecting/u, '保存・出力・AI差分確認の共通処理中状態を持つ');
assert.match(source, /<section className="memory-import" aria-busy=\{busy\}>/u, '取込画面全体の処理中状態を支援技術へ伝える');
assert.match(source, /<fieldset disabled=\{saving\}/u, '保存中は取込内容と保存先を変更できない');
assert.match(source, /aria-label="戻る" disabled=\{busy\}/u, '保存・出力・AI差分確認中の画面離脱を防ぐ');
assert.doesNotMatch(source, /await refresh\(\);\s*void requestSync\(true\);/u, '保存後処理を旧構造へ戻さない');
assert.match(source, /fileReadGenerationRef = useRef<Record<TextFileTarget, number>>/u, '取込ファイル読込は対象別の世代を持つ');
assert.match(source, /const generation = fileReadGenerationRef\.current\[target\] \+ 1;[\s\S]*fileReadGenerationRef\.current\[target\] !== generation/u, '古いファイル読込結果を現在入力へ反映しない');
assert.match(source, /invalidateTextFileRead\('import'\); setText/u, '手入力後に古い取込ファイルで上書きしない');
assert.match(source, /invalidateTextFileRead\('ai'\); invalidateAiInspection\(\); setAiText/u, 'AI差分の手入力後に古いJSONと古い確認結果で上書きしない');
assert.match(source, /fileReadGenerationRef\.current\.import \+= 1;[\s\S]*fileReadGenerationRef\.current\.ai \+= 1/u, '画面離脱時に進行中のファイル読込を無効化する');
assert.match(source, /const \[aiInspecting, setAiInspecting\] = useState\(false\)/u, 'AI差分確認専用の処理中状態を持つ');
assert.match(source, /aiInspectInFlightRef = useRef\(false\)[\s\S]*aiInspectionGenerationRef = useRef\(0\)/u, 'AI差分確認は同期ロックと世代を持つ');
assert.match(source, /const actionRepository = repository;\s*const sourceText = aiText;[\s\S]*const generation = aiInspectionGenerationRef\.current \+ 1/u, '確認開始時のrepositoryと入力JSONを固定する');
assert.match(source, /const isCurrentAiInspection[\s\S]*aiInspectionGenerationRef\.current === generation[\s\S]*repositoryRef\.current === actionRepository/u, '現在の所有者と操作世代が一致する場合だけ確認結果を反映する');
assert.match(source, /finally \{\s*if \(isCurrentAiInspection\(generation, actionRepository\)\) \{[\s\S]*setAiInspecting\(false\)/u, '古い確認処理のfinallyが新しい処理中状態を解除しない');
assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*aiInspectionGenerationRef\.current \+= 1;[\s\S]*setAiPreview\(undefined\)/u, 'repository切替時に古いAI差分確認を描画前に破棄する');
assert.match(source, /if \(target === 'ai'\) invalidateAiInspection\(\);/u, '別のAI差分ファイルを選んだ時点で旧プレビューを無効化する');
assert.match(source, /aiPreviewSourceRef\.current = \{ repository: actionRepository, text: sourceText \}/u, 'プレビュー生成元のrepositoryとJSONを記録する');
assert.match(source, /previewSource\.repository !== repository \|\| previewSource\.text !== aiText/u, '保存前に現在入力とプレビュー生成元の一致を確認する');
assert.match(source, /<fieldset disabled=\{saving \|\| aiInspecting\} aria-busy=\{saving \|\| aiInspecting\}/u, 'AI差分確認中は入力・ファイル選択・追加操作を固定する');
assert.match(source, /aria-busy=\{aiInspecting\}[\s\S]*\{aiInspecting \? '確認中…' : '差分を確認'\}/u, 'AI差分確認中であることを表示し支援技術へ伝える');
assert.doesNotMatch(source, /previewAiImport\(aiText, await repository\.loadContent\(\)\)/u, '入力stateを非同期完了時に直接参照する旧確認処理へ戻さない');

assert.match(feature, /const repositoryKeys = new WeakMap<object, string>\(\)/u, 'repositoryインスタンスごとに画面世代を識別する');
assert.match(feature, /const \{ view, repository \} = useMemory\(\)/u, '暗記画面が現在のrepositoryを所有者境界として参照する');
assert.match(feature, /<Fragment key=\{repositoryScreenKey\(repository\)\}>/u, '所有者切替時に旧画面をアンマウントして進行中の非同期UI反映を無効化する');

console.log('memory import save resilience contract: ok');
