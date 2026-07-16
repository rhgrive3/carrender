import assert from 'node:assert/strict';
import { uniqueDisplayAnswers } from '../src/features/memory/ui/MemoryStudy';

assert.deepEqual(
  uniqueDisplayAnswers([' take care ', 'take care', '', 'look after', null, undefined, 'look after ']),
  ['take care', 'look after'],
  '表示前に前後空白・空値・完全重複を除去する',
);

assert.deepEqual(
  uniqueDisplayAnswers(['US', 'us']),
  ['US', 'us'],
  '大文字小文字が意味を持つ回答は別候補として維持する',
);

console.log('✅ memory answer display normalization regression test passed');
