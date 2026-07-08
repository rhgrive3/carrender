// 開発用スクリプト共通ヘルパー: ログイン画面を突破して新規アカウントを作る
// (wrangler pages dev で /api が動いている前提。 npm run pages:dev を別ターミナルで起動しておくこと)
export async function registerTestUser(page, base) {
  await page.goto(base);
  await page.waitForTimeout(800);
  await page.locator('.segmented button', { hasText: '新規登録' }).click();
  const username = `devtest${Date.now()}`.slice(0, 20);
  await page.fill('#auth-username', username);
  await page.fill('#auth-password', 'devtestpass');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1200);
  return username;
}
