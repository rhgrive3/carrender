import type { Env } from '../../_shared/env';
import { getSessionUser } from '../../_shared/auth';
import { validateAppStatePayload } from '../../_shared/appState';
import { json } from '../../_shared/http';
import {
  decodeAppStateChunks,
  MAX_MAIN_STATE_CHUNK_BYTES,
  sha256Hex,
  utf8Length,
  validateAppStateChunkManifest,
} from '../../../src/lib/appStateChunks';
import type {
  AppStateChunk,
  AppStateChunkManifest,
  AppStateSectionName,
} from '../../../src/lib/appStateChunks';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_GENERATION_BYTES = 64 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;

interface GenerationRow {
  generation_id: string;
  mutation_id: string;
  request_hash: string;
  status: 'staging' | 'committed';
  base_updated_at: string | null;
  manifest_json: string;
  updated_at: string | null;
}

interface ChunkRow {
  section_name: AppStateSectionName;
  chunk_index: number;
  data_json: string;
  byte_length: number;
  content_hash: string;
}

function nextDataVersion(expectedVersion: string | null, nowMs = Date.now()): string {
  const expectedMs = expectedVersion ? Date.parse(expectedVersion) : Number.NaN;
  const nextMs = Number.isFinite(expectedMs) ? Math.max(nowMs, expectedMs + 1) : nowMs;
  return new Date(nextMs).toISOString();
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (utf8Length(raw) > MAX_REQUEST_BYTES) throw Object.assign(new Error('リクエストが大きすぎます'), { status: 413 });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('リクエストの形式が正しくありません'), { status: 400 });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('リクエストの形式が正しくありません'), { status: 400 });
  }
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw Object.assign(new Error(`${label}が正しくありません`), { status: 400 });
  }
  return value;
}

function expectedVersion(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw Object.assign(new Error('expectedUpdatedAtが正しくありません'), { status: 400 });
  }
  return value;
}

function parseManifest(raw: string): AppStateChunkManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('保存世代のmanifestが破損しています');
  }
  if (!validateAppStateChunkManifest(value)) throw new Error('保存世代のmanifestが不正です');
  return value;
}

async function currentVersion(env: Env, userId: string): Promise<{ updatedAt: string | null; hasHead: boolean }> {
  const head = await env.DB.prepare('SELECT updated_at FROM main_state_heads WHERE user_id = ?')
    .bind(userId)
    .first<{ updated_at: string }>();
  if (head) return { updatedAt: head.updated_at, hasHead: true };
  const legacy = await env.DB.prepare('SELECT updated_at FROM user_data WHERE user_id = ?')
    .bind(userId)
    .first<{ updated_at: string }>();
  return { updatedAt: legacy?.updated_at ?? null, hasHead: false };
}

function versionsMatch(expected: string | null, current: string | null): boolean {
  return expected === current;
}

async function committedGenerationResult(
  env: Env,
  userId: string,
  generation: GenerationRow,
  manifest: AppStateChunkManifest,
): Promise<Response> {
  const head = await env.DB.prepare(
    'SELECT generation_id, updated_at FROM main_state_heads WHERE user_id = ?',
  ).bind(userId).first<{ generation_id: string; updated_at: string }>();
  if (head?.generation_id === generation.generation_id && generation.updated_at) {
    return json({
      generationId: generation.generation_id,
      status: 'committed',
      updatedAt: generation.updated_at,
      manifest,
    }, { headers: NO_STORE_HEADERS });
  }
  return json({
    error: 'この保存操作の後に別の端末またはタブでデータが更新されています。最新データを確認してください',
    updatedAt: head?.updated_at ?? null,
  }, { status: 409, headers: NO_STORE_HEADERS });
}

