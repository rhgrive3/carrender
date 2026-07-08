// ダークモード確認 + タイマー→記録フロー検証
// 事前に別ターミナルで `npm run pages:dev` を起動しておくこと(/api がないと動きません)
import { chromium } from 'playwright';
import { registerTestUser } from './_dev-auth-helper.mjs';

const OUT = process.env.SHOT_DIR ?? '/tmp/shots';
const BASE = 'http://localhost:8788/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await registerTestUser(page, BASE);
await page.getByText('まずはデモデータで試す').click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/dark-today.png` });

for (const [label, name] of [
  ['計画', 'plan'],
  ['教材', 'materials'],
  ['記録', 'records'],
  ['分析', 'analytics'],
]) {
  await page.locator('.bottom-nav button', { hasText: label }).click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/dark-${name}.png` });
}

// タイマー → 終了 → 記録シートが出るか(バグ修正の検証)
await page.locator('.bottom-nav button', { hasText: '今日' }).click();
await page.waitForTimeout(400);
await page.getByText('今すぐ開始').first().click();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/dark-timer.png` });
await page.getByText('終了して記録').click();
await page.waitForTimeout(700);
const sheetVisible = await page.locator('.sheet').count();
console.log('記録シート表示:', sheetVisible > 0 ? 'OK' : 'NG');
await page.screenshot({ path: `${OUT}/dark-record.png` });

// 保存して今日画面に反映されるか
await page.getByText('保存する').click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/dark-after-save.png` });
const bodyText = await page.textContent('body');
console.log('実績反映:', bodyText.includes('0分') ? '(要確認)' : 'OK');

await browser.close();
console.log('done');
