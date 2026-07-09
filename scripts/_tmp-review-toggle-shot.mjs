import { chromium } from 'playwright';
import { registerTestUser } from './_dev-auth-helper.mjs';

const base = 'http://localhost:8788';
const dir = process.env.SHOT_DIR ?? '.';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await registerTestUser(page, base);

// オンボーディングをデモデータでスキップできるか、画面を見て判断
await page.waitForTimeout(1200);
const demoBtn = page.getByText('デモデータ', { exact: false }).first();
if (await demoBtn.isVisible().catch(() => false)) {
  await demoBtn.click();
  await page.waitForTimeout(1200);
}

// 設定シートを開く
await page.getByRole('button', { name: /設定/ }).first().click().catch(async () => {
  await page.locator('[aria-label="設定"]').first().click();
});
await page.waitForTimeout(800);

// 「復習の自動生成」を開く
await page.getByText('復習の自動生成').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${dir}/settings-review-toggle-on.png` });

// オフにして再撮影
await page.getByText('完了した範囲の復習タスク', { exact: false }).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/settings-review-toggle-off.png` });

await browser.close();
console.log('done');
