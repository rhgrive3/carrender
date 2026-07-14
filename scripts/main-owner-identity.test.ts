/// <reference types="node" />
import { resolveAppOwnerIdentity } from '../src/state/ownerIdentity';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

console.log('--- アカウント所有者境界 ---');
{
  const before = resolveAppOwnerIdentity({ id: 'stable-id', username: 'old-name' });
  const after = resolveAppOwnerIdentity({ id: 'stable-id', username: 'new-name' });
  check('暗記DBは安定IDを使い続ける', before.memoryOwner === after.memoryOwner && after.memoryOwner === 'stable-id', { before, after });
  check('予定データ所有者はユーザー名変更を反映', before.mainStateOwner !== after.mainStateOwner && after.mainStateOwner === 'new-name', { before, after });
  check('予定reducerの再マウント境界は保存先所有者と一致', before.mainStateProviderKey === before.mainStateOwner && after.mainStateProviderKey === after.mainStateOwner, { before, after });
}

if (failures > 0) {
  console.error(`\n${failures}件のアカウント所有者回帰テストが失敗`);
  process.exit(1);
}
console.log('\nアカウント所有者回帰テスト: OK');
