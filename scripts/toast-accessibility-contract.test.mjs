import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/Toast.tsx', import.meta.url), 'utf8');

assert.match(source, /aria-labelledby=\{titleId\}/, '通知をタイトルで命名する');
assert.match(source, /aria-describedby=\{expanded && active\.detail \? detailId : undefined\}/, '展開中の詳細を通知の説明へ関連付ける');
assert.match(source, /id=\{titleId\} className="app-toast-title"/, '通知タイトルへ安定したIDを付ける');
assert.match(source, /id=\{detailId\} className="app-toast-detail"/, '通知詳細へ安定したIDを付ける');
assert.match(source, /aria-controls=\{detailId\}/, '詳細ボタンと開閉対象を関連付ける');
assert.match(source, /role="group" aria-label=\{`\$\{active\.title\}の操作`\}/, '通知操作を通知名付きのグループにする');
assert.match(source, /aria-label=\{`\$\{active\.title\}の通知を閉じる`\}/, '閉じる対象を通知タイトル込みで明示する');
assert.match(source, /aria-label=\{`待機中の通知 \$\{queue\.queued\.length\}件`\}/, '待機通知数を意味のある名前で公開する');

console.log('✅ Toast accessibility contracts passed');
