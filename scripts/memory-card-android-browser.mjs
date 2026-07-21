import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseCss = await readFile(new URL('../src/styles/memory-card-ux.css', import.meta.url), 'utf8');
const androidFixCss = await readFile(new URL('../src/styles/memory-android-flip-fix.css', import.meta.url), 'utf8');
const polishCss = await readFile(new URL('../src/styles/memory-study-polish.css', import.meta.url), 'utf8');
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
      :root {
        --bg: #0b0f1a;
        --bg-elev1: #131a2b;
        --border: #29334a;
        --border-strong: #33405f;
        --text: #eef2ff;
      }
      * { box-sizing: border-box; }
      .memory-study-stage { overflow-y: auto; }
      ${baseCss}
      ${androidFixCss}
      ${polishCss}
    </style></head><body>
      <div class="memory-simple-study">
        <div class="memory-study-stage">
          <div class="memory-study-flip-shell">
            <article class="memory-study-card memory-simple-study-card" data-card-side="question">
              <div class="memory-study-card-inner">
                <button class="memory-study-card-face memory-study-card-front" type="button">question</button>
                <button class="memory-study-card-face memory-study-card-back" type="button">answer</button>
              </div>
            </article>
          </div>
          <div class="memory-simple-assessment">
            <button class="memory-again" type="button"><span>まだ</span><small>もう一度</small></button>
            <button class="memory-partial" type="button"><span>あやしい</span><small>あとで確認</small></button>
            <button class="memory-good" type="button"><span>覚えた</span><small>次へ</small></button>
          </div>
        </div>
      </div>
      <script>
        const shell = document.querySelector('.memory-study-flip-shell');
        const card = document.querySelector('.memory-study-card');
        const inner = document.querySelector('.memory-study-card-inner');
        shell.addEventListener('click', () => {
          const nextRevealed = !card.classList.contains('revealed');
          card.classList.remove('flip-to-answer', 'flip-to-question');
          card.dataset.cardSide = nextRevealed ? 'answer' : 'question';
          if (nextRevealed) card.classList.add('revealed', 'flip-to-answer');
          else {
            card.classList.remove('revealed');
            card.classList.add('flip-to-question');
          }
        });
        inner.addEventListener('animationend', (event) => {
          if (event.animationName.startsWith('memory-card-android-flip-')) {
            card.classList.remove('flip-to-answer', 'flip-to-question');
          }
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
      innerAnimationName: style.animationName,
      cardAnimationName: cardStyle.animationName,
    };
  });

  const questionLayout = await page.evaluate(() => ({
    stageOverflowY: getComputedStyle(document.querySelector('.memory-study-stage')).overflowY,
    frontOverflowY: getComputedStyle(document.querySelector('.memory-study-card-front')).overflowY,
    shellTouchAction: getComputedStyle(document.querySelector('.memory-study-flip-shell')).touchAction,
  }));
  assert.equal(questionLayout.stageOverflowY, 'hidden', 'question stage must not scroll vertically');
  assert.equal(questionLayout.frontOverflowY, 'hidden', 'question card face must not become its own scroll area');
  assert.equal(questionLayout.shellTouchAction, 'none', 'question card must not hand a vertical pan to the browser');

  const palette = await page.evaluate(() => ['.memory-again', '.memory-partial'].map((selector) => {
    const style = getComputedStyle(document.querySelector(selector));
    return {
      backgroundImage: style.backgroundImage,
      color: style.color,
      borderStyle: style.borderTopStyle,
      borderColor: style.borderTopColor,
    };
  }));
  for (const entry of palette) {
    assert.match(entry.backgroundImage, /linear-gradient/u, 'secondary assessments keep a restrained tonal surface');
    assert.notEqual(entry.color, 'rgb(255, 255, 255)', 'secondary assessments must not use harsh white-on-saturated fills');
    assert.equal(entry.borderStyle, 'solid', 'secondary assessments retain a visible semantic outline');
  }
  assert.notEqual(palette[0].borderColor, palette[1].borderColor, 'まだ and あやしい remain distinguishable by hue');

  const shell = page.locator('.memory-study-flip-shell');
  const before = await readFrame();
  await shell.click();
  await page.waitForTimeout(170);
  const forwardMiddle = await readFrame();
  await page.waitForTimeout(520);
  const answer = await readFrame();

  const answerLayout = await page.evaluate(() => ({
    stageOverflowY: getComputedStyle(document.querySelector('.memory-study-stage')).overflowY,
    backOverflowY: getComputedStyle(document.querySelector('.memory-study-card-back')).overflowY,
    shellTouchAction: getComputedStyle(document.querySelector('.memory-study-flip-shell')).touchAction,
  }));
  assert.equal(answerLayout.stageOverflowY, 'auto', 'answer stage keeps scrolling for long answers and examples');
  assert.equal(answerLayout.backOverflowY, 'auto', 'answer card keeps its long-content fallback');
  assert.equal(answerLayout.shellTouchAction, 'pan-y', 'answer side restores normal vertical pan behavior');

  assert.notEqual(before.transitionDuration, '0s', 'Android mobile context keeps the CSS transition fallback');
  assert.equal(before.cardAnimationName, answer.cardAnimationName, 'revealing the answer does not rebuild the parent animation layer');
  assert.ok(before.m11 > 0.95, `front starts unrotated: ${before.transform}`);
  assert.match(forwardMiddle.innerAnimationName, /memory-card-android-flip-to-answer/u, 'Android uses the explicit forward keyframe');
  assert.ok(Math.abs(forwardMiddle.m11) < 0.95, `Android renders an intermediate forward frame: ${forwardMiddle.transform}`);
  assert.ok(answer.m11 < -0.95, `answer finishes at 180 degrees: ${answer.transform}`);

  // 3D面のhit testingへ依存せず、固定シェルへの実クリックで裏から表へ戻す。
  await shell.click();
  await page.waitForTimeout(170);
  const reverseMiddle = await readFrame();
  await page.waitForTimeout(520);
  const frontAgain = await readFrame();

  assert.match(reverseMiddle.innerAnimationName, /memory-card-android-flip-to-question/u, 'Android uses the explicit reverse keyframe');
  assert.ok(Math.abs(reverseMiddle.m11) < 0.95, `Android renders an intermediate reverse frame: ${reverseMiddle.transform}`);
  assert.ok(frontAgain.m11 > 0.95, `question finishes back at zero degrees: ${frontAgain.transform}`);

  await context.close();
  console.log('✅ Memory question scroll lock, tonal assessment colors, and Android flip behavior passed');
} finally {
  await browser.close();
}
