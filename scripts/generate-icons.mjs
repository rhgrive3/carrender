// Generates PWA icons (PNG) from an inline SVG using sharp.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f7cff"/>
      <stop offset="1" stop-color="#9a5cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${pad ? 0 : 116}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${pad ? 0.72 : 1}) translate(-256 -256)">
    <!-- target rings -->
    <circle cx="256" cy="256" r="150" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="26"/>
    <circle cx="256" cy="256" r="92" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="22"/>
    <circle cx="256" cy="256" r="38" fill="#ffffff"/>
    <!-- clock hand -->
    <rect x="244" y="120" width="24" height="150" rx="12" fill="#0b0f1a"/>
    <circle cx="256" cy="256" r="20" fill="#0b0f1a"/>
  </g>
</svg>`;

writeFileSync(outDir + 'icon.svg', svg(false));

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true]
];

for (const [name, size, maskable] of jobs) {
  await sharp(Buffer.from(svg(maskable))).resize(size, size).png().toFile(outDir + name);
  console.log('generated', name);
}
