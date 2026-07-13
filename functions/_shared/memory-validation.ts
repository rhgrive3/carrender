import type {
  MemoryAttemptInput,
  MemoryEntityType,
  MemoryMode,
  MemoryMutationInput,
  MemoryMutationOperation,
  MemorySyncInput,
} from './memory-types';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
// Each entry expands into several D1 reads/writes plus stat recomputation. The
// browser flushes repeatedly, so cap a single invocation well below D1's query
// budget instead of accepting a payload that can only fail halfway through.
const MAX_MUTATIONS = 5;
// A single Attempt may fan out to Sense + Answer/Exercise stats and dependent
// direction-gap recomputations. Two keeps the worst case below the Workers Free
// 50 D1-subrequest ceiling while the client drains additional chunks.
const MAX_ATTEMPTS = 2;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 100_000;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_STRING_LENGTH = 50_000;
const MAX_RECORD_BYTES = 256 * 1024;

const ENTITY_TYPES: readonly MemoryEntityType[] = [
  'item', 'sense', 'answer', 'example', 'exercise', 'set', 'set_member', 'session', 'stat_preference', 'attempt_void',
];
const OPERATIONS: readonly MemoryMutationOperation[] = ['create', 'update', 'delete', 'upsert'];
const MODES: readonly MemoryMode[] = ['input', 'output', 'context', 'composition'];
const EXERCISE_TYPES = [
  'flashcard', 'typed_output', 'fill_blank', 'reorder', 'multiple_choice', 'guided_composition', 'free_composition',
] as const;
const ERROR_TYPES = [
  'meaning', 'recall', 'spelling', 'word_form', 'article', 'preposition', 'word_order', 'tense',
  'agreement', 'register', 'context', 'other',
] as const;

