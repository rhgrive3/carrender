import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*?if \(!open\) return;[\s\S]*?setAmountDone\(\(current\) => Math\.min\(remainingAmount, Math\.max\(0, current\)\)\);[\s\S]*?\}, \[open, remainingAmount, selectedMaterialId\]\);/,
  '教材や科目の変更で入力上限が下がった場合、表示中の記録量も保存可能量へ同期する',
);

assert.match(
  source,
  /<NumericInput[\s\S]*?value=\{amountDone\}[\s\S]*?max=\{remainingAmount\}[\s\S]*?onChange=\{setAmountDone\}/,
  '記録量入力は補正済みstateと同じ上限を利用する',
);

console.log('✅ record input limit sync contract passed');
