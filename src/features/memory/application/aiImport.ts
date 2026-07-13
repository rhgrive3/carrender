import { diffAiContent, validateAiContentJson, type AiEntityType, type AiValidationIssue } from '../domain/aiContent';
import type { MemoryContentBundle } from '../domain/types';
import { createMemoryId, MemoryRepository } from '../infrastructure/repositories';

type AiEntity =
  | MemoryContentBundle['items'][number]
  | MemoryContentBundle['senses'][number]
  | MemoryContentBundle['answers'][number]
  | MemoryContentBundle['examples'][number]
  | MemoryContentBundle['exercises'][number];

export interface AiContentDiffEntry {
  key: string;
  entityType: AiEntityType;
  id: string;
  kind: 'new' | 'changed' | 'delete';
  current?: AiEntity;
  incoming?: AiEntity;
  changedFields: string[];
}

export interface AiImportPreview {
  schemaVersion: 1;
  exportId: string;
  baseRevision: number;
  /** Fingerprint of local content at the exact time this preview was built. */
  currentRevision: number;
  revisionMismatch: boolean;
  entries: AiContentDiffEntry[];
  issues: AiValidationIssue[];
  counts: {
    newSenses: number;
    newAnswers: number;
    newExamples: number;
    newExercises: number;
    changed: number;
    deletions: number;
    invalid: number;
  };
}

