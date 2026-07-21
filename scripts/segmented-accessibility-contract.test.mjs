import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/bits.tsx', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../src/lib/radiogroupKeyboardGuard.ts', import.meta.url), 'utf8');
const material = readFileSync(new URL('../src/components/materials/MaterialFormSheet.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const segmented = source.match(/export function Segmented<[\s\S]*?\n}\n\nexport function EmptyState/)?.[0] ?? '';

assert.ok(segmented, '共通Segmentedコンポーネントが見つかる');
assert.match(segmented, /role="radiogroup"[\s\S]*aria-orientation="horizontal"/, '横方向の選択グループであることを公開する');
assert.match(segmented, /tabIndex=\{value === o\.value \? 0 : -1\}/, '選択中の項目だけをTab停止位置にする');
assert.match(segmented, /ArrowRight[\s\S]*ArrowDown[\s\S]*ArrowLeft[\s\S]*ArrowUp/, '方向キーで前後の項目へ移動できる');
assert.match(segmented, /event\.key === 'Home'[\s\S]*event\.key === 'End'/, 'HomeとEndで先頭・末尾へ移動できる');
assert.match(segmented, /event\.preventDefault\(\)[\s\S]*onChange\(next\.value\)[\s\S]*target\?\.focus\(\)/, '選択変更とフォーカス移動を同期する');
assert.match(segmented, /data-segment-value=\{o\.value\}/, '移動先を安定して特定する');

assert.match(material, /role="radiogroup" aria-label="周回"/, '教材の周回選択をradiogroupとして公開する');
assert.match(guard, /const selected = radios\.find\([\s\S]*radio\.tabIndex = radio === selected \? 0 : -1/, '不完全なradiogroupも選択中だけをTab停止位置へ修復する');
assert.match(guard, /ArrowRight[\s\S]*ArrowDown[\s\S]*ArrowLeft[\s\S]*ArrowUp[\s\S]*Home[\s\S]*End/, '全radiogroupへ方向キーとHome・Endを補完する');
assert.match(guard, /event\.preventDefault\(\)[\s\S]*next\.click\(\)[\s\S]*next\.focus\(\)/, 'キーボード移動でReactの選択処理とフォーカスを同期する');
assert.match(guard, /attributeFilter: \['aria-checked', 'disabled', 'role'\]/, 'React再描画後もroving tabindexを再正規化する');
assert.match(main, /installRadiogroupKeyboardGuard\(\);/, 'アプリ起動時に共有radiogroupガードを有効化する');

console.log('✅ Segmented and repaired radiogroup accessibility contracts passed');
