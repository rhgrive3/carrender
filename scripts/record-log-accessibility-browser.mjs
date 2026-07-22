import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/recordLogAccessibilityGuard.ts', import.meta.url), 'utf8');
const executable = ts.transpileModule(
  `(() => {\n${source
    .replace(/export function normalizeRecordLogAccessibility/u, 'function normalizeRecordLogAccessibility')
    .replace(/export function installRecordLogAccessibilityGuard/u, 'function installRecordLogAccessibilityGuard')}\ninstallRecordLogAccessibilityGuard();\n})();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;

function textFromRefs(ids, nodes) {
  return ids.split(/\s+/u).map((id) => nodes[id] ?? '').filter(Boolean).join(' ');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await page.setContent(`<!doctype html><html><body>
    <div class="record-log-list">
      <div class="row spread"><span>7/22 (水)</span><span>1時間45分</span></div>
      <button class="task-card session-log-button" aria-label="英単語帳の記録を編集">
        <div class="task-main">
          <div class="task-meta-row"><span class="subject-chip">英語</span><span class="task-type-chip">タイマー</span></div>
          <div class="task-title">英単語帳</div>
          <div class="task-range">1時間 ・ 3ページ ・ 🔥4</div>
          <div class="faint mt-8">長いメモ本文は名称へ含めない</div>
        </div>
      </button>
      <button class="task-card session-log-button" aria-label="英単語帳の記録を編集">
        <div class="task-main">
          <div class="task-meta-row"><span class="subject-chip">英語</span><span class="task-type-chip">手入力</span></div>
          <div class="task-title">英単語帳</div>
          <div class="task-range">45分 ・ 2ページ</div>
        </div>
      </button>
    </div>
  </body></html>`);
  await page.addScriptTag({ content: executable });
  await page.waitForTimeout(80);

  const details = await page.locator('.session-log-button').evaluateAll((buttons) => buttons.map((button) => {
    const labelledBy = button.getAttribute('aria-labelledby') ?? '';
    const describedBy = button.getAttribute('aria-describedby') ?? '';
    const ids = [...new Set([...labelledBy.split(/\s+/u), ...describedBy.split(/\s+/u)].filter(Boolean))];
    return {
      ariaLabel: button.getAttribute('aria-label'),
      labelledBy,
      describedBy,
      nodes: Object.fromEntries(ids.map((id) => [id, document.getElementById(id)?.textContent?.trim() ?? ''])),
    };
  }));

  assert.equal(details.length, 2);
  for (const detail of details) {
    assert.equal(detail.ariaLabel, null, '子要素を上書きするaria-labelを除去する');
    assert.ok(detail.labelledBy, '教材名と編集操作をaria-labelledbyへ接続する');
    assert.ok(detail.describedBy, '記録詳細をaria-describedbyへ接続する');
    for (const id of [...detail.labelledBy.split(/\s+/u), ...detail.describedBy.split(/\s+/u)]) {
      assert.ok(detail.nodes[id], `ARIA参照先 ${id} が存在する`);
    }
  }

  const firstName = textFromRefs(details[0].labelledBy, details[0].nodes);
  const firstDescription = textFromRefs(details[0].describedBy, details[0].nodes);
  assert.equal(firstName, '英単語帳 記録を編集');
  assert.match(firstDescription, /7\/22 \(水\)/);
  assert.match(firstDescription, /英語/);
  assert.match(firstDescription, /タイマー/);
  assert.match(firstDescription, /1時間、3ページ、集中度 4/);
  assert.match(firstDescription, /メモあり/);
  assert.doesNotMatch(firstDescription, /長いメモ本文は名称へ含めない/, '長文メモ本文を読み上げ説明へ含めない');

  const secondName = textFromRefs(details[1].labelledBy, details[1].nodes);
  const secondDescription = textFromRefs(details[1].describedBy, details[1].nodes);
  assert.equal(secondName, '英単語帳 記録を編集');
  assert.match(secondDescription, /手入力/);
  assert.match(secondDescription, /45分、2ページ/);
  assert.notEqual(firstDescription, secondDescription, '同名教材でも時間・量・入力方法で区別できる');

  await page.locator('.session-log-button').first().evaluate((button) => {
    button.setAttribute('aria-label', '英単語帳の記録を編集');
    const range = button.querySelector('.task-range');
    if (range) range.textContent = '1時間15分 ・ 4ページ ・ 🔥5';
  });
  await page.waitForTimeout(80);
  const updated = await page.locator('.session-log-button').first().evaluate((button) => {
    const describedBy = button.getAttribute('aria-describedby') ?? '';
    return {
      ariaLabel: button.getAttribute('aria-label'),
      description: describedBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' '),
    };
  });
  assert.equal(updated.ariaLabel, null, '再描画でaria-labelが戻っても補修する');
  assert.match(updated.description, /1時間15分、4ページ、集中度 5/, '表示更新後の情報へ追従する');

  console.log('✅ same-title learning logs expose distinct accessible descriptions');
} finally {
  await browser.close();
}
