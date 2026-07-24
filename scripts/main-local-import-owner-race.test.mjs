import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/screens/SettingsSheet.tsx', 'utf8');
assert.match(source, /const importGenerationRef = useRef\(0\)/u);
assert.match(source, /const importOwnerRef = useRef\(user\?\.id \?\? null\)/u);
assert.match(source, /importGenerationRef\.current \+= 1;[\s\S]{0,120}importReaderRef\.current\?\.abort\(\)/u);
assert.match(source, /importReaderRef\.current\?\.abort\(\);[\s\S]{0,160}const generation = importGenerationRef\.current \+ 1/u);
assert.match(source, /const isCurrentImport = \(\) => importGenerationRef\.current === generation[\s\S]{0,160}importOwnerRef\.current === capturedOwnerId[\s\S]{0,100}importOpenRef\.current/u);
assert.match(source, /reader\.onload = \(\) => \{[\s\S]{0,80}if \(!isCurrentImport\(\)\) return;[\s\S]{0,360}dispatch\(\{ type: 'REPLACE_STATE', state: appliedState \}\);[\s\S]{0,100}saveStateNow\(appliedState\)/u);
assert.match(source, /reader\.onerror = \(\) => \{[\s\S]{0,100}if \(!isCurrentImport\(\)\) return/u);
assert.match(source, /reader\.onabort = \(\) => finishCurrentImport\(\)/u);
assert.match(source, /disabled=\{importBusy\}[\s\S]{0,180}aria-describedby="main-import-status"/u);
assert.match(source, /id="main-import-status" role="status" aria-live="polite"/u);
assert.match(source, /学習計画・記録を初期化/u);
assert.match(source, /暗記カードと暗記履歴は削除されません/u);
assert.doesNotMatch(source, />\s*すべてのデータを初期化\s*</u);
console.log('main local import owner race guard and reset scope copy: ok');
