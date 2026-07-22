import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [study, polish] = await Promise.all([
  readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/memory-study-polish.css', import.meta.url), 'utf8'),
]);

assert.match(study, /examplesForSense\(bundle, sense\.id, \{ verifiedOnly: true \}\)/, '確認済み例文だけを学習画面へ出す');
assert.match(study, /revealed && examples\.length > 0[\s\S]*?<section className="card memory-study-examples" role="region" aria-labelledby="memory-study-examples-title">/, '答え表示後だけ見出し付き例文regionを表示する');
assert.match(study, /<h2 id="memory-study-examples-title">例文<\/h2><span>\{examples\.length\}件<\/span>/, '例文の見出しと件数を明示する');
assert.match(study, /<li key=\{example\.id\}><span lang="en">\{example\.english\}<\/span>\{example\.japanese && <small>\{example\.japanese\}<\/small>\}<\/li>/, '英語例文と日本語訳を同じ項目として表示する');

const shellEnd = study.indexOf('</article>\n        </div>');
const examplesAt = study.indexOf('className="card memory-study-examples"');
const assessmentAt = study.indexOf('className="memory-simple-assessment"', examplesAt);
assert.equal(shellEnd >= 0 && shellEnd < examplesAt && examplesAt < assessmentAt, true, '答えカードの外、自己評価の前へ例文を配置する');

const backFaceStart = study.indexOf('className="memory-study-card-face memory-study-card-back"');
const backFaceEnd = study.indexOf('</div>\n            </div>\n          </article>', backFaceStart);
const backFace = study.slice(backFaceStart, backFaceEnd);
assert.equal(backFace.includes('memory-example-list'), false, 'カード内部のスクロール奥へ例文を二重表示しない');

assert.match(polish, /\.memory-study-examples \{[\s\S]*width: min\(760px, 100%\)[\s\S]*flex: 0 0 auto/, '例文欄を学習stageの独立ブロックとして配置する');
assert.match(polish, /\.memory-study-examples li \{[\s\S]*display: grid[\s\S]*line-height: 1\.55/, '複数例文を読みやすい縦一覧にする');
assert.match(polish, /data-card-side='answer'[\s\S]*overflow-y: auto/, '答え・例文・評価へ外側の縦スクロールで到達できる');

console.log('✅ memory answer example review contracts passed');
