import assert from 'node:assert/strict';
import { analyzeSource } from './semantic-lint-core.mjs';

function rules(source, filename = 'fixture.tsx') {
  return analyzeSource(filename, source).map((item) => item.rule);
}

assert.ok(rules(`
  export function Bad({ enabled }) {
    if (enabled) useEffect(() => {}, []);
    return null;
  }
`).includes('react-hooks-conditional'), '条件付きHookを検出する');

assert.ok(rules(`
  export function Bad({ value }) {
    useEffect(() => console.log(value), []);
    return null;
  }
`).includes('react-hooks-deps'), 'Hook依存配列の不足を検出する');

assert.ok(rules(`
  async function save() {}
  export function run() { save(); }
`, 'fixture.ts').includes('no-floating-promise'), 'floating Promiseを検出する');

assert.ok(rules(`export const Bad = () => <img src="/x.png" />;`).includes('jsx-img-alt'), 'imgのalt不足を検出する');
assert.ok(rules(`export const Bad = () => <button>保存</button>;`).includes('jsx-button-type'), 'button type不足を検出する');
assert.ok(rules(`export const Bad = () => <div onClick={() => {}}>開く</div>;`).includes('jsx-click-keyboard'), '非buttonのkeyboard不足を検出する');

const good = rules(`
  export function Good({ value }) {
    useEffect(() => console.log(value), [value]);
    return <button type="button"><img src="/x.png" alt="例" /></button>;
  }
`);
assert.deepEqual(good, [], '正しいHook・Promise・JSXを拒否しない');

console.log('✅ semantic lint fixtures passed');
