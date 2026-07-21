import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import ts from 'typescript';

const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const guardSource = await readFile(new URL('../src/lib/fixedBottomNavigationGuard.ts', import.meta.url), 'utf8');
const styleImports = [...mainSource.matchAll(/import '(\.\/styles\/[^']+\.css)';/gu)].map((match) => match[1]);
assert.equal(styleImports.at(-1), './styles/layoutContracts.css', 'fixed navigation contract must be the final app stylesheet');
assert.match(mainSource, /installFixedBottomNavigationGuard\(\);/u, 'runtime fixed-navigation guard must be installed before React renders');
const allStyles = (await Promise.all(styleImports.map((path) => readFile(new URL(`../src/${path.slice(2)}`, import.meta.url), 'utf8')))).join('\n');
const executableGuard = ts.transpileModule(
  `${guardSource.replace(/export function installFixedBottomNavigationGuard/u, 'function installFixedBottomNavigationGuard')}\ninstallFixedBottomNavigationGuard();`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } },
).outputText;

const browserName = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
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
          <style>${allStyles}</style>
        </head>
        <body>
          <div id="root">
            <main id="app-main-content">
              <div class="app-shell">
                <section class="screen"><div style="height:240vh">scroll content</div></section>
              </div>
            </main>
          </div>
          <nav class="bottom-nav" data-layout-contract="fixed-bottom-navigation" data-portal-target="document.body">
            <button type="button">今日</button>
            <button type="button">計画</button>
            <button type="button">教材</button>
            <button type="button">記録</button>
            <button type="button">振り返り</button>
          </nav>
        </body>
      </html>`);
    await page.addScriptTag({ content: executableGuard });

    const waitForPinnedState = () => page.waitForFunction(() => {
      const element = document.querySelector('.bottom-nav');
      if (!(element instanceof HTMLElement)) return false;
      return element.getAttribute('data-runtime-pinned') === 'true'
        && getComputedStyle(element).position === 'fixed';
    }, undefined, { timeout: 2_000 });

    await waitForPinnedState();

    const readLayout = () => page.locator('.bottom-nav').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visualViewport = window.visualViewport;
      return {
        parentTag: element.parentElement?.tagName,
        position: style.position,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        runtimePinned: element.getAttribute('data-runtime-pinned'),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportBottom: visualViewport
          ? visualViewport.offsetTop + visualViewport.height
          : window.innerHeight,
      };
    });

    const assertPinned = (layout, stage) => {
      assert.equal(layout.parentTag, 'BODY', `${browserName} ${viewport.label} ${stage}: nav is a direct body child`);
      assert.equal(layout.position, 'fixed', `${browserName} ${viewport.label} ${stage}: nav uses fixed positioning`);
      assert.equal(layout.display, 'flex', `${browserName} ${viewport.label} ${stage}: nav stays rendered`);
      assert.equal(layout.visibility, 'visible', `${browserName} ${viewport.label} ${stage}: nav stays visible`);
      assert.equal(layout.opacity, '1', `${browserName} ${viewport.label} ${stage}: nav stays opaque`);
      assert.equal(layout.runtimePinned, 'true', `${browserName} ${viewport.label} ${stage}: runtime guard owns the fixed contract`);
      assert.ok(Math.abs(layout.viewportBottom - layout.bottom) <= tolerance, `${browserName} ${viewport.label} ${stage}: nav touches visible viewport bottom`);
      assert.ok(layout.left >= -tolerance, `${browserName} ${viewport.label} ${stage}: nav does not overflow left`);
      assert.ok(layout.right <= layout.viewportWidth + tolerance, `${browserName} ${viewport.label} ${stage}: nav does not overflow right`);
      assert.ok(layout.width <= Math.min(layout.viewportWidth, 760) + tolerance, `${browserName} ${viewport.label} ${stage}: nav respects max width`);
    };

    const before = await readLayout();
    assertPinned(before, 'initial');

    await page.evaluate(() => window.scrollTo(0, 600));
    await waitForPinnedState();
    const afterScroll = await readLayout();
    assertPinned(afterScroll, 'after scroll');
    assert.ok(Math.abs(afterScroll.left - before.left) <= tolerance, `${browserName} ${viewport.label}: horizontal position does not move while scrolling`);

    await page.locator('.bottom-nav').evaluate((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.style.setProperty('position', 'absolute', 'important');
      element.style.setProperty('bottom', '96px', 'important');
      element.style.setProperty('transform', 'translateY(-24px)', 'important');
    });
    await waitForPinnedState();
    assertPinned(await readLayout(), 'after direct inline mutation');

    await page.addStyleTag({ content: '.bottom-nav { position:absolute !important; bottom:96px !important; transform:translateY(-24px) !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await waitForPinnedState();
    assertPinned(await readLayout(), 'after hostile late CSS');

    const resizedHeight = Math.max(360, viewport.height - 137);
    await page.setViewportSize({ width: viewport.width, height: resizedHeight });
    await waitForPinnedState();
    assertPinned(await readLayout(), 'after visual viewport resize');

    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await waitForPinnedState();
    assertPinned(await readLayout(), 'after orientation change');

    await context.close();
  }

  console.log(`✅ ${browserName} bottom navigation survives scrolling, direct mutations, hostile CSS, visual viewport resize and rotation on iPhone/iPad`);
} finally {
  await browser.close();
}
