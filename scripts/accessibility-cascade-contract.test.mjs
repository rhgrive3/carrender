import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const polish = readFileSync(new URL('../src/styles/accessibility-polish.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(
  polish,
  /@layer\s+overrides/,
  '既存CSSが非レイヤーのため、共通補正をレイヤー内へ戻してカスケード優先度を下げない',
);
assert.match(polish, /@media\s*\(orientation:\s*landscape\)[\s\S]*?\.screen[\s\S]*?safe-area-inset-left/);
assert.match(polish, /@media\s*\(orientation:\s*landscape\)[\s\S]*?\.screen[\s\S]*?safe-area-inset-right/);
assert.ok(
  main.indexOf("import './styles/accessibility-polish.css';")
    > main.indexOf("import './styles/global.css';"),
  '非レイヤー同士では共通補正をglobal.cssより後に読み込む',
);

console.log('✅ accessibility cascade contracts passed');
