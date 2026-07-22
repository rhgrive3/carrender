import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/cards/TaskRow.tsx', import.meta.url), 'utf8');
const completedTaskGuard = await readFile(new URL('../src/lib/completedTaskAccessibility.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

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

test('completed week tasks are restored to the keyboard order as read-only dialog triggers', () => {
  assert.match(completedTaskGuard, /button\.disabled = false/);
  assert.match(completedTaskGuard, /dataset\.completedTaskReadable = 'true'/);
  assert.match(completedTaskGuard, /setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(completedTaskGuard, /完了済み、詳細を開く/);
});

test('completed tasks use the same read-only dialog from week and day detail views', () => {
  assert.match(completedTaskGuard, /WEEK_TASK_SELECTOR/);
  assert.match(completedTaskGuard, /DETAIL_TASK_SELECTOR/);
  assert.match(completedTaskGuard, /openCompletedTaskDialog\(weekTaskSummary/);
  assert.match(completedTaskGuard, /openCompletedTaskDialog\(detailTaskSummary/);
  assert.match(completedTaskGuard, /このタスクは完了済みのため、計画からは変更できません/);
});

test('completed task dialog exposes navigation, close, Escape, and focus restoration', () => {
  assert.match(completedTaskGuard, /role', 'dialog'/);
  assert.match(completedTaskGuard, /aria-modal', 'true'/);
  assert.match(completedTaskGuard, /学習ログを開く/);
  assert.match(completedTaskGuard, /event\.key !== 'Escape'/);
  assert.match(completedTaskGuard, /returnFocus\.focus\(\)/);
});

test('completed task accessibility guard is installed at application startup', () => {
  assert.match(main, /import \{ installCompletedTaskAccessibility \} from '\.\/lib\/completedTaskAccessibility'/);
  assert.match(main, /installCompletedTaskAccessibility\(\);/);
});
