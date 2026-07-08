// オンボーディング完走テスト
// 事前に別ターミナルで `npm run pages:dev` を起動しておくこと(/api がないと動きません)
import { chromium } from 'playwright';
import { registerTestUser } from './_dev-auth-helper.mjs';

const OUT = process.env.SHOT_DIR ?? '/tmp/shots';
const BASE = 'http://localhost:8788/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await registerTestUser(page, BASE);

// Step1: 目標
await page.fill('#ob-goal', '共通テスト本番');
await page.getByRole('button', { name: '次へ' }).click();
// Step2: 科目
await page.getByRole('button', { name: '数学', exact: true }).click();
await page.getByRole('button', { name: '英語', exact: true }).click();
await page.getByRole('button', { name: /次へ\(2科目\)/ }).click();
// Step3: 時間
await page.getByRole('button', { name: '次へ' }).click();
// Step4: 教材を1つ追加
await page.getByRole('button', { name: '＋ 教材を追加' }).click();
await page.fill('#ob-mname-0', '基礎問題精講');
await page.fill('#ob-mtotal-0', '150');
await page.screenshot({ path: `${OUT}/ob-step4.png` });
await page.getByRole('button', { name: '🚀 計画を自動生成する' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/ob-result.png` });

const body = await page.textContent('body');
console.log('目標表示:', body.includes('共通テスト本番') ? 'OK' : 'NG');
console.log('タスク生成:', body.includes('基礎問題精講') ? 'OK' : 'NG');

// リロードしてもデータが残るか
await page.reload();
await page.waitForTimeout(1200);
const body2 = await page.textContent('body');
console.log('リロード後もデータ保持:', body2.includes('共通テスト本番') ? 'OK' : 'NG');

await browser.close();
