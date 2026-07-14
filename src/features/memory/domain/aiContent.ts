import type {
  MemoryAnswer,
  MemoryContentBundle,
  MemoryExample,
  MemoryExercise,
  MemoryItem,
  MemorySense,
} from './types';
import type { AiContentDocument } from './importExport';

export type AiValidationSeverity = 'error' | 'warning';

export interface AiValidationIssue {
  path: string;
  code:
    | 'invalid_json'
    | 'document_too_large'
    | 'too_deep'
    | 'too_many_values'
    | 'string_too_long'
    | 'dangerous_text'
    | 'external_url'
    | 'forbidden_field'
    | 'unknown_field'
    | 'invalid_type'
    | 'invalid_value'
    | 'duplicate_id'
    | 'missing_parent'
    | 'parent_mismatch'
    | 'protected_change'
    | 'new_ai_metadata'
    | 'example_only_violation'
    | 'base_revision_conflict';
  message: string;
  severity: AiValidationSeverity;
}

export interface ValidateAiContentOptions {
  currentContent?: MemoryContentBundle;
  currentBaseRevision?: number;
  maxJsonBytes?: number;
  maxDepth?: number;
  maxStringLength?: number;
  maxValues?: number;
  allowExternalUrls?: boolean;
}

export interface AiValidationResult {
  valid: boolean;
  issues: AiValidationIssue[];
  document?: AiContentDocument;
  hasBaseRevisionConflict: boolean;
}

const FORBIDDEN_FIELDS = new Set([
  'userid', 'user_id', 'email', 'password', 'owner', 'ownership', 'clientid', 'client_id',
  'stats', 'memorystats', 'attempts', 'memoryattempts', 'sessions', 'memorysessions',
  'syncedat', 'syncstate', 'pendingmutations', 'conflicts',
]);

