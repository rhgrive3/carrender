import fs from 'node:fs';

const cleanup = fs.readFileSync(new URL('../src/lib/safeObjectUrlCleanup.ts', import.meta.url), 'utf8');
const pwa = fs.readFileSync(new URL('../src/lib/pwa.ts', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/screens/SettingsSheet.tsx', import.meta.url), 'utf8');

for (const token of [
  "window.setTimeout(() => nativeRevoke(url), delayMs)",
  "const INSTALL_FLAG = Symbol.for('studycommander.safeObjectUrlCleanup')",
  'if (target[INSTALL_FLAG]) return',
  'installSafeObjectUrlCleanup();',
]) {
  if (!cleanup.includes(token)) throw new Error(`safe cleanup contract missing: ${token}`);
}

if (!pwa.startsWith("import './safeObjectUrlCleanup';")) {
  throw new Error('safe object URL cleanup must install before the app mounts');
}

const immediateRevokes = settings.match(/^\s*URL\.revokeObjectURL\(url\);\s*$/gm) ?? [];
if (immediateRevokes.length < 3) {
  throw new Error('fixture no longer covers the three immediate main export cleanup paths');
}

console.log('main download lifecycle contract: ok');
