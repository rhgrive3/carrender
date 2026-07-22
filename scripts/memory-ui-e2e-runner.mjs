import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('./memory-ui-e2e.mjs', import.meta.url);
const generatedUrl = new URL('./.memory-ui-e2e.generated.mjs', import.meta.url);
const passwordFill = "  await page.getByLabel('パスワード', { exact: true }).fill('memory-ui-password');";
const confirmationFill = "  await page.getByLabel('パスワード（確認）', { exact: true }).fill('memory-ui-password');";
const legacyExampleCheck = `  const answerFace = page.getByRole('button', { name: '問題に戻る' });
  const firstExample = answerFace.getByText('Take the delay into account.', { exact: true });
  const secondExample = answerFace.getByText('We must allow for traffic.', { exact: true });
  const firstTranslation = answerFace.getByText('遅れを考慮に入れてください。', { exact: true });
  const secondTranslation = answerFace.getByText('交通事情を考慮しなければならない。', { exact: true });`;
const exampleRegionCheck = `  const exampleRegion = page.getByRole('region', { name: '例文' });
  const firstExample = exampleRegion.getByText('Take the delay into account.', { exact: true });
  const secondExample = exampleRegion.getByText('We must allow for traffic.', { exact: true });
  const firstTranslation = exampleRegion.getByText('遅れを考慮に入れてください。', { exact: true });
  const secondTranslation = exampleRegion.getByText('交通事情を考慮しなければならない。', { exact: true });`;

const source = await readFile(sourceUrl, 'utf8');
assert.equal(source.includes(passwordFill), true, 'registration password step must exist in memory UI E2E');
assert.equal(source.includes(legacyExampleCheck), true, 'legacy answer-face example assertion must exist exactly once before generation');
const generated = source
  .replace(passwordFill, `${passwordFill}\n${confirmationFill}`)
  .replace(legacyExampleCheck, exampleRegionCheck);
assert.notEqual(generated, source, 'registration confirmation and example-region contracts must be injected');
assert.equal(generated.includes(legacyExampleCheck), false, 'generated E2E must not look for examples inside the answer button');
assert.equal(generated.includes(exampleRegionCheck), true, 'generated E2E must verify the visible example region');

try {
  await writeFile(generatedUrl, generated, 'utf8');
  await import(generatedUrl.href);
} finally {
  await rm(generatedUrl, { force: true });
}
