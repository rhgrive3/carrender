/** Real Cloudflare Pages + local D1 verification for login throttling. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8793/';
let tempDirectory;
let server;
let serverOutput = '';
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

async function command(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${program} ${args.join(' ')} exited ${code}\n${output}`)));
  });
}

async function waitForServer(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler Pages did not start\n${serverOutput}`);
}

async function stopServer() {
  if (!server?.pid) return;
  try {
    if (process.platform === 'win32') server.kill('SIGTERM');
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

async function request(path, { body, address = '203.0.113.10' } = {}) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'CF-Connecting-IP': address,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function login(username, password, address) {
  return request('/api/auth/login', { body: { username, password }, address });
}

try {
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-auth-rate-limit-'));
  const persistence = join(tempDirectory, 'state');
  const site = join(tempDirectory, 'site');
  await mkdir(persistence, { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>auth rate limit test</title>');

  await command('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence]);
  const wranglerConfig = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(wranglerConfig)?.[1];
  if (!databaseId) throw new Error('wrangler.toml does not contain a D1 database_id');

  server = spawn('npx', [
    'wrangler', 'pages', 'dev', site,
    `--d1=DB=${databaseId}`,
    '--ip=127.0.0.1',
    '--port=8793',
    `--persist-to=${persistence}`,
    '--log-level=error',
    '--show-interactive-dev-session=false',
  ], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-40_000);
  };
  server.stdout.on('data', appendOutput);
  server.stderr.on('data', appendOutput);
  await waitForServer();

  const username = `ratelimit${process.pid}`.slice(0, 20);
  const password = 'correct-password-123';
  const registration = await request('/api/auth/register', { body: { username, password } });
  check('テストユーザーを登録', registration.response.status === 201, registration);

  console.log('--- Login rate limit: successful login resets failures ---');
  for (let index = 0; index < 2; index += 1) {
    const failed = await login(username, 'wrong-password');
    check(`事前失敗 ${index + 1} は401`, failed.response.status === 401, failed);
  }
  const success = await login(username, password);
  check('正しいログインは成功', success.response.status === 200, success);

  console.log('--- Login rate limit: threshold and block ---');
  for (let index = 0; index < 7; index += 1) {
    const failed = await login(username, `wrong-password-${index}`);
    check(`リセット後の失敗 ${index + 1} は401`, failed.response.status === 401, failed);
  }
  const threshold = await login(username, 'wrong-password-threshold');
  const retryAfter = Number(threshold.response.headers.get('retry-after'));
  check('8回目で429へ切り替える', threshold.response.status === 429 && threshold.data?.code === 'LOGIN_RATE_LIMITED', threshold);
  check('Retry-Afterを返す', Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 15 * 60, retryAfter);
  check('429をキャッシュさせない', threshold.response.headers.get('cache-control') === 'no-store', threshold.response.headers.get('cache-control'));

  const blockedCorrect = await login(username, password);
  check('block中は正しいpasswordでもhandler前に429', blockedCorrect.response.status === 429, blockedCorrect);

  console.log('--- Login rate limit: key isolation ---');
  const otherUsername = await login(`${username}x`.slice(0, 24), 'wrong-password');
  check('同じIPでも別usernameは独立', otherUsername.response.status === 401, otherUsername);
  const otherAddress = await login(username, password, '203.0.113.11');
  check('同じusernameでも別IPは独立', otherAddress.response.status === 200, otherAddress);
} catch (error) {
  failures += 1;
  console.error(error);
  if (serverOutput) console.error(serverOutput);
} finally {
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n🎉 ALL PASS (auth rate limit API)' : `\n💥 ${failures} FAILURES (auth rate limit API)`);
process.exit(failures === 0 ? 0 : 1);
