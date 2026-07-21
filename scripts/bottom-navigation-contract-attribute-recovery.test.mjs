import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/fixedBottomNavigationGuard.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /nav\.setAttribute\('data-layout-contract', FIXED_NAV_CONTRACT\)/,
  '固定契約属性そのものを削除されても復元する',
);
assert.match(
  source,
  /observedNav\?\.isConnected[\s\S]*observedNav\.parentElement === document\.body[\s\S]*classList\.contains\('bottom-nav'\)/,
  '厳密selectorから外れた監視中ナビを復旧対象として保持する',
);
assert.match(
  source,
  /body > \.bottom-nav\[data-runtime-pinned="true"\]/,
  '監視参照を失っても固定済みナビを再発見する',
);
assert.match(
  source,
  /navAttributeObserver\?\.disconnect\(\);[\s\S]*applyFixedInvariants\(nav, offset\);[\s\S]*observeNavAttributes\(nav\);/,
  'ガード自身の契約属性復元で監視ループを作らない',
);

console.log('✅ bottom navigation contract attribute recovery passed');
