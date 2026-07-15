import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [entry, css] = await Promise.all([
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/ux-audit.css', import.meta.url), 'utf8'),
]);

assert.match(entry, /import '\.\/styles\/ux-audit\.css';/, 'UX audit stylesheet must be loaded by the app entry');
assert.match(css, /\.memory-sync-line > \.memory-inline-button:last-child\s*\{[^}]*min-width:\s*44px;/s, 'sync action must expose a 44px minimum width');
assert.match(css, /\.memory-sync-line > \.memory-inline-button:last-child\s*\{[^}]*min-height:\s*44px;/s, 'sync action must expose a 44px minimum height');
assert.match(css, /:focus-visible\s*\{[^}]*outline:/s, 'sync action must keep a visible keyboard focus indicator');

console.log('memory sync touch-target regression test passed');
