import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function cssBlock(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が見つかる`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `${selector} の開始波括弧が見つかる`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`${selector} の終了波括弧が見つからない`);
}

function variables(block) {
  return new Map([...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [match[1], match[2].trim()]));
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  assert.ok(rgba, `色 ${value} を解析できる`);
  return {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

function composite(foreground, background) {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function luminance(color) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function requireContrast(themeName, theme, foregroundKey, backgroundKey, minimum = 4.5) {
  const foreground = parseColor(theme.get(foregroundKey));
  const background = parseColor(theme.get(backgroundKey));
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${themeName} ${foregroundKey}/${backgroundKey} のコントラスト ${ratio.toFixed(2)} は ${minimum}:1 以上`);
}

function requireSoftContrast(themeName, theme, foregroundKey, softKey, minimum = 4.5) {
  const foreground = parseColor(theme.get(foregroundKey));
  const base = parseColor(theme.get('bg-elev1'));
  const softSurface = composite(parseColor(theme.get(softKey)), base);
  const ratio = contrast(foreground, softSurface);
  assert.ok(ratio >= minimum, `${themeName} ${foregroundKey}/${softKey} のコントラスト ${ratio.toFixed(2)} は ${minimum}:1 以上`);
}

const tokens = read('src/styles/tokens.css');
const dark = variables(cssBlock(tokens, ':root {'));
const light = variables(cssBlock(tokens, ":root[data-theme='light']"));

requireContrast('dark', dark, 'text-faint', 'bg-elev2');
requireContrast('light', light, 'text-faint', 'bg');
for (const [themeName, theme] of [['dark', dark], ['light', light]]) {
  for (const tone of ['accent', 'ok', 'warn', 'danger']) {
    requireSoftContrast(themeName, theme, tone, `${tone}-soft`);
  }
}

const layoutContract = read('src/styles/layoutContracts.css');
assert.match(layoutContract, /padding-left:\s*env\(safe-area-inset-left/);
assert.match(layoutContract, /padding-right:\s*env\(safe-area-inset-right/);
assert.match(layoutContract, /position:\s*fixed\s*!important/);
assert.match(layoutContract, /bottom:\s*0\s*!important/);

const polish = read('src/styles/accessibility-polish.css');
const landscapeBlock = cssBlock(polish, '@media (orientation: landscape)');
const landscapeScreenBlock = cssBlock(landscapeBlock, '.screen');
const timerBlock = cssBlock(polish, '.timer-overlay');
const sheetBlock = cssBlock(polish, '.sheet-backdrop');
assert.match(landscapeScreenBlock, /padding-left:\s*max\([^\n]*safe-area-inset-left/);
assert.match(landscapeScreenBlock, /padding-right:\s*max\([^\n]*safe-area-inset-right/);
assert.match(timerBlock, /safe-area-inset-left/);
assert.match(timerBlock, /safe-area-inset-right/);
assert.match(sheetBlock, /safe-area-inset-left/);
assert.match(sheetBlock, /safe-area-inset-right/);
assert.match(polish, /prefers-reduced-motion:\s*reduce[\s\S]*scroll-behavior:\s*auto/);
assert.match(polish, /forced-colors:\s*active/);

const toast = read('src/components/ui/Toast.css');
const toastRegion = cssBlock(toast, '.app-toast-region');
assert.match(toastRegion, /left:\s*max\([^\n]*safe-area-inset-left/);
assert.match(toastRegion, /right:\s*max\([^\n]*safe-area-inset-right/);
assert.doesNotMatch(toastRegion, /left:\s*50%/);

const main = read('src/main.tsx');
const polishImport = main.indexOf("import './styles/accessibility-polish.css';");
const featureFixImport = main.indexOf("import './styles/record-chart-fixes.css';");
assert.ok(polishImport > featureFixImport, '共通アクセシビリティ補正は画面別CSSより後に読み込む');

const indexHtml = read('index.html');
const viteConfig = read('vite.config.ts');
assert.match(indexHtml, /name="theme-color" content="#0c111d"/);
assert.match(indexHtml, /prefers-reduced-motion:\s*reduce/);
assert.match(viteConfig, /theme_color:\s*'#0c111d'/);
assert.match(viteConfig, /background_color:\s*'#0c111d'/);

console.log('✅ UI visual accessibility contracts passed');