export function maximumContentRevision(content: MemoryContentBundle): number {
  const records = [
    ...content.items.map((record) => `item:${record.id}:${record.revision}:${record.deletedAt ?? ''}`),
    ...content.senses.map((record) => `sense:${record.id}:${record.revision}:${record.deletedAt ?? ''}`),
    ...content.answers.map((record) => `answer:${record.id}:${record.revision}:${record.deletedAt ?? ''}`),
    ...content.examples.map((record) => `example:${record.id}:${record.revision}:${record.deletedAt ?? ''}`),
    ...content.exercises.map((record) => `exercise:${record.id}:${record.revision}:${record.deletedAt ?? ''}`),
  ].sort();
  if (records.length === 0) return 0;
  // A single max(revision) misses edits to any record below the maximum. This
  // deterministic 31-bit fingerprint changes on add/edit/delete while keeping
  // the schema's numeric baseRevision field.
  let hash = 0x811c9dc5;
  for (const character of records.join('\u0001')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1;
}

export function previewAiImport(input: string | unknown, content: MemoryContentBundle): AiImportPreview {
  const currentBaseRevision = maximumContentRevision(content);
  const validation = validateAiContentJson(input, { currentContent: content, currentBaseRevision });
  const document = validation.document;
  const diff = document ? diffAiContent(content, document) : undefined;
  const entries: AiContentDiffEntry[] = (diff?.operations ?? []).map((operation) => ({
    key: operation.id,
    entityType: operation.entityType,
    id: operation.entityId,
    kind: operation.kind === 'add' ? 'new' : operation.kind === 'change' ? 'changed' : 'delete',
    current: operation.before,
    incoming: operation.after,
    changedFields: operation.changedFields,
  }));
  return {
    schemaVersion: 1,
    exportId: document?.exportId ?? '',
    baseRevision: document?.baseRevision ?? -1,
    currentRevision: currentBaseRevision,
    revisionMismatch: validation.hasBaseRevisionConflict,
    entries,
    issues: validation.issues,
    counts: {
      newSenses: diff?.summary.newSenses ?? 0,
      newAnswers: diff?.summary.newAnswers ?? 0,
      newExamples: diff?.summary.newExamples ?? 0,
      newExercises: diff?.summary.newExercises ?? 0,
      changed: diff?.summary.changed ?? 0,
      deletions: diff?.summary.deleted ?? 0,
      invalid: validation.issues.filter((issue) => issue.severity === 'error').length,
    },
  };
}

export async function applyAiImport(input: {
  repository: MemoryRepository;
  preview: AiImportPreview;
  selectedKeys: ReadonlySet<string>;
  setId?: string;
}): Promise<number> {
  if (input.preview.issues.some((issue) => issue.severity === 'error')) {
    throw new Error('不正データを修正してから追加してください');
  }
  const selected = input.preview.entries.filter(
    (entry) => input.selectedKeys.has(entry.key) && entry.kind !== 'delete' && entry.incoming,
  );
  const content = await input.repository.loadContent();
  if (maximumContentRevision(content) !== input.preview.currentRevision) {
    throw new Error('差分確認後に元データが変更されました。もう一度差分を確認してください');
  }
  const selectedNewIds = (entityType: AiEntityType) => selected
    .filter((entry) => entry.kind === 'new' && entry.entityType === entityType)
    .map((entry) => entry.id);
  const availableItemIds = new Set([...content.items.map((record) => record.id), ...selectedNewIds('item')]);
  const availableSenseIds = new Set([...content.senses.map((record) => record.id), ...selectedNewIds('sense')]);
  const availableAnswerIds = new Set([...content.answers.map((record) => record.id), ...selectedNewIds('answer')]);
  for (const entry of selected) {
    if (!entry.incoming) continue;
    const record = entry.incoming as unknown as Record<string, unknown>;
    if (entry.entityType === 'sense' && !availableItemIds.has(String(record.itemId ?? ''))) {
      throw new Error('Senseの親Itemも選択してください');
    }
    if ((entry.entityType === 'answer' || entry.entityType === 'example' || entry.entityType === 'exercise')
      && !availableSenseIds.has(String(record.senseId ?? ''))) {
      throw new Error('データの親Senseも選択してください');
    }
    if (entry.entityType === 'example' && record.answerId
      && !availableAnswerIds.has(String(record.answerId))) {
      throw new Error('例文が参照するAnswerも選択してください');
    }
    if (entry.entityType === 'exercise') {
      const ids = [record.answerId, ...(Array.isArray(record.acceptedAnswerIds) ? record.acceptedAnswerIds : [])]
        .filter((id): id is string => typeof id === 'string');
      if (ids.some((id) => !availableAnswerIds.has(id))) {
        throw new Error('問題が参照するAnswerも選択してください');
      }
    }
  }
  const now = new Date().toISOString();
  const entities: Parameters<MemoryRepository['saveEntities']>[0] = selected.map((entry) => {
    if (entry.kind === 'new') {
      return {
        entityType: entry.entityType,
        entityId: entry.id,
        value: entry.incoming,
        operation: 'create' as const,
        baseRevision: 0,
      };
    }
    if (!entry.current || !entry.incoming) throw new Error('変更元のデータがありません');
    const value = {
      ...entry.incoming,
      id: entry.current.id,
      source: entry.current.source,
      verificationStatus: entry.current.verificationStatus,
      createdAt: entry.current.createdAt,
      updatedAt: now,
      revision: entry.current.revision + 1,
      deletedAt: entry.current.deletedAt,
    };
    return {
      entityType: entry.entityType,
      entityId: entry.id,
      value,
      operation: 'update' as const,
      baseRevision: entry.current.revision,
    };
  });

  if (input.setId) {
    const existing = await input.repository.listSetMembers(input.setId);
    const known = new Set(existing.map((member) => member.itemId));
    let order = existing.length;
    for (const entry of selected.filter((value) => value.kind === 'new' && value.entityType === 'item')) {
      if (known.has(entry.id)) continue;
      const member = { setId: input.setId, itemId: entry.id, order, createdAt: now };
      order += 1;
      entities.push({ entityType: 'set_member', entityId: `${input.setId}:${entry.id}`, value: member, operation: 'upsert' });
    }
  }
  if (entities.length > 0) await input.repository.saveEntities(entities);
  return selected.length;
}

export function newAiExportId(): string {
  return createMemoryId('export');
}