const COMMON_FIELDS = ['id', 'source', 'verificationStatus', 'createdAt', 'updatedAt', 'revision', 'deletedAt'] as const;
const ITEM_FIELDS = new Set([...COMMON_FIELDS, 'kind', 'label', 'lemma', 'tags']);
const SENSE_FIELDS = new Set([...COMMON_FIELDS, 'itemId', 'promptJa', 'meaningJa', 'explanation', 'siblingGroupId', 'tags']);
const ANSWER_FIELDS = new Set([
  ...COMMON_FIELDS, 'senseId', 'displayForm', 'citationForm', 'pattern', 'acceptedVariants',
  'orthographicVariants', 'register', 'nuance', 'note',
]);
const EXAMPLE_FIELDS = new Set([...COMMON_FIELDS, 'senseId', 'answerId', 'english', 'japanese', 'note']);
const EXERCISE_FIELDS = new Set([
  ...COMMON_FIELDS, 'senseId', 'answerId', 'type', 'prompt', 'context', 'acceptedAnswerIds',
  'requiredTokens', 'forbiddenTokens', 'explanation', 'hint', 'siblingGroupId',
]);
const DOCUMENT_FIELDS = new Set([
  'schemaVersion', 'exportType', 'exportId', 'baseRevision', 'exportedAt',
  'items', 'senses', 'answers', 'examples', 'exercises',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function issue(
  issues: AiValidationIssue[],
  path: string,
  code: AiValidationIssue['code'],
  message: string,
  severity: AiValidationSeverity = 'error',
): void {
  issues.push({ path, code, message, severity });
}

function scanUntrustedValue(
  value: unknown,
  options: Required<Pick<ValidateAiContentOptions, 'maxDepth' | 'maxStringLength' | 'maxValues' | 'allowExternalUrls'>>,
  issues: AiValidationIssue[],
): void {
  let values = 0;
  const visit = (candidate: unknown, path: string, depth: number): void => {
    values += 1;
    if (values > options.maxValues) {
      if (!issues.some((entry) => entry.code === 'too_many_values')) {
        issue(issues, path, 'too_many_values', 'JSON内の値が多すぎます');
      }
      return;
    }
    if (depth > options.maxDepth) {
      issue(issues, path, 'too_deep', 'JSONの入れ子が深すぎます');
      return;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > options.maxStringLength) {
        issue(issues, path, 'string_too_long', `文字列は${options.maxStringLength}文字以内にしてください`);
      }
      if (/<\s*\/?\s*(?:script|iframe)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/iu.test(candidate)) {
        issue(issues, path, 'dangerous_text', '実行可能なHTMLまたはURLは使用できません');
      }
      if (!options.allowExternalUrls && /https?:\/\/[^\s]+/iu.test(candidate)) {
        issue(issues, path, 'external_url', '外部URLは使用できません');
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (FORBIDDEN_FIELDS.has(key.toLocaleLowerCase('en-US'))) {
        issue(issues, `${path}.${key}`, 'forbidden_field', `${key}はAI用JSONに含められません`);
      }
      visit(entry, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, '$', 0);
}

function expectString(record: Record<string, unknown>, field: string, path: string, issues: AiValidationIssue[], optional = false): void {
  const value = record[field];
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || (!optional && value.trim() === '')) {
    issue(issues, `${path}.${field}`, 'invalid_type', `${field}は文字列である必要があります`);
  }
}

function expectTimestamp(record: Record<string, unknown>, field: string, path: string, issues: AiValidationIssue[], optional = false): void {
  const value = record[field];
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(value) || Number.isNaN(Date.parse(value))) {
    issue(issues, `${path}.${field}`, 'invalid_value', `${field}はISO日時である必要があります`);
  }
}

function expectStringArray(record: Record<string, unknown>, field: string, path: string, issues: AiValidationIssue[], optional = false): void {
  const value = record[field];
  if (optional && value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    issue(issues, `${path}.${field}`, 'invalid_type', `${field}は文字列配列である必要があります`);
  }
}

function expectEnum(
  record: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<string>,
  path: string,
  issues: AiValidationIssue[],
  optional = false,
): void {
  const value = record[field];
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !allowed.has(value)) {
    issue(issues, `${path}.${field}`, 'invalid_value', `${field}の値が不正です`);
  }
}

function validateCommon(
  record: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  path: string,
  issues: AiValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) issue(issues, `${path}.${key}`, 'unknown_field', `許可されていないフィールドです: ${key}`);
  }
  expectString(record, 'id', path, issues);
  expectEnum(record, 'source', new Set(['user', 'import', 'ai']), path, issues);
  expectEnum(record, 'verificationStatus', new Set(['verified', 'unverified_ai']), path, issues);
  expectTimestamp(record, 'createdAt', path, issues);
  expectTimestamp(record, 'updatedAt', path, issues);
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) {
    issue(issues, `${path}.revision`, 'invalid_type', 'revisionは0以上の整数である必要があります');
  }
  expectTimestamp(record, 'deletedAt', path, issues, true);
}

function validateItems(records: unknown[], issues: AiValidationIssue[]): void {
  records.forEach((value, index) => {
    const path = `$.items[${index}]`;
    if (!isRecord(value)) return issue(issues, path, 'invalid_type', 'Itemはオブジェクトである必要があります');
    validateCommon(value, ITEM_FIELDS, path, issues);
    expectEnum(value, 'kind', new Set(['word', 'phrase', 'expression', 'construction', 'composition']), path, issues);
    expectString(value, 'label', path, issues);
    expectString(value, 'lemma', path, issues, true);
    expectStringArray(value, 'tags', path, issues);
  });
}

function validateSenses(records: unknown[], issues: AiValidationIssue[]): void {
  records.forEach((value, index) => {
    const path = `$.senses[${index}]`;
    if (!isRecord(value)) return issue(issues, path, 'invalid_type', 'Senseはオブジェクトである必要があります');
    validateCommon(value, SENSE_FIELDS, path, issues);
    ['itemId', 'promptJa', 'meaningJa', 'siblingGroupId'].forEach((field) => expectString(value, field, path, issues));
    expectString(value, 'explanation', path, issues, true);
    expectStringArray(value, 'tags', path, issues);
  });
}

