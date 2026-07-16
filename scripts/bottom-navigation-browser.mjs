import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const contractCss = await readFile(new URL('../src/styles/layoutContracts.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
const viewports = [
  { label: 'iPhone portrait', width: 390, height: 844 },
  { label: 'iPhone landscape', width: 844, height: 390 },
  { label: 'iPad portrait', width: 820, height: 1180 },
  { label: 'iPad landscape', width: 1180, height: 820 },
];

const tolerance = 1.5;

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    await page.setContent(`<!doctype html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
          <style>
            :root { --nav-height: 62px; }
            * { box-sizing: border-box; }
            html, body { margin: 0; min-height: 100%; }
            body { min-width: 320px; }
            #root {
              height: 100vh;
              overflow: auto;
              transform: translateZ(0);
              filter: brightness(1);
              perspective: 1000px;
              contain: layout paint;
            }
            #app-main-content {
              min-height: 240vh;
              overflow: hidden;
              transform: translateY(0);
              contain: paint;
            }
            .window-spacer { height: 180vh; }
            .bottom-nav {
              background: #111827;
              border-top: 1px solid #374151;
            }
            ${contractCss}
          </style>
        </head>
        <body>
          <div id="root">
            <main id="app-main-content">
              <div class="app-shell">scroll content</div>
            </main>
          </div>
          <div class="window-spacer" aria-hidden="true"></div>
          <nav class="bottom-nav" data-layout-contract="fixed-bottom-navigation">
            <button type="button">今日</button>
            <button type="button">計画</button>
            <button type="button">教材</button>
            <button type="button">記録</button>
            <button type="button">分析</button>
          </nav>
        </body>
      </html>`);

    const readLayout = () => page.locator('.bottom-nav').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        parentTag: element.parentElement?.tagName,
        position: style.position,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    const before = await readLayout();
    assert.equal(before.parentTag, 'BODY', `${viewport.label}: nav is a direct body child`);
    assert.equal(before.position, 'fixed', `${viewport.label}: nav uses fixed positioning`);
    assert.equal(before.display, 'flex', `${viewport.label}: nav stays rendered`);
    assert.equal(before.visibility, 'visible', `${viewport.label}: nav stays visible`);
    assert.equal(before.opacity, '1', `${viewport.label}: nav stays opaque`);
    assert.ok(Math.abs(before.viewportHeight - before.bottom) <= tolerance, `${viewport.label}: nav touches viewport bottom`);
    assert.ok(before.left >= -tolerance, `${viewport.label}: nav does not overflow left`);
    assert.ok(before.right <= before.viewportWidth + tolerance, `${viewport.label}: nav does not overflow right`);
    assert.ok(before.width <= Math.min(before.viewportWidth, 760) + tolerance, `${viewport.label}: nav respects the viewport/max width`);

    await page.locator('#root').evaluate((element) => { element.scrollTop = 700; });
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(50);

    const after = await readLayout();
    assert.ok(Math.abs(after.viewportHeight - after.bottom) <= tolerance, `${viewport.label}: nav remains at viewport bottom after scrolling`);
    assert.ok(Math.abs(after.left - before.left) <= tolerance, `${viewport.label}: horizontal position does not move`);
    assert.ok(Math.abs(after.top - before.top) <= tolerance, `${viewport.label}: vertical position does not move`);
    assert.ok(Math.abs(after.width - before.width) <= tolerance, `${viewport.label}: width does not change while scrolling`);
    assert.ok(Math.abs(after.height - before.height) <= tolerance, `${viewport.label}: height does not change while scrolling`);

    await context.close();
  }

  console.log('✅ bottom navigation stays viewport-fixed on iPhone/iPad portrait and landscape');
} finally {
  await browser.close();
}
