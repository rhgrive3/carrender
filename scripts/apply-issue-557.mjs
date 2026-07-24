import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/features/memory/ui/MemoryImportExport.tsx';
let source = await readFile(path, 'utf8');
const replacements = [
  ["    const actionSetId = targetSetId;\n    try {\n      const result = await importParsedRows({\n        repository,\n", "    const actionRepository = repository;\n    const actionSetId = targetSetId;\n    try {\n      const result = await importParsedRows({\n        repository: actionRepository,\n"],
  ["      });\n      await refreshAfterSave();\n      requestSyncSafely();\n      if (!mountedRef.current) return;\n      toast(`${result.imported}件を保存しました", "      });\n      if (!isCurrentRepository(actionRepository)) return;\n      await refreshAfterSave();\n      if (!isCurrentRepository(actionRepository)) return;\n      requestSyncSafely();\n      toast(`${result.imported}件を保存しました"],
  ["    } catch (caught) {\n      if (mountedRef.current) toast(caught instanceof Error ? caught.message : '取込に失敗しました');\n", "    } catch (caught) {\n      if (isCurrentRepository(actionRepository)) toast(caught instanceof Error ? caught.message : '取込に失敗しました');\n"],
  ["    if (!beginSave()) return;\n    const actionDocument = selectedSetDocument;\n", "    if (!beginSave()) return;\n    const actionRepository = repository;\n    const actionDocument = selectedSetDocument;\n"],
  ["      const result = await importSelectedSetExport({\n        repository,\n", "      const result = await importSelectedSetExport({\n        repository: actionRepository,\n"],
  ["      });\n      await refreshAfterSave();\n      requestSyncSafely();\n      if (!mountedRef.current) return;\n      toast(`${result.imported}件を取り込みました", "      });\n      if (!isCurrentRepository(actionRepository)) return;\n      await refreshAfterSave();\n      if (!isCurrentRepository(actionRepository)) return;\n      requestSyncSafely();\n      toast(`${result.imported}件を取り込みました"],
  ["    } catch (caught) {\n      if (mountedRef.current) toast(caught instanceof Error ? caught.message : '選択セットJSONを取り込めませんでした');\n", "    } catch (caught) {\n      if (isCurrentRepository(actionRepository)) toast(caught instanceof Error ? caught.message : '選択セットJSONを取り込めませんでした');\n"],
];
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`missing patch segment: ${before.slice(0, 48)}`);
  source = source.replace(before, after);
}
await writeFile(path, source);

const testPath = 'scripts/memory-import-save-resilience.test.mjs';
let test = await readFile(testPath, 'utf8');
test = test.replace(
  "assert.match(source, /if \\(!mountedRef\\.current\\) return;[\\s\\S]*navigate/u, '離脱後の古い保存完了で画面遷移しない');",
  "assert.match(source, /if \\(!isCurrentRepository\\(actionRepository\\)\\) return;[\\s\\S]*navigate/u, '離脱・owner切替後の古い保存完了で画面遷移しない');",
);
const anchor = "assert.doesNotMatch(source, /await refresh\\(\\);\\s*void requestSync\\(true\\);/u, '保存後処理を旧構造へ戻さない');\n";
const checks = "assert.match(source, /const saveImport = async[\\s\\S]*const actionRepository = repository;[\\s\\S]*repository: actionRepository[\\s\\S]*if \\(!isCurrentRepository\\(actionRepository\\)\\) return;[\\s\\S]*await refreshAfterSave\\(\\);[\\s\\S]*if \\(!isCurrentRepository\\(actionRepository\\)\\) return;[\\s\\S]*requestSyncSafely\\(\\)/u, '通常取込は旧repository完了後の副作用を止める');\nassert.match(source, /const saveSelectedSetImport = async[\\s\\S]*const actionRepository = repository;[\\s\\S]*repository: actionRepository[\\s\\S]*if \\(!isCurrentRepository\\(actionRepository\\)\\) return;[\\s\\S]*await refreshAfterSave\\(\\);[\\s\\S]*if \\(!isCurrentRepository\\(actionRepository\\)\\) return;[\\s\\S]*requestSyncSafely\\(\\)/u, '選択セット取込も旧repository完了後の副作用を止める');\n";
if (!test.includes(checks)) {
  if (!test.includes(anchor)) throw new Error('test anchor missing');
  test = test.replace(anchor, anchor + checks);
}
await writeFile(testPath, test);
