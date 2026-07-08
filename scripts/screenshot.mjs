// UI確認用スクリーンショット (iPhone幅390px + iPad幅820px)
// 事前に別ターミナルで `npm run pages:dev` を起動しておくこと(/api がないと動きません)
import { chromium } from 'playwright';
import { registerTestUser } from './_dev-auth-helper.mjs';

const OUT = process.env.SHOT_DIR ?? '/tmp/shots';
const BASE = 'http://localhost:8788/';

const browser = await chromium.launch();

async function shoot(width, height, suffix) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/login-${suffix}.png` });
  await registerTestUser(page, BASE);
  await page.screenshot({ path: `${OUT}/onboarding-${suffix}.png` });

  // デモデータ開始
  await page.getByText('まずはデモデータで試す').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/today-${suffix}.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/today-full-${suffix}.png`, fullPage: true });

  for (const [label, name] of [
    ['計画', 'plan'],
    ['教材', 'materials'],
    ['記録', 'records'],
    ['分析', 'analytics'],
  ]) {
    await page.locator('.bottom-nav button', { hasText: label }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${name}-${suffix}.png`, fullPage: true });
  }

  // タイマー起動 (今日タブ → 今すぐ開始)
  await page.locator('.bottom-nav button', { hasText: '今日' }).click();
  await page.waitForTimeout(400);
  const startBtn = page.getByText('今すぐ開始');
  if (await startBtn.count()) {
    await startBtn.first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/timer-${suffix}.png` });
    // 終了 → 記録シート
    await page.getByText('終了して記録').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/record-${suffix}.png` });
  }

  // ライトモード確認 (設定 → ライト)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/record-light-${suffix}.png` });

  await page.close();
}

await shoot(390, 844, 'iphone');
await shoot(820, 1180, 'ipad');
await browser.close();
console.log('done');