function validateAnswers(records: unknown[], issues: AiValidationIssue[]): void {
  records.forEach((value, index) => {
    const path = `$.answers[${index}]`;
    if (!isRecord(value)) return issue(issues, path, 'invalid_type', 'Answerはオブジェクトである必要があります');
    validateCommon(value, ANSWER_FIELDS, path, issues);
    ['senseId', 'displayForm', 'citationForm'].forEach((field) => expectString(value, field, path, issues));
    ['pattern', 'nuance', 'note'].forEach((field) => expectString(value, field, path, issues, true));
    expectStringArray(value, 'acceptedVariants', path, issues);
    expectStringArray(value, 'orthographicVariants', path, issues);
    expectEnum(value, 'register', new Set(['neutral', 'formal', 'informal', 'literary']), path, issues, true);
  });
}

function validateExamples(records: unknown[], issues: AiValidationIssue[]): void {
  records.forEach((value, index) => {
    const path = `$.examples[${index}]`;
    if (!isRecord(value)) return issue(issues, path, 'invalid_type', 'Exampleはオブジェクトである必要があります');
    validateCommon(value, EXAMPLE_FIELDS, path, issues);
    ['senseId', 'english'].forEach((field) => expectString(value, field, path, issues));
    ['answerId', 'japanese', 'note'].forEach((field) => expectString(value, field, path, issues, true));
  });
}

function validateExercises(records: unknown[], issues: AiValidationIssue[]): void {
  records.forEach((value, index) => {
    const path = `$.exercises[${index}]`;
    if (!isRecord(value)) return issue(issues, path, 'invalid_type', 'Exerciseはオブジェクトである必要があります');
    validateCommon(value, EXERCISE_FIELDS, path, issues);
    ['senseId', 'prompt', 'siblingGroupId'].forEach((field) => expectString(value, field, path, issues));
    ['answerId', 'context', 'explanation', 'hint'].forEach((field) => expectString(value, field, path, issues, true));
    expectEnum(value, 'type', new Set([
      'flashcard', 'typed_output', 'fill_blank', 'reorder', 'multiple_choice',
      'guided_composition', 'free_composition',
    ]), path, issues);
    expectStringArray(value, 'acceptedAnswerIds', path, issues);
    expectStringArray(value, 'requiredTokens', path, issues, true);
    expectStringArray(value, 'forbiddenTokens', path, issues, true);
  });
}

type ContentRecord = MemoryItem | MemorySense | MemoryAnswer | MemoryExample | MemoryExercise;

function recordMap(content: MemoryContentBundle | undefined): Map<string, ContentRecord> {
  if (!content) return new Map();
  return new Map([
    ...content.items,
    ...content.senses,
    ...content.answers,
    ...content.examples,
    ...content.exercises,
  ].map((record) => [record.id, record]));
}

function comparableValue(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    : JSON.stringify(value) ?? String(value);
}

function looksLikeChangedId(entity: string, incoming: ContentRecord, current: MemoryContentBundle | undefined): ContentRecord | undefined {
  if (!current) return undefined;
  const candidates: ContentRecord[] = entity === 'items' ? current.items
    : entity === 'senses' ? current.senses
      : entity === 'answers' ? current.answers
        : entity === 'examples' ? current.examples
          : current.exercises;
  const fields = entity === 'items' ? ['label', 'lemma']
    : entity === 'senses' ? ['itemId', 'promptJa', 'meaningJa']
      : entity === 'answers' ? ['senseId', 'displayForm', 'citationForm']
        : entity === 'examples' ? ['senseId', 'answerId', 'english']
          : ['senseId', 'answerId', 'type', 'prompt'];
  const incomingRecord = incoming as unknown as Record<string, unknown>;
  return candidates.find((candidate) => candidate.id !== incoming.id && fields.every((field) =>
    comparableValue((candidate as unknown as Record<string, unknown>)[field])
      === comparableValue(incomingRecord[field]),
  ));
}