export class MemoryValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MemoryValidationError(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new MemoryValidationError(`${path} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new MemoryValidationError(`${path}.${key} is not allowed`);
  }
}

function stringValue(value: unknown, path: string, max = MAX_STRING_LENGTH, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max || value.includes('\0')) {
    throw new MemoryValidationError(`${path} must be a valid string`);
  }
  return value;
}

function optionalString(value: unknown, path: string, max = MAX_STRING_LENGTH): string | undefined {
  return value === undefined ? undefined : stringValue(value, path, max, true);
}

function identifier(value: unknown, path: string): string {
  const result = stringValue(value, path, 300);
  if (/\p{Cc}/u.test(result)) throw new MemoryValidationError(`${path} contains a control character`);
  return result;
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new MemoryValidationError(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new MemoryValidationError(`${path} must be a boolean`);
  return value;
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new MemoryValidationError(`${path} has an unsupported value`);
  }
  return value as T;
}

function timestamp(value: unknown, path: string): string {
  const result = stringValue(value, path, 50);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new MemoryValidationError(`${path} must be an ISO timestamp`);
  }
  return result;
}

function optionalTimestamp(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, path);
}

function array(value: unknown, path: string, max = MAX_ARRAY_LENGTH): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new MemoryValidationError(`${path} must be an array`);
  return value;
}

function stringArray(value: unknown, path: string, max = 500): string[] {
  return array(value, path, max).map((entry, index) => stringValue(entry, `${path}[${index}]`, 2_000, true));
}

function idArray(value: unknown, path: string, max = 10_000): string[] {
  return array(value, path, max).map((entry, index) => identifier(entry, `${path}[${index}]`));
}

function revisionedBase(
  raw: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): { id: string; source: string; verificationStatus: string; createdAt: string; updatedAt: string; revision: number; deletedAt?: string } {
  exactKeys(raw, [...allowed, 'id', 'source', 'verificationStatus', 'createdAt', 'updatedAt', 'revision', 'deletedAt'], path);
  const result = {
    id: identifier(raw.id, `${path}.id`),
    source: enumValue(raw.source, ['user', 'import', 'ai'] as const, `${path}.source`),
    verificationStatus: enumValue(raw.verificationStatus, ['verified', 'unverified_ai'] as const, `${path}.verificationStatus`),
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(raw.updatedAt, `${path}.updatedAt`),
    revision: integer(raw.revision, `${path}.revision`, 1),
    deletedAt: optionalTimestamp(raw.deletedAt, `${path}.deletedAt`),
  };
  return result;
}

function validateItem(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  const base = revisionedBase(raw, path, ['kind', 'label', 'lemma', 'tags']);
  return {
    ...base,
    kind: enumValue(raw.kind, ['word', 'phrase', 'expression', 'construction', 'composition'] as const, `${path}.kind`),
    label: stringValue(raw.label, `${path}.label`, 2_000),
    ...(raw.lemma === undefined ? {} : { lemma: stringValue(raw.lemma, `${path}.lemma`, 2_000, true) }),
    tags: stringArray(raw.tags, `${path}.tags`, 100),
  };
}

function validateSense(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  const base = revisionedBase(raw, path, ['itemId', 'promptJa', 'meaningJa', 'explanation', 'siblingGroupId', 'tags']);
  return {
    ...base,
    itemId: identifier(raw.itemId, `${path}.itemId`),
    promptJa: stringValue(raw.promptJa, `${path}.promptJa`, 10_000),
    meaningJa: stringValue(raw.meaningJa, `${path}.meaningJa`, 10_000),
    ...(raw.explanation === undefined ? {} : { explanation: stringValue(raw.explanation, `${path}.explanation`, 20_000, true) }),
    siblingGroupId: identifier(raw.siblingGroupId, `${path}.siblingGroupId`),
    tags: stringArray(raw.tags, `${path}.tags`, 100),
  };
}

function validateAnswer(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  const base = revisionedBase(raw, path, [
    'senseId', 'displayForm', 'citationForm', 'pattern', 'acceptedVariants', 'orthographicVariants', 'register', 'nuance', 'note',
  ]);
  return {
    ...base,
    senseId: identifier(raw.senseId, `${path}.senseId`),
    displayForm: stringValue(raw.displayForm, `${path}.displayForm`, 10_000),
    citationForm: stringValue(raw.citationForm, `${path}.citationForm`, 10_000),
    ...(raw.pattern === undefined ? {} : { pattern: stringValue(raw.pattern, `${path}.pattern`, 10_000, true) }),
    acceptedVariants: stringArray(raw.acceptedVariants, `${path}.acceptedVariants`, 200),
    orthographicVariants: stringArray(raw.orthographicVariants, `${path}.orthographicVariants`, 200),
    ...(raw.register === undefined ? {} : { register: enumValue(raw.register, ['neutral', 'formal', 'informal', 'literary'] as const, `${path}.register`) }),
    ...(raw.nuance === undefined ? {} : { nuance: stringValue(raw.nuance, `${path}.nuance`, 20_000, true) }),
    ...(raw.note === undefined ? {} : { note: stringValue(raw.note, `${path}.note`, 20_000, true) }),
  };
}

function validateExample(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  const base = revisionedBase(raw, path, ['senseId', 'answerId', 'english', 'japanese', 'note']);
  return {
    ...base,
    senseId: identifier(raw.senseId, `${path}.senseId`),
    ...(raw.answerId === undefined ? {} : { answerId: identifier(raw.answerId, `${path}.answerId`) }),
    english: stringValue(raw.english, `${path}.english`, 20_000),
    ...(raw.japanese === undefined ? {} : { japanese: stringValue(raw.japanese, `${path}.japanese`, 20_000, true) }),
    ...(raw.note === undefined ? {} : { note: stringValue(raw.note, `${path}.note`, 20_000, true) }),
  };
}

function validateExercise(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  const base = revisionedBase(raw, path, [
    'senseId', 'answerId', 'type', 'prompt', 'context', 'acceptedAnswerIds', 'requiredTokens', 'forbiddenTokens',
    'explanation', 'hint', 'siblingGroupId',
  ]);
  return {
    ...base,
    senseId: identifier(raw.senseId, `${path}.senseId`),
    ...(raw.answerId === undefined ? {} : { answerId: identifier(raw.answerId, `${path}.answerId`) }),
    type: enumValue(raw.type, EXERCISE_TYPES, `${path}.type`),
    prompt: stringValue(raw.prompt, `${path}.prompt`, 20_000),
    ...(raw.context === undefined ? {} : { context: stringValue(raw.context, `${path}.context`, 20_000, true) }),
    // SQLite/D1 bind-variable limits include userId and senseId as well.
    acceptedAnswerIds: idArray(raw.acceptedAnswerIds, `${path}.acceptedAnswerIds`, 98),
    ...(raw.requiredTokens === undefined ? {} : { requiredTokens: stringArray(raw.requiredTokens, `${path}.requiredTokens`, 200) }),
    ...(raw.forbiddenTokens === undefined ? {} : { forbiddenTokens: stringArray(raw.forbiddenTokens, `${path}.forbiddenTokens`, 200) }),
    ...(raw.explanation === undefined ? {} : { explanation: stringValue(raw.explanation, `${path}.explanation`, 20_000, true) }),
    ...(raw.hint === undefined ? {} : { hint: stringValue(raw.hint, `${path}.hint`, 20_000, true) }),
    siblingGroupId: identifier(raw.siblingGroupId, `${path}.siblingGroupId`),
  };
}

function validateSet(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  exactKeys(raw, ['id', 'name', 'description', 'tags', 'createdAt', 'updatedAt', 'revision', 'deletedAt'], path);
  return {
    id: identifier(raw.id, `${path}.id`),
    name: stringValue(raw.name, `${path}.name`, 2_000),
    ...(raw.description === undefined ? {} : { description: stringValue(raw.description, `${path}.description`, 20_000, true) }),
    tags: stringArray(raw.tags, `${path}.tags`, 100),
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(raw.updatedAt, `${path}.updatedAt`),
    revision: integer(raw.revision, `${path}.revision`, 1),
    ...(raw.deletedAt === undefined ? {} : { deletedAt: timestamp(raw.deletedAt, `${path}.deletedAt`) }),
  };
}

function validateSetMember(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  exactKeys(raw, ['setId', 'itemId', 'order', 'createdAt', 'deletedAt'], path);
  return {
    setId: identifier(raw.setId, `${path}.setId`),
    itemId: identifier(raw.itemId, `${path}.itemId`),
    order: integer(raw.order, `${path}.order`, 0, 1_000_000_000),
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`),
    ...(raw.deletedAt === undefined ? {} : { deletedAt: timestamp(raw.deletedAt, `${path}.deletedAt`) }),
  };
}

