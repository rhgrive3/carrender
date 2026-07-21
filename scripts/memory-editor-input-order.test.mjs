import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryEditor.tsx', import.meta.url), 'utf8');

const answerEditors = source.indexOf('<div className="memory-answer-editors">');
const japaneseField = source.indexOf('<label htmlFor={`memory-prompt-${senseIndex}`}>日本語</label>');
assert.ok(answerEditors >= 0 && japaneseField >= 0 && answerEditors < japaneseField, 'カード登録では英語入力を日本語入力より先に表示する');
assert.ok(source.includes('<p>英語と日本語だけで登録できます</p>'), '画面説明も入力順に合わせる');
assert.ok(source.includes("document.getElementById('memory-answer-0-0')?.focus()"), '保存して次へでは先頭の英語入力へ戻す');

console.log('memory editor English-first input order contract: ok');
