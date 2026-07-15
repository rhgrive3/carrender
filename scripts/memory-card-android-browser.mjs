import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseCss = await readFile(new URL('../src/styles/memory-card-ux.css', import.meta.url), 'utf8');
const androidFixCss = await readFile(new URL('../src/styles/memory-android-flip-fix.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
    userAgent: 'Mozilla/5.0 (Linux; Android 12; CPH2309) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  await page.setContent(`<!doctype html>
    <html><head><style>
      :root { --bg: #0b0f1a; --bg-elev1: #131a2b; --border-strong: #33405f; --text: #eef2ff; }
      * { box-sizing: border-box; }
      ${baseCss}
      ${androidFixCss}
    </style></head><body>
      <div class="memory-simple-study">
        <div class="memory-study-flip-shell">
          <article class="memory-study-card memory-simple-study-card">
            <div class="memory-study-card-inner">
              <button class="memory-study-card-face memory-study-card-front" type="button">question</button>
              <button class="memory-study-card-face memory-study-card-back" type="button">answer</button>
            </div>
          </article>
        </div>
      </div>
      <script>
        document.querySelector('.memory-study-card-front').addEventListener('click', () => {
          document.querySelector('.memory-study-card').classList.add('revealed');
        });
      </script>
    </body></html>`);

  const readFrame = () => page.locator('.memory-study-card-inner').evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = new DOMMatrix(style.transform);
    const cardStyle = getComputedStyle(element.closest('.memory-study-card'));
    return {
      m11: matrix.m11,
      transform: style.transform,
      transitionDuration: style.transitionDuration,
      cardAnimationName: cardStyle.animationName,
    };
  });

  const before = await readFrame();
  await page.locator('.memory-study-card-front').click();
  await page.waitForTimeout(170);
  const middle = await readFrame();
  await page.waitForTimeout(520);
  const after = await readFrame();

  assert.notEqual(before.transitionDuration, '0s', 'Android mobile context keeps a non-zero flip transition');
  assert.equal(before.cardAnimationName, after.cardAnimationName, 'revealing the answer does not rebuild the parent animation layer');
  assert.ok(before.m11 > 0.95, `front starts unrotated: ${before.transform}`);
  assert.ok(Math.abs(middle.m11) < 0.95, `Android renders an intermediate flip frame: ${middle.transform}`);
  assert.ok(after.m11 < -0.95, `answer finishes at 180 degrees: ${after.transform}`);

  await context.close();
  console.log('✅ Android memory-card flip animation has intermediate frames');
} finally {
  await browser.close();
}
