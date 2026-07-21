import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/fixedBottomNavigationGuard.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /nav\.classList\.add\('bottom-nav'\)/,
  '固定ナビの必須classを削除されても復元する',
);
assert.match(
  source,
  /nav\.setAttribute\('data-layout-contract', FIXED_NAV_CONTRACT\)/,
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
  /navAttributeObserver\?\.disconnect\(\);[\s\S]*applyFixedInvariants\(nav, offset\);[\s\S]*observeNavAttributes\(nav\);/,
  'ガード自身のclass・契約属性復元で監視ループを作らない',
);

console.log('✅ bottom navigation class and contract attribute recovery passed');