function validateQuestionCount(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  const type = enumValue(raw.type, ['weak', 'count', 'all', 'auto'] as const, `${path}.type`);
  exactKeys(raw, type === 'weak' || type === 'count' ? ['type', 'count'] : ['type'], path);
  return type === 'weak' || type === 'count'
    ? { type, count: integer(raw.count, `${path}.count`, 1, 100_000) }
    : { type };
}

function validateConfig(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  exactKeys(raw, ['questionCount', 'direction', 'includeUnverifiedAi', 'preferredExerciseType', 'modeWeights'], path);
  const result: Record<string, unknown> = {
    questionCount: validateQuestionCount(raw.questionCount, `${path}.questionCount`),
    direction: enumValue(raw.direction, ['output', 'input', 'context', 'mix'] as const, `${path}.direction`),
    includeUnverifiedAi: booleanValue(raw.includeUnverifiedAi, `${path}.includeUnverifiedAi`),
  };
  if (raw.preferredExerciseType !== undefined) {
    result.preferredExerciseType = enumValue(raw.preferredExerciseType, EXERCISE_TYPES, `${path}.preferredExerciseType`);
  }
  if (raw.modeWeights !== undefined) {
    const weights = object(raw.modeWeights, `${path}.modeWeights`);
    exactKeys(weights, MODES, `${path}.modeWeights`);
    const normalized: Record<string, number> = {};
    for (const mode of MODES) {
      const weight = weights[mode];
      if (weight === undefined) continue;
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new MemoryValidationError(`${path}.modeWeights.${mode} must be between 0 and 1`);
      }
      normalized[mode] = weight;
    }
    result.modeWeights = normalized;
  }
  return result;
}