function checkIdsAndMetadata(
  document: AiContentDocument,
  current: MemoryContentBundle | undefined,
  issues: AiValidationIssue[],
): void {
  const incoming: Array<{ entity: string; record: ContentRecord }> = [
    ...document.items.map((record) => ({ entity: 'items', record })),
    ...document.senses.map((record) => ({ entity: 'senses', record })),
    ...document.answers.map((record) => ({ entity: 'answers', record })),
    ...document.examples.map((record) => ({ entity: 'examples', record })),
    ...document.exercises.map((record) => ({ entity: 'exercises', record })),
  ];
  const seen = new Map<string, string>();
  const currentRecords = recordMap(current);
  for (const { entity, record } of incoming) {
    const path = `$.${entity}[id=${record.id}]`;
    const previousEntity = seen.get(record.id);
    if (previousEntity) issue(issues, `${path}.id`, 'duplicate_id', `ID ${record.id} は${previousEntity}と重複しています`);
    else seen.set(record.id, entity);

    const existing = currentRecords.get(record.id);
    if (!existing) {
      if (record.source !== 'ai' || record.verificationStatus !== 'unverified_ai') {
        issue(issues, path, 'new_ai_metadata', 'AIの新規データはsource=aiかつunverified_aiである必要があります');
      }
      const priorId = looksLikeChangedId(entity, record, current);
      if (priorId) {
        issue(issues, `${path}.id`, 'protected_change', `既存ID ${priorId.id} は変更できません`);
      }
      continue;
    }
    const protectedFields: Array<keyof ContentRecord> = ['source', 'verificationStatus', 'createdAt', 'revision'];
    for (const field of protectedFields) {
      if (record[field] !== existing[field]) {
        issue(issues, `${path}.${field}`, 'protected_change', `${String(field)}はAIから変更できません`);
      }
    }
    const parentFields = ['itemId', 'senseId', 'answerId'] as const;
    for (const field of parentFields) {
      const before = field in existing ? existing[field as keyof typeof existing] : undefined;
      const after = field in record ? record[field as keyof typeof record] : undefined;
      if (before !== after) issue(issues, `${path}.${field}`, 'parent_mismatch', '既存データの親参照は変更できません');
    }
  }
}

