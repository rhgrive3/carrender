import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../functions/api/auth/login.ts', import.meta.url), 'utf8');
const lookupEnd = source.indexOf('.first<{ id: string; username: string; password_hash: string; password_salt: string }>();');
const verification = source.indexOf('const ok = await verifyPassword(');
const rejection = source.indexOf('if (!user || !ok)');

assert.ok(lookupEnd >= 0, 'ログインのユーザー検索を維持する');
assert.ok(verification > lookupEnd, 'ユーザー検索後は存在有無にかかわらずPBKDF2検証を行う');
assert.ok(rejection > verification, 'ユーザー不存在の判定はPBKDF2検証後に行う');
assert.match(source, /user\?\.password_salt \?\? DUMMY_PASSWORD_SALT/, '不存在時は固定ダミーsaltを使う');
assert.match(source, /user\?\.password_hash \?\? DUMMY_PASSWORD_HASH/, '不存在時は固定ダミーhashを使う');
assert.doesNotMatch(source, /if \(!user\)\s*\{\s*return json\(/u, '不存在だけを早期returnして時間差を作らない');

console.log('✅ login timing enumeration contract passed');