function validateSession(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  exactKeys(raw, [
    'id', 'status', 'selectedSetIds', 'initialTargetIds', 'config', 'seed', 'currentTargetId', 'queueState',
    'completedTargetIds', 'needsReviewTargetIds', 'answerCount', 'createdAt', 'updatedAt', 'completedAt',
  ], path);
  return {
    id: identifier(raw.id, `${path}.id`),
    status: enumValue(raw.status, ['active', 'completed', 'abandoned'] as const, `${path}.status`),
    selectedSetIds: idArray(raw.selectedSetIds, `${path}.selectedSetIds`),
    initialTargetIds: idArray(raw.initialTargetIds, `${path}.initialTargetIds`),
    config: validateConfig(raw.config, `${path}.config`),
    seed: stringValue(raw.seed, `${path}.seed`, 300),
    ...(raw.currentTargetId === undefined ? {} : { currentTargetId: identifier(raw.currentTargetId, `${path}.currentTargetId`) }),
    queueState: raw.queueState,
    completedTargetIds: idArray(raw.completedTargetIds, `${path}.completedTargetIds`),
    needsReviewTargetIds: idArray(raw.needsReviewTargetIds, `${path}.needsReviewTargetIds`),
    answerCount: integer(raw.answerCount, `${path}.answerCount`, 0, 10_000_000),
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(raw.updatedAt, `${path}.updatedAt`),
    ...(raw.completedAt === undefined ? {} : { completedAt: timestamp(raw.completedAt, `${path}.completedAt`) }),
  };
}

function validateAttemptVoid(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  exactKeys(raw, ['attemptId', 'undoneAt'], path);
  return {
    attemptId: identifier(raw.attemptId, `${path}.attemptId`),
    undoneAt: timestamp(raw.undoneAt, `${path}.undoneAt`),
  };
}

function validateStatPreference(value: unknown, path: string): Record<string, unknown> {
  const raw = object(value, path);
  exactKeys(raw, ['targetType', 'targetId', 'mode', 'manualWeak', 'updatedAt'], path);
  return {
    targetType: enumValue(raw.targetType, ['sense', 'answer', 'exercise'] as const, `${path}.targetType`),
    targetId: identifier(raw.targetId, `${path}.targetId`),
    mode: enumValue(raw.mode, MODES, `${path}.mode`),
    manualWeak: booleanValue(raw.manualWeak, `${path}.manualWeak`),
    updatedAt: timestamp(raw.updatedAt, `${path}.updatedAt`),
  };
}

function validateEntityPayload(entityType: MemoryEntityType, value: unknown, path: string): Record<string, unknown> {
  switch (entityType) {
    case 'item': return validateItem(value, path);
    case 'sense': return validateSense(value, path);
    case 'answer': return validateAnswer(value, path);
    case 'example': return validateExample(value, path);
    case 'exercise': return validateExercise(value, path);
    case 'set': return validateSet(value, path);
    case 'set_member': return validateSetMember(value, path);
    case 'session': return validateSession(value, path);
    case 'stat_preference': return validateStatPreference(value, path);
    case 'attempt_void': return validateAttemptVoid(value, path);
  }
}

