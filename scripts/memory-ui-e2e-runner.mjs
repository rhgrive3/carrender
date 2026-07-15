import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('./memory-ui-e2e.mjs', import.meta.url);
const generatedUrl = new URL('./.memory-ui-e2e.generated.mjs', import.meta.url);
const passwordFill = "  await page.getByLabel('パスワード', { exact: true }).fill('memory-ui-password');";
const confirmationFill = "  await page.getByLabel('パスワード（確認）', { exact: true }).fill('memory-ui-password');";

const source = await readFile(sourceUrl, 'utf8');
assert.equal(source.includes(passwordFill), true, 'registration password step must exist in memory UI E2E');
const generated = source.replace(passwordFill, `${passwordFill}\n${confirmationFill}`);
assert.notEqual(generated, source, 'registration confirmation step must be injected exactly once');

try {
  await writeFile(generatedUrl, generated, 'utf8');
  await import(generatedUrl.href);
} finally {
  await rm(generatedUrl, { force: true });
}