function checkRelationships(document: AiContentDocument, current: MemoryContentBundle | undefined, issues: AiValidationIssue[]): void {
  const items = new Map([...(current?.items ?? []), ...document.items].map((record) => [record.id, record]));
  const senses = new Map([...(current?.senses ?? []), ...document.senses].map((record) => [record.id, record]));
  const answers = new Map([...(current?.answers ?? []), ...document.answers].map((record) => [record.id, record]));
  document.senses.forEach((sense, index) => {
    if (!items.has(sense.itemId)) issue(issues, `$.senses[${index}].itemId`, 'missing_parent', '参照先Itemが存在しません');
  });
  document.answers.forEach((answer, index) => {
    if (!senses.has(answer.senseId)) issue(issues, `$.answers[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
  });
  document.examples.forEach((example, index) => {
    if (!senses.has(example.senseId)) issue(issues, `$.examples[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
    if (example.answerId) {
      const answer = answers.get(example.answerId);
      if (!answer) issue(issues, `$.examples[${index}].answerId`, 'missing_parent', '参照先Answerが存在しません');
      else if (answer.senseId !== example.senseId) issue(issues, `$.examples[${index}].answerId`, 'parent_mismatch', 'AnswerとExampleのSenseが一致しません');
    }
  });
  document.exercises.forEach((exercise, index) => {
    if (!senses.has(exercise.senseId)) issue(issues, `$.exercises[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
    const ids = [...exercise.acceptedAnswerIds, ...(exercise.answerId ? [exercise.answerId] : [])];
    for (const id of ids) {
      const answer = answers.get(id);
      if (!answer) issue(issues, `$.exercises[${index}].acceptedAnswerIds`, 'missing_parent', `参照先Answer ${id} が存在しません`);
      else if (answer.senseId !== exercise.senseId) issue(issues, `$.exercises[${index}].acceptedAnswerIds`, 'parent_mismatch', '正解AnswerとExerciseのSenseが一致しません');
    }
  });
}

function checkExampleOnlyPolicy(
  document: AiContentDocument,
  current: MemoryContentBundle | undefined,
  issues: AiValidationIssue[],
): void {
  if (!current) return;
  const diff = diffAiContent(current, document);
  for (const operation of diff.operations) {
    if (operation.kind === 'add' && operation.entityType === 'example') continue;
    issue(
      issues,
      `$.${operation.entityType}s[id=${operation.entityId}]`,
      'example_only_violation',
      'AI差分では新しい例文だけ追加できます。既存データや例文以外は変更できません',
    );
  }
}

export function validateAiContentJson(
  input: string | unknown,
  options: ValidateAiContentOptions = {},
): AiValidationResult {
  const issues: AiValidationIssue[] = [];
  const maxJsonBytes = options.maxJsonBytes ?? 5_000_000;
  let value: unknown = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > maxJsonBytes) {
      issue(issues, '$', 'document_too_large', `JSONは${maxJsonBytes}バイト以内にしてください`);
      return { valid: false, issues, hasBaseRevisionConflict: false };
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      issue(issues, '$', 'invalid_json', 'JSONの構文が不正です');
      return { valid: false, issues, hasBaseRevisionConflict: false };
    }
  }
  scanUntrustedValue(value, {
    maxDepth: options.maxDepth ?? 12,
    maxStringLength: options.maxStringLength ?? 20_000,
    maxValues: options.maxValues ?? 100_000,
    allowExternalUrls: options.allowExternalUrls ?? false,
  }, issues);
  if (!isRecord(value)) {
    issue(issues, '$', 'invalid_type', 'AI用JSONはオブジェクトである必要があります');
    return { valid: false, issues, hasBaseRevisionConflict: false };
  }
  for (const key of Object.keys(value)) {
    if (!DOCUMENT_FIELDS.has(key)) issue(issues, `$.${key}`, 'unknown_field', `許可されていないフィールドです: ${key}`);
  }
  if (value.schemaVersion !== 1) issue(issues, '$.schemaVersion', 'invalid_value', 'schemaVersionは1である必要があります');
  if (value.exportType !== 'ai-content') issue(issues, '$.exportType', 'invalid_value', 'exportTypeはai-contentである必要があります');
  expectString(value, 'exportId', '$', issues);
  expectTimestamp(value, 'exportedAt', '$', issues);
  if (!Number.isInteger(value.baseRevision) || (value.baseRevision as number) < 0) {
    issue(issues, '$.baseRevision', 'invalid_type', 'baseRevisionは0以上の整数である必要があります');
  }
  const arrays = ['items', 'senses', 'answers', 'examples', 'exercises'] as const;
  arrays.forEach((field) => {
    if (!Array.isArray(value[field])) issue(issues, `$.${field}`, 'invalid_type', `${field}は配列である必要があります`);
  });
  if (arrays.some((field) => !Array.isArray(value[field]))) {
    return { valid: false, issues, hasBaseRevisionConflict: false };
  }
  validateItems(value.items as unknown[], issues);
  validateSenses(value.senses as unknown[], issues);
  validateAnswers(value.answers as unknown[], issues);
  validateExamples(value.examples as unknown[], issues);
  validateExercises(value.exercises as unknown[], issues);

  if (issues.some((entry) => entry.severity === 'error')) {
    return { valid: false, issues, hasBaseRevisionConflict: false };
  }

  // Casting is safe only after structural validators have run; a result containing
  // structural errors never exposes the document to callers.
  const candidate = value as unknown as AiContentDocument;
  checkIdsAndMetadata(candidate, options.currentContent, issues);
  checkRelationships(candidate, options.currentContent, issues);
  checkExampleOnlyPolicy(candidate, options.currentContent, issues);
  const hasBaseRevisionConflict = options.currentBaseRevision !== undefined
    && candidate.baseRevision !== options.currentBaseRevision;
  if (hasBaseRevisionConflict) {
    issue(
      issues,
      '$.baseRevision',
      'base_revision_conflict',
      'このJSONを出力した後に元データが変更されています',
      'warning',
    );
  }
  const valid = !issues.some((entry) => entry.severity === 'error');
  return { valid, issues, document: valid ? candidate : undefined, hasBaseRevisionConflict };
}

export type AiEntityType = 'item' | 'sense' | 'answer' | 'example' | 'exercise';
export type AiDiffKind = 'add' | 'change' | 'delete';

export interface AiDiffOperation {
  id: string;
  entityType: AiEntityType;
  entityId: string;
  kind: AiDiffKind;
  changedFields: string[];
  before?: ContentRecord;
  after?: ContentRecord;
}

export interface AiContentDiff {
  operations: AiDiffOperation[];
  summary: {
    newItems: number;
    newSenses: number;
    newAnswers: number;
    newExamples: number;
    newExercises: number;
    changed: number;
    deleted: number;
  };
}

const EDITABLE_FIELDS: Readonly<Record<AiEntityType, readonly string[]>> = {
  item: ['kind', 'label', 'lemma', 'tags'],
  sense: ['promptJa', 'meaningJa', 'explanation', 'siblingGroupId', 'tags'],
  answer: [
    'displayForm', 'citationForm', 'pattern', 'acceptedVariants', 'orthographicVariants',
    'register', 'nuance', 'note',
  ],
  example: ['english', 'japanese', 'note'],
  exercise: [
    'type', 'prompt', 'context', 'acceptedAnswerIds', 'requiredTokens', 'forbiddenTokens',
    'explanation', 'hint', 'siblingGroupId',
  ],
};

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function entityCollections(content: MemoryContentBundle): Array<{
  entityType: AiEntityType;
  records: ContentRecord[];
}> {
  return [
    { entityType: 'item', records: content.items },
    { entityType: 'sense', records: content.senses },
    { entityType: 'answer', records: content.answers },
    { entityType: 'example', records: content.examples },
    { entityType: 'exercise', records: content.exercises },
  ];
}

/** Produces preview-only operations. Deletions are never applied by this function. */
export function diffAiContent(
  current: MemoryContentBundle,
  incoming: AiContentDocument,
): AiContentDiff {
  const operations: AiDiffOperation[] = [];
  const incomingCollections = new Map(entityCollections(incoming).map((entry) => [entry.entityType, entry.records]));
  for (const currentCollection of entityCollections(current)) {
    const incomingRecords = incomingCollections.get(currentCollection.entityType) ?? [];
    const beforeMap = new Map(currentCollection.records.map((record) => [record.id, record]));
    const afterMap = new Map(incomingRecords.map((record) => [record.id, record]));
    for (const after of incomingRecords) {
      const before = beforeMap.get(after.id);
      if (!before) {
        operations.push({
          id: `${currentCollection.entityType}:${after.id}:add`,
          entityType: currentCollection.entityType,
          entityId: after.id,
          kind: 'add',
          changedFields: [...EDITABLE_FIELDS[currentCollection.entityType]],
          after,
        });
        continue;
      }
      if (!before.deletedAt && after.deletedAt) {
        operations.push({
          id: `${currentCollection.entityType}:${after.id}:delete`,
          entityType: currentCollection.entityType,
          entityId: after.id,
          kind: 'delete',
          changedFields: ['deletedAt'],
          before,
          after,
        });
        continue;
      }
      const changedFields = EDITABLE_FIELDS[currentCollection.entityType].filter(
        (field) => !equalValue(
          (before as unknown as Record<string, unknown>)[field],
          (after as unknown as Record<string, unknown>)[field],
        ),
      );
      if (changedFields.length > 0) {
        operations.push({
          id: `${currentCollection.entityType}:${after.id}:change`,
          entityType: currentCollection.entityType,
          entityId: after.id,
          kind: 'change',
          changedFields,
          before,
          after,
        });
      }
    }
    for (const before of currentCollection.records) {
      if (!before.deletedAt && !afterMap.has(before.id)) {
        operations.push({
          id: `${currentCollection.entityType}:${before.id}:delete`,
          entityType: currentCollection.entityType,
          entityId: before.id,
          kind: 'delete',
          changedFields: ['omitted'],
          before,
        });
      }
    }
  }
  const additions = (entityType: AiEntityType) => operations.filter(
    (operation) => operation.kind === 'add' && operation.entityType === entityType,
  ).length;
  return {
    operations,
    summary: {
      newItems: additions('item'),
      newSenses: additions('sense'),
      newAnswers: additions('answer'),
      newExamples: additions('example'),
      newExercises: additions('exercise'),
      changed: operations.filter((operation) => operation.kind === 'change').length,
      deleted: operations.filter((operation) => operation.kind === 'delete').length,
    },
  };
}