function validateMutation(value: unknown, path: string, requestClientId: string): MemoryMutationInput {
  const raw = object(value, path);
  exactKeys(raw, ['mutationId', 'clientId', 'entityType', 'entityId', 'entityKey', 'operation', 'baseRevision', 'payload', 'createdAt'], path);
  const entityType = enumValue(raw.entityType, ENTITY_TYPES, `${path}.entityType`);
  const entityId = identifier(raw.entityId, `${path}.entityId`);
  const clientId = identifier(raw.clientId, `${path}.clientId`);
  if (clientId !== requestClientId) throw new MemoryValidationError(`${path}.clientId does not match the request clientId`);
  const entityKey = stringValue(raw.entityKey, `${path}.entityKey`, 700);
  if (entityKey !== `${entityType}:${entityId}`) throw new MemoryValidationError(`${path}.entityKey is inconsistent`);
  const operation = enumValue(raw.operation, OPERATIONS, `${path}.operation`);
  const baseRevision = raw.baseRevision === undefined ? undefined : integer(raw.baseRevision, `${path}.baseRevision`, 0);
  const payload = validateEntityPayload(entityType, raw.payload, `${path}.payload`);
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_RECORD_BYTES) {
    throw new MemoryValidationError(`${path}.payload is too large`, 413);
  }

  if (entityType === 'set_member') {
    const memberId = `${String(payload.setId)}:${String(payload.itemId)}`;
    if (entityId !== memberId || operation !== 'upsert') throw new MemoryValidationError(`${path} has an invalid set member identity or operation`);
  } else if (entityType === 'attempt_void') {
    if (payload.attemptId !== entityId || operation !== 'upsert') throw new MemoryValidationError(`${path} has an invalid attempt void identity or operation`);
  } else if (entityType === 'stat_preference') {
    const statIdentity = `${String(payload.targetType)}:${String(payload.targetId)}:${String(payload.mode)}`;
    if (entityId !== statIdentity || operation !== 'upsert' || baseRevision === undefined) {
      throw new MemoryValidationError(`${path} has an invalid stat preference identity, operation, or baseRevision`);
    }
  } else {
    if (payload.id !== entityId) throw new MemoryValidationError(`${path}.payload.id does not match entityId`);
    if (entityType === 'session' && operation !== 'upsert') throw new MemoryValidationError(`${path}.operation must be upsert for sessions`);
  }

  if (['item', 'sense', 'answer', 'example', 'exercise', 'set'].includes(entityType)) {
    const recordRevision = integer(payload.revision, `${path}.payload.revision`, 1);
    if (operation === 'create') {
      if ((baseRevision ?? 0) !== 0 || recordRevision !== 1) throw new MemoryValidationError(`${path} has an invalid create revision`);
    } else {
      if (baseRevision === undefined || baseRevision < 1 || recordRevision !== baseRevision + 1) {
        throw new MemoryValidationError(`${path} has an invalid update revision`);
      }
      if (operation === 'delete' && payload.deletedAt === undefined) throw new MemoryValidationError(`${path}.payload.deletedAt is required`);
    }
  }

  return {
    mutationId: identifier(raw.mutationId, `${path}.mutationId`),
    clientId,
    entityType,
    entityId,
    entityKey,
    operation,
    ...(baseRevision === undefined ? {} : { baseRevision }),
    payload,
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`),
  };
}

function validateAttempt(value: unknown, path: string, requestClientId: string): MemoryAttemptInput {
  const raw = object(value, path);
  exactKeys(raw, [
    'attemptId', 'sessionId', 'clientId', 'itemId', 'senseId', 'answerId', 'exerciseId', 'targetId', 'mode',
    'exerciseType', 'userAnswer', 'normalizedAnswer', 'assessment', 'errorTypes', 'hintUsed', 'responseMs',
    'createdAt', 'syncedAt', 'undoneAt',
  ], path);
  const clientId = identifier(raw.clientId, `${path}.clientId`);
  if (clientId !== requestClientId) throw new MemoryValidationError(`${path}.clientId does not match the request clientId`);
  if (raw.undoneAt !== undefined) throw new MemoryValidationError(`${path} is already undone and cannot be uploaded as an attempt`);
  if (raw.syncedAt !== undefined) timestamp(raw.syncedAt, `${path}.syncedAt`);
  return {
    attemptId: identifier(raw.attemptId, `${path}.attemptId`),
    sessionId: identifier(raw.sessionId, `${path}.sessionId`),
    clientId,
    itemId: identifier(raw.itemId, `${path}.itemId`),
    senseId: identifier(raw.senseId, `${path}.senseId`),
    ...(raw.answerId === undefined ? {} : { answerId: identifier(raw.answerId, `${path}.answerId`) }),
    ...(raw.exerciseId === undefined ? {} : { exerciseId: identifier(raw.exerciseId, `${path}.exerciseId`) }),
    targetId: identifier(raw.targetId, `${path}.targetId`),
    mode: enumValue(raw.mode, MODES, `${path}.mode`),
    exerciseType: enumValue(raw.exerciseType, EXERCISE_TYPES, `${path}.exerciseType`),
    ...(raw.userAnswer === undefined ? {} : { userAnswer: stringValue(raw.userAnswer, `${path}.userAnswer`, 50_000, true) }),
    ...(raw.normalizedAnswer === undefined ? {} : { normalizedAnswer: stringValue(raw.normalizedAnswer, `${path}.normalizedAnswer`, 50_000, true) }),
    assessment: enumValue(raw.assessment, ['correct', 'partial', 'incorrect', 'skipped'] as const, `${path}.assessment`),
    errorTypes: array(raw.errorTypes, `${path}.errorTypes`, 20).map((entry, index) => enumValue(entry, ERROR_TYPES, `${path}.errorTypes[${index}]`)),
    hintUsed: booleanValue(raw.hintUsed, `${path}.hintUsed`),
    responseMs: integer(raw.responseMs, `${path}.responseMs`, 0, 24 * 60 * 60 * 1_000),
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`),
  };
}

