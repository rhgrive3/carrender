import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/fixedBottomNavigationGuard.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /nav\.classList\.contains\('bottom-nav'\)[\s\S]*nav\.classList\.add\('bottom-nav'\)/,
  '固定ナビの必須classを削除されても復元する',
);
assert.match(
  source,
  /nav\.getAttribute\('data-layout-contract'\) !== FIXED_NAV_CONTRACT[\s\S]*nav\.setAttribute\('data-layout-contract', FIXED_NAV_CONTRACT\)/,
  '固定契約属性そのものを削除されても復元する',
);
assert.match(
  source,
  /observedNav\?\.isConnected\s*&&\s*observedNav\.parentElement === document\.body\) return observedNav/,
  'classと契約属性の両方から外れた監視中ナビも復旧対象として保持する',
);
assert.match(
  source,
  /body > \[data-runtime-pinned="true"\]/,
  '監視参照を失っても固定済みナビをclassに依存せず再発見する',
);
assert.match(
  source,
  /attributeFilter: \['style', 'class', 'data-layout-contract'\]/,
  'class削除を検知して固定契約を復元する',
);
assert.match(
  source,
  /if \(fixedInvariantsMatch\(nav, offset\)\) return false;/,
  '固定契約が正常なscroll frameではinline styleとobserverを触らない',
);
assert.match(
  source,
  /function importantStyleMatches[\s\S]*getPropertyPriority\(invariant\.property\) === 'important'/,
  '値だけでなくimportant優先度も含めて固定契約の正常性を判定する',
);
assert.match(
  source,
  /function setImportantStyle[\s\S]*if \(importantStyleMatches\(nav, invariant\)\) return;/,
  '修復時も一致している個別styleを重複書込みしない',
);
assert.match(
  source,
  /navAttributeObserver\?\.disconnect\(\);[\s\S]*applyFixedInvariants\(nav, offset\);[\s\S]*observeNavAttributes\(nav\);/,
  '実際の修復時だけobserverを一時停止して監視ループを作らない',
);

console.log('✅ bottom navigation class, contract and idempotent repair passed');
