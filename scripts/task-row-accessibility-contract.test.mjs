import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/cards/TaskRow.tsx', import.meta.url), 'utf8');

test('task card exposes a named article and heading', () => {
  assert.match(source, /<article[\s\S]*aria-labelledby=\{titleId\}/);
  assert.match(source, /id=\{titleId\}[\s\S]*role="heading"[\s\S]*aria-level=\{3\}/);
});

test('task card exposes status and details to assistive technology', () => {
  assert.match(source, /aria-describedby=\{`\$\{detailsId\} \$\{statusId\}`\}/);
  assert.match(source, /id=\{statusId\}>\{isDone \? '完了済み' : ownsActiveTimer \? '計測中' : '未完了'\}<\/span>/);
});

test('task actions are grouped and buttons declare their type', () => {
  assert.match(source, /role="group" aria-label=\{`\$\{task\.title\}の操作`\}/);
  assert.equal((source.match(/<button type="button"/g) ?? []).length, 4);
});

test('visible task date is machine-readable', () => {
  assert.match(source, /<time className="task-time" dateTime=\{task\.scheduledDate\}>/);
});