function inspectJson(value: unknown, depth = 0, counter = { nodes: 0 }): void {
  counter.nodes += 1;
  if (counter.nodes > MAX_JSON_NODES) throw new MemoryValidationError('JSON contains too many values', 413);
  if (depth > MAX_JSON_DEPTH) throw new MemoryValidationError('JSON is nested too deeply', 413);
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH || value.includes('\0')) throw new MemoryValidationError('JSON contains an invalid string', 413);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new MemoryValidationError('JSON array is too large', 413);
    for (const entry of value) inspectJson(entry, depth + 1, counter);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key.length > 200) throw new MemoryValidationError('JSON contains an invalid property name', 413);
      inspectJson(entry, depth + 1, counter);
    }
  }
}

export async function readMemorySyncRequest(request: Request): Promise<MemorySyncInput> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    throw new MemoryValidationError('同期データが大きすぎます', 413);
  }
  if (!request.body) throw new MemoryValidationError('同期データがありません');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    byteLength += next.value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel('request too large');
      throw new MemoryValidationError('同期データが大きすぎます', 413);
    }
    chunks.push(next.value);
  }
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(joined));
  } catch {
    throw new MemoryValidationError('同期データのJSON形式が正しくありません');
  }
  inspectJson(parsed);

  const raw = object(parsed, 'body');
  exactKeys(raw, ['schemaVersion', 'clientId', 'cursor', 'mutations', 'attempts'], 'body');
  if (raw.schemaVersion !== 1) throw new MemoryValidationError('未対応のschemaVersionです');
  const clientId = identifier(raw.clientId, 'body.clientId');
  let cursor = 0;
  if (raw.cursor !== undefined) {
    if (typeof raw.cursor !== 'string' || !/^\d+$/.test(raw.cursor)) throw new MemoryValidationError('body.cursor is invalid');
    cursor = Number(raw.cursor);
    if (!Number.isSafeInteger(cursor)) throw new MemoryValidationError('body.cursor is too large');
  }
  const mutationValues = array(raw.mutations, 'body.mutations', MAX_MUTATIONS);
  const attemptValues = array(raw.attempts, 'body.attempts', MAX_ATTEMPTS);
  const mutations = mutationValues.map((entry, index) => validateMutation(entry, `body.mutations[${index}]`, clientId));
  const attempts = attemptValues.map((entry, index) => validateAttempt(entry, `body.attempts[${index}]`, clientId));
  const attemptVoidCount = mutations.filter((mutation) => mutation.entityType === 'attempt_void').length;
  if (attempts.length > 0) {
    if (mutations.some((mutation) => mutation.entityType !== 'attempt_void')) {
      throw new MemoryValidationError('Attemptと同時送信できるmutationはattempt_voidだけです');
    }
    if (mutations.length + attempts.length > 4) {
      throw new MemoryValidationError('1回のAttempt同期件数が多すぎます');
    }
  } else if (attemptVoidCount > 1) {
    throw new MemoryValidationError('attempt_voidは1回の同期につき1件までです');
  }
  if (new Set(mutations.map((entry) => entry.mutationId)).size !== mutations.length) {
    throw new MemoryValidationError('body.mutations contains duplicate mutationId values');
  }
  if (new Set(attempts.map((entry) => entry.attemptId)).size !== attempts.length) {
    throw new MemoryValidationError('body.attempts contains duplicate attemptId values');
  }
  return { schemaVersion: 1, clientId, cursor, mutations, attempts };
}