async function beginGeneration(env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const mutationId = requiredId(body.mutationId, 'mutationId');
  const expectedUpdatedAt = expectedVersion(body.expectedUpdatedAt);
  if (!validateAppStateChunkManifest(body.manifest)) {
    return json({ error: 'manifestが正しくありません' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const manifest = body.manifest;
  if (manifest.totalBytes > MAX_GENERATION_BYTES) {
    return json({ error: 'クラウド保存データが大きすぎます' }, { status: 413, headers: NO_STORE_HEADERS });
  }
  const requestHash = await sha256Hex(JSON.stringify({ expectedUpdatedAt, manifest }));
  const existing = await env.DB.prepare(
    'SELECT generation_id, mutation_id, request_hash, status, base_updated_at, manifest_json, updated_at FROM main_state_generations WHERE user_id = ? AND mutation_id = ?',
  ).bind(userId, mutationId).first<GenerationRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return json({ error: '同じmutationIdが異なる内容で再利用されています' }, { status: 409, headers: NO_STORE_HEADERS });
    }
    const existingManifest = parseManifest(existing.manifest_json);
    if (existing.status === 'committed') return committedGenerationResult(env, userId, existing, existingManifest);
    return json({
      generationId: existing.generation_id,
      status: existing.status,
      updatedAt: existing.updated_at,
      manifest: existingManifest,
    }, { headers: NO_STORE_HEADERS });
  }

  const current = await currentVersion(env, userId);
  if (!versionsMatch(expectedUpdatedAt, current.updatedAt)) {
    return json({
      error: '別の端末またはタブでデータが更新されています。最新データを確認してください',
      updatedAt: current.updatedAt,
    }, { status: 409, headers: NO_STORE_HEADERS });
  }

  const generationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO main_state_generations
       (user_id, generation_id, mutation_id, request_hash, status, base_updated_at, manifest_json, total_bytes, created_at)
       VALUES (?, ?, ?, ?, 'staging', ?, ?, ?, ?)`,
    ).bind(
      userId,
      generationId,
      mutationId,
      requestHash,
      expectedUpdatedAt,
      JSON.stringify(manifest),
      manifest.totalBytes,
      createdAt,
    ).run();
  } catch (error) {
    const raced = await env.DB.prepare(
      'SELECT generation_id, mutation_id, request_hash, status, base_updated_at, manifest_json, updated_at FROM main_state_generations WHERE user_id = ? AND mutation_id = ?',
    ).bind(userId, mutationId).first<GenerationRow>();
    if (!raced || raced.request_hash !== requestHash) throw error;
    const racedManifest = parseManifest(raced.manifest_json);
    if (raced.status === 'committed') return committedGenerationResult(env, userId, raced, racedManifest);
    return json({
      generationId: raced.generation_id,
      status: raced.status,
      updatedAt: raced.updated_at,
      manifest: racedManifest,
    }, { headers: NO_STORE_HEADERS });
  }

  return json({ generationId, status: 'staging', updatedAt: null, manifest }, { status: 201, headers: NO_STORE_HEADERS });
}

async function putChunk(env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const generationId = requiredId(body.generationId, 'generationId');
  const section = body.section;
  const index = body.index;
  const chunkJson = body.json;
  const suppliedHash = body.hash;
  if (typeof section !== 'string'
    || !Number.isSafeInteger(index)
    || (index as number) < 0
    || typeof chunkJson !== 'string'
    || typeof suppliedHash !== 'string') {
    return json({ error: 'chunk指定が正しくありません' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const generation = await env.DB.prepare(
    'SELECT generation_id, mutation_id, request_hash, status, base_updated_at, manifest_json, updated_at FROM main_state_generations WHERE user_id = ? AND generation_id = ?',
  ).bind(userId, generationId).first<GenerationRow>();
  if (!generation) return json({ error: '保存世代が見つかりません' }, { status: 404, headers: NO_STORE_HEADERS });
  const manifest = parseManifest(generation.manifest_json);
  const sectionManifest = manifest.sections.find((entry) => entry.name === section);
  if (!sectionManifest || (index as number) >= sectionManifest.chunkCount) {
    return json({ error: 'manifestに存在しないchunkです' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (generation.status === 'committed') {
    const existingCommitted = await env.DB.prepare(
      'SELECT content_hash FROM main_state_chunks WHERE user_id = ? AND generation_id = ? AND section_name = ? AND chunk_index = ?',
    ).bind(userId, generationId, section, index).first<{ content_hash: string }>();
    return existingCommitted?.content_hash === suppliedHash
      ? json({ ok: true, alreadyCommitted: true }, { headers: NO_STORE_HEADERS })
      : json({ error: '確定済み世代は変更できません' }, { status: 409, headers: NO_STORE_HEADERS });
  }

  const byteLength = utf8Length(chunkJson);
  if (byteLength > MAX_MAIN_STATE_CHUNK_BYTES) {
    return json({ error: 'chunkが大きすぎます' }, { status: 413, headers: NO_STORE_HEADERS });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(chunkJson);
  } catch {
    return json({ error: 'chunkがJSONではありません' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!Array.isArray(parsed)) return json({ error: 'chunkはJSON配列である必要があります' }, { status: 400, headers: NO_STORE_HEADERS });
  const hash = await sha256Hex(chunkJson);
  if (hash !== suppliedHash || hash !== sectionManifest.hashes[index as number]) {
    return json({ error: 'chunk hashがmanifestと一致しません' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const existing = await env.DB.prepare(
    'SELECT data_json, byte_length, content_hash FROM main_state_chunks WHERE user_id = ? AND generation_id = ? AND section_name = ? AND chunk_index = ?',
  ).bind(userId, generationId, section, index).first<{ data_json: string; byte_length: number; content_hash: string }>();
  if (existing) {
    return existing.content_hash === hash && existing.byte_length === byteLength && existing.data_json === chunkJson
      ? json({ ok: true, duplicate: true }, { headers: NO_STORE_HEADERS })
      : json({ error: '同じchunk位置へ異なる内容は保存できません' }, { status: 409, headers: NO_STORE_HEADERS });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO main_state_chunks
       (user_id, generation_id, section_name, chunk_index, data_json, byte_length, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, generationId, section, index, chunkJson, byteLength, hash, new Date().toISOString()).run();
  } catch (error) {
    const raced = await env.DB.prepare(
      'SELECT data_json, byte_length, content_hash FROM main_state_chunks WHERE user_id = ? AND generation_id = ? AND section_name = ? AND chunk_index = ?',
    ).bind(userId, generationId, section, index).first<{ data_json: string; byte_length: number; content_hash: string }>();
    if (!raced || raced.content_hash !== hash || raced.data_json !== chunkJson) throw error;
  }
  return json({ ok: true }, { status: 201, headers: NO_STORE_HEADERS });
}

async function getChunk(env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const generationId = requiredId(body.generationId, 'generationId');
  const section = body.section;
  const index = body.index;
  if (typeof section !== 'string' || !Number.isSafeInteger(index) || (index as number) < 0) {
    return json({ error: 'chunk指定が正しくありません' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const row = await env.DB.prepare(
    `SELECT c.section_name, c.chunk_index, c.data_json, c.byte_length, c.content_hash
     FROM main_state_chunks c
     INNER JOIN main_state_heads h
       ON h.user_id = c.user_id AND h.generation_id = c.generation_id
     INNER JOIN main_state_generations g
       ON g.user_id = c.user_id AND g.generation_id = c.generation_id AND g.status = 'committed'
     WHERE c.user_id = ? AND c.generation_id = ? AND c.section_name = ? AND c.chunk_index = ?`,
  ).bind(userId, generationId, section, index).first<ChunkRow>();
  if (!row) return json({ error: 'chunkが見つかりません' }, { status: 404, headers: NO_STORE_HEADERS });
  return json({
    section: row.section_name,
    index: row.chunk_index,
    json: row.data_json,
    byteLength: row.byte_length,
    hash: row.content_hash,
  }, { headers: NO_STORE_HEADERS });
}

async function commitGeneration(env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const generationId = requiredId(body.generationId, 'generationId');
  const generation = await env.DB.prepare(
    'SELECT generation_id, mutation_id, request_hash, status, base_updated_at, manifest_json, updated_at FROM main_state_generations WHERE user_id = ? AND generation_id = ?',
  ).bind(userId, generationId).first<GenerationRow>();
  if (!generation) return json({ error: '保存世代が見つかりません' }, { status: 404, headers: NO_STORE_HEADERS });
  const manifest = parseManifest(generation.manifest_json);
  if (generation.status === 'committed') return committedGenerationResult(env, userId, generation, manifest);

  const rows = await env.DB.prepare(
    `SELECT section_name, chunk_index, data_json, byte_length, content_hash
     FROM main_state_chunks WHERE user_id = ? AND generation_id = ?
     ORDER BY section_name, chunk_index`,
  ).bind(userId, generationId).all<ChunkRow>();
  const chunks: AppStateChunk[] = (rows.results ?? []).map((row) => ({
    section: row.section_name,
    index: row.chunk_index,
    json: row.data_json,
    byteLength: row.byte_length,
    hash: row.content_hash,
  }));
  if (chunks.length !== manifest.totalChunks) {
    return json({ error: `chunkが不足しています (${chunks.length}/${manifest.totalChunks})` }, { status: 409, headers: NO_STORE_HEADERS });
  }

  let appState: unknown;
  try {
    appState = await decodeAppStateChunks(manifest, chunks);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'chunk検証に失敗しました' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const validation = validateAppStatePayload(appState);
  if (!validation.ok) {
    return json({ error: validation.error ?? '学習データの形式が正しくありません' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const current = await currentVersion(env, userId);
  if (!versionsMatch(generation.base_updated_at, current.updatedAt)) {
    return json({
      error: '別の端末またはタブでデータが更新されています。最新データを確認してください',
      updatedAt: current.updatedAt,
    }, { status: 409, headers: NO_STORE_HEADERS });
  }

  const committedAt = new Date().toISOString();
  const updatedAt = nextDataVersion(current.updatedAt);
  const headStatement = current.hasHead
    ? env.DB.prepare(
        `UPDATE main_state_heads SET generation_id = ?, updated_at = ?, committed_at = ?
         WHERE user_id = ? AND updated_at = ?`,
      ).bind(generationId, updatedAt, committedAt, userId, current.updatedAt)
    : current.updatedAt === null
      ? env.DB.prepare(
          `INSERT INTO main_state_heads (user_id, generation_id, updated_at, committed_at)
           SELECT ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM main_state_heads WHERE user_id = ?)
             AND NOT EXISTS (SELECT 1 FROM user_data WHERE user_id = ?)`,
        ).bind(userId, generationId, updatedAt, committedAt, userId, userId)
      : env.DB.prepare(
          `INSERT INTO main_state_heads (user_id, generation_id, updated_at, committed_at)
           SELECT ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM main_state_heads WHERE user_id = ?)
             AND (SELECT updated_at FROM user_data WHERE user_id = ?) = ?`,
        ).bind(userId, generationId, updatedAt, committedAt, userId, userId, current.updatedAt);
  const finalizeGeneration = env.DB.prepare(
    `UPDATE main_state_generations SET status = 'committed', committed_at = ?, updated_at = ?
     WHERE user_id = ? AND generation_id = ?
       AND EXISTS (SELECT 1 FROM main_state_heads WHERE user_id = ? AND generation_id = ?)`,
  ).bind(committedAt, updatedAt, userId, generationId, userId, generationId);
  const [headResult] = await env.DB.batch([headStatement, finalizeGeneration]);
  if (headResult.meta.changes !== 1) {
    const latest = await currentVersion(env, userId);
    return json({
      error: '別の端末またはタブでデータが更新されています。最新データを確認してください',
      updatedAt: latest.updatedAt,
    }, { status: 409, headers: NO_STORE_HEADERS });
  }

  // Keep the current generation plus two prior committed generations for
  // recovery. Stale staging uploads are removed after seven days.
  try {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM main_state_generations
         WHERE user_id = ? AND status = 'staging' AND datetime(created_at) < datetime('now', '-7 days')`,
      ).bind(userId),
      env.DB.prepare(
        `DELETE FROM main_state_generations
         WHERE user_id = ? AND status = 'committed' AND generation_id NOT IN (
           SELECT generation_id FROM main_state_generations
           WHERE user_id = ? AND status = 'committed'
           ORDER BY committed_at DESC LIMIT 3
         )`,
      ).bind(userId, userId),
    ]);
  } catch (error) {
    console.error(JSON.stringify({ message: 'main state generation cleanup failed', userId, error: String(error) }));
  }

  return json({ ok: true, generationId, updatedAt }, { headers: NO_STORE_HEADERS });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401, headers: NO_STORE_HEADERS });
  try {
    const head = await env.DB.prepare(
      `SELECT h.generation_id, h.updated_at, g.manifest_json
       FROM main_state_heads h
       INNER JOIN main_state_generations g
         ON g.user_id = h.user_id AND g.generation_id = h.generation_id AND g.status = 'committed'
       WHERE h.user_id = ?`,
    ).bind(user.id).first<{ generation_id: string; updated_at: string; manifest_json: string }>();
    if (!head) {
      const legacy = await env.DB.prepare('SELECT updated_at FROM user_data WHERE user_id = ?')
        .bind(user.id)
        .first<{ updated_at: string }>();
      return json({
        format: 'chunked-v1',
        generationId: null,
        updatedAt: null,
        manifest: null,
        legacyAvailable: Boolean(legacy),
      }, { headers: NO_STORE_HEADERS });
    }
    return json({
      format: 'chunked-v1',
      generationId: head.generation_id,
      updatedAt: head.updated_at,
      manifest: parseManifest(head.manifest_json),
      legacyAvailable: false,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*main_state_/i.test(message)) {
      return json({
        error: '予定データ用D1 migrationが未適用です',
        code: 'MAIN_STATE_SCHEMA_MISSING',
      }, { status: 503, headers: NO_STORE_HEADERS });
    }
    console.error(JSON.stringify({ message: 'chunked main state manifest read failed', userId: user.id, error: message }));
    return json({ error: 'クラウド予定データの読み込みに失敗しました' }, { status: 500, headers: NO_STORE_HEADERS });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401, headers: NO_STORE_HEADERS });
  try {
    const body = await readBody(request);
    switch (body.action) {
      case 'begin': return await beginGeneration(env, user.id, body);
      case 'putChunk': return await putChunk(env, user.id, body);
      case 'getChunk': return await getChunk(env, user.id, body);
      case 'commit': return await commitGeneration(env, user.id, body);
      default: return json({ error: 'actionが正しくありません' }, { status: 400, headers: NO_STORE_HEADERS });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const schemaMissing = /no such table:\s*main_state_/i.test(message);
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? (error as { status: number }).status
      : schemaMissing ? 503 : 500;
    console.error(JSON.stringify({ message: 'chunked main state request failed', userId: user.id, error: message, status }));
    return json({
      error: status === 500 ? 'クラウド予定データの保存に失敗しました' : message,
      ...(schemaMissing ? { code: 'MAIN_STATE_SCHEMA_MISSING' } : {}),
    }, { status, headers: NO_STORE_HEADERS });
  }
};
