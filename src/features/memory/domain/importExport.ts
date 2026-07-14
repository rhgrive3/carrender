import type {
  MemoryAnswer,
  MemoryAttempt,
  MemoryContentBundle,
  MemorySense,
  MemorySession,
  MemorySet,
  MemorySetBundle,
  MemorySetMember,
  MemoryStat,
} from './types';
import { normalizeAnswerText, normalizeSearchText } from './normalization';

export type ImportTextFormat = 'empty' | 'json' | 'tsv' | 'csv' | 'equals' | 'arrow';

export interface ParsedImportRow {
  english: string;
  japanese: string;
  meaning?: string;
  example?: string;
  tags: string[];
  setName?: string;
  sourceLine: number;
}

export interface ImportParseError {
  line: number;
  message: string;
}

export interface ImportParseResult {
  format: ImportTextFormat;
  rows: ParsedImportRow[];
  errors: ImportParseError[];
  jsonValue?: unknown;
}

const SIMPLE_IMPORT_MAX_BYTES = 5_000_000;
const SIMPLE_IMPORT_MAX_DEPTH = 12;
const SIMPLE_IMPORT_MAX_VALUES = 100_000;
const SIMPLE_IMPORT_MAX_STRING = 20_000;
const SIMPLE_JSON_ROW_FIELDS = new Set([
  'english', 'en', 'answer', 'displayForm', 'japanese', 'ja', 'promptJa', 'meaningJa',
  'meaning', 'example', 'tags', 'set',
]);

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): { cells: string[][]; errors: ImportParseError[] } {
  const rows: string[][] = [];
  const errors: ImportParseError[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
        if (character === '\n') line += 1;
      }
      continue;
    }
    if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      line += 1;
      rowLine = line;
    } else {
      cell += character;
    }
  }
  if (quoted) errors.push({ line: rowLine, message: '引用符が閉じられていません' });
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return { cells: rows, errors };
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_・]+/gu, '')
    .replace(/-/g, '');
}

const HEADER_ALIASES = {
  english: new Set(['english', '英語', 'en', 'answer', '回答']),
  japanese: new Set(['japanese', '日本語', 'ja', 'promptja', '意味']),
  meaning: new Set(['meaning', 'meaningja', '意味ニュアンス', 'ニュアンス', '説明']),
  example: new Set(['example', '例文']),
  tags: new Set(['tag', 'tags', 'タグ']),
  setName: new Set(['set', 'setname', 'セット']),
} as const;

function headerIndex(row: readonly string[], aliases: ReadonlySet<string>): number {
  return row.findIndex((value) => aliases.has(normalizeHeader(value)));
}

function mapCellsToRows(cells: string[][], errors: ImportParseError[]): ParsedImportRow[] {
  if (cells.length === 0) return [];
  const first = cells[0];
  const englishHeader = headerIndex(first, HEADER_ALIASES.english);
  const japaneseHeader = headerIndex(first, HEADER_ALIASES.japanese);
  const hasHeader = englishHeader >= 0 || japaneseHeader >= 0;
  const indexes = {
    english: englishHeader >= 0 ? englishHeader : 0,
    japanese: japaneseHeader >= 0 ? japaneseHeader : 1,
    meaning: hasHeader ? headerIndex(first, HEADER_ALIASES.meaning) : 2,
    example: hasHeader ? headerIndex(first, HEADER_ALIASES.example) : 3,
    tags: hasHeader ? headerIndex(first, HEADER_ALIASES.tags) : 4,
    setName: hasHeader ? headerIndex(first, HEADER_ALIASES.setName) : 5,
  };
  return cells.slice(hasHeader ? 1 : 0).flatMap((row, index) => {
    const sourceLine = index + (hasHeader ? 2 : 1);
    const english = (row[indexes.english] ?? '').trim();
    const japanese = (row[indexes.japanese] ?? '').trim();
    if (!english || !japanese) {
      errors.push({ line: sourceLine, message: '英語と日本語の両方が必要です' });
      return [];
    }
    const value = (position: number): string | undefined => position >= 0
      ? (row[position] ?? '').trim() || undefined
      : undefined;
    return [{
      english,
      japanese,
      meaning: value(indexes.meaning),
      example: value(indexes.example),
      tags: (value(indexes.tags) ?? '').split(/[、,]/u).map((tag) => tag.trim()).filter(Boolean),
      setName: value(indexes.setName),
      sourceLine,
    }];
  });
}

export function detectImportTextFormat(text: string): ImportTextFormat {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.includes('\t')) return 'tsv';
  const lines = trimmed.split(/\r?\n/u).filter(Boolean);
  if (lines.every((line) => line.includes('→') || line.includes('->'))) return 'arrow';
  if (lines.every((line) => line.includes('=') && !line.includes(','))) return 'equals';
  return 'csv';
}

function parsePairLines(text: string, format: 'equals' | 'arrow'): ImportParseResult {
  const errors: ImportParseError[] = [];
  const rows = text.split(/\r?\n/u).flatMap((raw, index) => {
    const line = raw.trim();
    if (!line) return [];
    const delimiter = format === 'equals' ? /=/u : /→|->/u;
    const match = delimiter.exec(line);
    if (!match || match.index <= 0) {
      errors.push({ line: index + 1, message: '英語と日本語の区切りを確認してください' });
      return [];
    }
    const english = line.slice(0, match.index).trim();
    const japanese = line.slice(match.index + match[0].length).trim();
    if (!english || !japanese) {
      errors.push({ line: index + 1, message: '英語と日本語の両方が必要です' });
      return [];
    }
    if (english.length > SIMPLE_IMPORT_MAX_STRING || japanese.length > SIMPLE_IMPORT_MAX_STRING) {
      errors.push({ line: index + 1, message: `各項目は${SIMPLE_IMPORT_MAX_STRING}文字以内にしてください` });
      return [];
    }
    return [{ english, japanese, tags: [], sourceLine: index + 1 }];
  });
  return { format, rows, errors };
}

function jsonRows(value: unknown, errors: ImportParseError[]): ParsedImportRow[] {
  const records = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)
      ? (value as { rows: unknown[] }).rows
      : [];
  if (records.length === 0) return [];
  return records.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ line: index + 1, message: 'JSON行はオブジェクトである必要があります' });
      return [];
    }
    const record = entry as Record<string, unknown>;
    const unknownFields = Object.keys(record).filter((key) => !SIMPLE_JSON_ROW_FIELDS.has(key));
    if (unknownFields.length > 0) {
      errors.push({ line: index + 1, message: `許可されていないJSONフィールドです: ${unknownFields.join('、')}` });
      return [];
    }
    const englishValue = record.english ?? record.en ?? record.answer ?? record.displayForm;
    const japaneseValue = record.japanese ?? record.ja ?? record.promptJa ?? record.meaningJa;
    if (typeof englishValue !== 'string' || typeof japaneseValue !== 'string'
      || !englishValue.trim() || !japaneseValue.trim()) {
      errors.push({ line: index + 1, message: 'JSON行に英語と日本語の文字列が必要です' });
      return [];
    }
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : typeof record.tags === 'string'
        ? record.tags.split(/[、,]/u).map((tag) => tag.trim()).filter(Boolean)
        : [];
    return [{
      english: englishValue.trim(),
      japanese: japaneseValue.trim(),
      meaning: typeof record.meaning === 'string' ? record.meaning.trim() || undefined : undefined,
      example: typeof record.example === 'string' ? record.example.trim() || undefined : undefined,
      tags,
      setName: typeof record.set === 'string' ? record.set.trim() || undefined : undefined,
      sourceLine: index + 1,
    }];
  });
}

function scanSimpleImportJson(value: unknown, errors: ImportParseError[]): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let values = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    values += 1;
    if (values > SIMPLE_IMPORT_MAX_VALUES) {
      errors.push({ line: 1, message: 'JSON内の値が多すぎます' });
      return;
    }
    if (current.depth > SIMPLE_IMPORT_MAX_DEPTH) {
      errors.push({ line: 1, message: 'JSONの入れ子が深すぎます' });
      return;
    }
    if (typeof current.value === 'string') {
      if (current.value.length > SIMPLE_IMPORT_MAX_STRING) {
        errors.push({ line: 1, message: `文字列は${SIMPLE_IMPORT_MAX_STRING}文字以内にしてください` });
        return;
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    for (const [key, entry] of Object.entries(current.value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        errors.push({ line: 1, message: '危険なJSONプロパティ名は使用できません' });
        return;
      }
      stack.push({ value: entry, depth: current.depth + 1 });
    }
  }
}

/** Parses paste/CSV/TSV/JSON without executing or rendering input as HTML. */
export function parseImportText(text: string, requestedFormat?: ImportTextFormat): ImportParseResult {
  const format = requestedFormat ?? detectImportTextFormat(text);
  if (format === 'empty') return { format, rows: [], errors: [] };
  if (new TextEncoder().encode(text).byteLength > SIMPLE_IMPORT_MAX_BYTES) {
    return { format, rows: [], errors: [{ line: 1, message: '取込データは5MB以内にしてください' }] };
  }
  if (/<\s*\/?\s*(?:script|iframe|table|html)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/iu.test(text)) {
    return { format, rows: [], errors: [{ line: 1, message: 'HTMLは取込できません。プレーンテキストとして貼り付けてください' }] };
  }
  if (format === 'equals' || format === 'arrow') return parsePairLines(text, format);
  if (format === 'json') {
    try {
      const jsonValue: unknown = JSON.parse(text);
      const errors: ImportParseError[] = [];
      scanSimpleImportJson(jsonValue, errors);
      if (jsonValue && typeof jsonValue === 'object' && !Array.isArray(jsonValue)) {
        const unknownRootFields = Object.keys(jsonValue as Record<string, unknown>).filter((key) => key !== 'rows');
        if (unknownRootFields.length > 0) {
          errors.push({ line: 1, message: `許可されていないJSONフィールドです: ${unknownRootFields.join('、')}` });
        }
      }
      if (errors.length > 0) return { format, rows: [], errors, jsonValue };
      const rows = jsonRows(jsonValue, errors);
      return { format, rows, errors, jsonValue };
    } catch {
      return { format, rows: [], errors: [{ line: 1, message: 'JSONの構文が不正です' }] };
    }
  }
  const parsed = parseDelimitedRows(text, format === 'tsv' ? '\t' : ',');
  const rows = mapCellsToRows(parsed.cells, parsed.errors);
  if (parsed.cells.some((row) => row.some((cell) => cell.length > SIMPLE_IMPORT_MAX_STRING))) {
    parsed.errors.push({ line: 1, message: `各セルは${SIMPLE_IMPORT_MAX_STRING}文字以内にしてください` });
  }
  return { format, rows, errors: parsed.errors };
}

export interface AiContentDocument extends MemoryContentBundle {
  schemaVersion: 1;
  exportType: 'ai-content';
  exportId: string;
  baseRevision: number;
  exportedAt: string;
}

export interface AiExportOptions {
  exportId: string;
  baseRevision: number;
  exportedAt: string;
  includeDeleted?: boolean;
}

function cloneContent(bundle: MemoryContentBundle, includeDeleted: boolean): MemoryContentBundle {
  const active = <T extends { deletedAt?: string }>(records: readonly T[]): T[] => records
    .filter((record) => includeDeleted || !record.deletedAt)
    .map((record) => ({ ...record }));
  return {
    items: active(bundle.items).map((item) => ({ ...item, tags: [...item.tags] })),
    senses: active(bundle.senses).map((sense) => ({ ...sense, tags: [...sense.tags] })),
    answers: active(bundle.answers).map((answer) => ({
      ...answer,
      acceptedVariants: [...answer.acceptedVariants],
      orthographicVariants: [...answer.orthographicVariants],
    })),
    examples: active(bundle.examples),
    exercises: active(bundle.exercises).map((exercise) => ({
      ...exercise,
      acceptedAnswerIds: [...exercise.acceptedAnswerIds],
      requiredTokens: exercise.requiredTokens ? [...exercise.requiredTokens] : undefined,
      forbiddenTokens: exercise.forbiddenTokens ? [...exercise.forbiddenTokens] : undefined,
    })),
  };
}

export function createAiContentExport(
  bundle: MemoryContentBundle,
  options: AiExportOptions,
): AiContentDocument {
  return {
    schemaVersion: 1,
    exportType: 'ai-content',
    exportId: options.exportId,
    baseRevision: options.baseRevision,
    exportedAt: options.exportedAt,
    ...cloneContent(bundle, options.includeDeleted ?? false),
  };
}

export const CHATGPT_CONTENT_REQUEST = `このJSONの既存データを削除・置換せず、例文だけを補完してください。
各既存Senseについて、学習に有用で自然な例文が不足している場合だけ、examplesへ英文と和訳を追加してください。
ルール：
- 追加してよいのはexamples配列の新規要素だけ
- items、senses、answers、exercisesを追加・変更・削除しない
- 既存examplesを変更・削除しない
- 例文は既存Senseの意味と既存Answerの用法に一致させる
- 特定のAnswerを使う例文は、その既存answerIdを設定する
- schemaVersionを変更しない
- 既存idを変更しない
- 新規Exampleには重複しないidを付ける
- 新規Exampleにはsource: "ai"を付ける
- 新規ExampleにはverificationStatus: "unverified_ai"を付ける
- 成績、回答履歴、セッション、ユーザー情報を追加しない
- JSON以外の文章を出力しない`;

export type ImportDuplicateKind =
  | 'same_item'
  | 'same_sense'
  | 'same_answer'
  | 'orthographic_answer'
  | 'normalized_answer';

export interface ImportDuplicateCandidate {
  rowIndex: number;
  kind: ImportDuplicateKind;
  itemId: string;
  senseId?: string;
  answerId?: string;
}

/** Candidate-only duplicate detection; it deliberately never merges records. */
export function findImportDuplicateCandidates(
  rows: readonly ParsedImportRow[],
  content: MemoryContentBundle,
): ImportDuplicateCandidate[] {
  const sensesByItem = new Map<string, MemorySense[]>();
  const answersBySense = new Map<string, MemoryAnswer[]>();
  for (const sense of content.senses) {
    if (sense.deletedAt) continue;
    const senses = sensesByItem.get(sense.itemId) ?? [];
    senses.push(sense);
    sensesByItem.set(sense.itemId, senses);
  }
  for (const answer of content.answers) {
    if (answer.deletedAt) continue;
    const answers = answersBySense.get(answer.senseId) ?? [];
    answers.push(answer);
    answersBySense.set(answer.senseId, answers);
  }
  const candidates: ImportDuplicateCandidate[] = [];
  rows.forEach((row, rowIndex) => {
    const english = normalizeAnswerText(row.english);
    const japanese = normalizeSearchText(row.japanese);
    for (const item of content.items) {
      if (item.deletedAt) continue;
      const senses = sensesByItem.get(item.id) ?? [];
      const itemAnswers = senses.flatMap((sense) => answersBySense.get(sense.id) ?? []);
      const sameItem = normalizeAnswerText(item.label) === english
        || normalizeAnswerText(item.lemma ?? '') === english
        || itemAnswers.some((answer) =>
          normalizeAnswerText(answer.displayForm) === english
          || normalizeAnswerText(answer.citationForm) === english,
        );
      if (sameItem) candidates.push({ rowIndex, kind: 'same_item', itemId: item.id });
      for (const sense of senses) {
        const sameSense = normalizeSearchText(sense.promptJa) === japanese
          || normalizeSearchText(sense.meaningJa) === japanese;
        if (sameItem && sameSense) candidates.push({ rowIndex, kind: 'same_sense', itemId: item.id, senseId: sense.id });
        for (const answer of answersBySense.get(sense.id) ?? []) {
          if (answer.displayForm === row.english || answer.citationForm === row.english) {
            candidates.push({ rowIndex, kind: 'same_answer', itemId: item.id, senseId: sense.id, answerId: answer.id });
          } else if (answer.orthographicVariants.some((variant) => normalizeAnswerText(variant) === english)) {
            candidates.push({ rowIndex, kind: 'orthographic_answer', itemId: item.id, senseId: sense.id, answerId: answer.id });
          } else if (
            normalizeAnswerText(answer.displayForm) === english
            || normalizeAnswerText(answer.citationForm) === english
            || answer.acceptedVariants.some((variant) => normalizeAnswerText(variant) === english)
          ) {
            candidates.push({ rowIndex, kind: 'normalized_answer', itemId: item.id, senseId: sense.id, answerId: answer.id });
          }
        }
      }
    }
  });
  return [...new Map(candidates.map((candidate) => [
    `${candidate.rowIndex}:${candidate.kind}:${candidate.itemId}:${candidate.senseId ?? ''}:${candidate.answerId ?? ''}`,
    candidate,
  ])).values()];
}

export interface SelectedSetExport extends MemorySetBundle {
  schemaVersion: 1;
  exportType: 'selected-sets';
  exportId: string;
  exportedAt: string;
  stats?: MemoryStat[];
}

export interface SelectedSetExportCounts {
  sets: number;
  members: number;
  items: number;
  senses: number;
  answers: number;
  examples: number;
  exercises: number;
  stats: number;
}

export interface SelectedSetExportParseResult {
  /** Lets callers distinguish this format from simple row JSON. */
  recognized: boolean;
  valid: boolean;
  issues: BackupValidationIssue[];
  document?: SelectedSetExport;
  counts?: SelectedSetExportCounts;
  /** True only when the untrusted document explicitly contained a stats field. */
  hasStats: boolean;
}

export function createSelectedSetExport(input: {
  sets: readonly MemorySet[];
  setMembers: readonly MemorySetMember[];
  content: MemoryContentBundle;
  selectedSetIds: readonly string[];
  exportId: string;
  exportedAt: string;
  includeStats?: boolean;
  stats?: readonly MemoryStat[];
}): SelectedSetExport {
  const selected = new Set(input.selectedSetIds);
  const sets = input.sets.filter((set) => selected.has(set.id) && !set.deletedAt).map((set) => ({ ...set, tags: [...set.tags] }));
  const setIds = new Set(sets.map((set) => set.id));
  const candidateMembers = input.setMembers
    .filter((member) => setIds.has(member.setId) && !member.deletedAt)
    .map((member) => ({ ...member }));
  const itemIds = new Set(candidateMembers.map((member) => member.itemId));
  const items = input.content.items.filter((item) => itemIds.has(item.id) && !item.deletedAt);
  const includedItemIds = new Set(items.map((item) => item.id));
  const setMembers = candidateMembers.filter((member) => includedItemIds.has(member.itemId));
  const senses = input.content.senses.filter((sense) => includedItemIds.has(sense.itemId) && !sense.deletedAt);
  const senseIds = new Set(senses.map((sense) => sense.id));
  const answers = input.content.answers.filter((answer) => senseIds.has(answer.senseId) && !answer.deletedAt);
  const examples = input.content.examples.filter((example) => senseIds.has(example.senseId) && !example.deletedAt);
  const exercises = input.content.exercises.filter((exercise) => senseIds.has(exercise.senseId) && !exercise.deletedAt);
  const content = cloneContent({ items, senses, answers, examples, exercises }, false);
  const targetIds = new Set([
    ...content.senses.map((record) => record.id),
    ...content.answers.map((record) => record.id),
    ...content.exercises.map((record) => record.id),
  ]);
  return {
    schemaVersion: 1,
    exportType: 'selected-sets',
    exportId: input.exportId,
    exportedAt: input.exportedAt,
    sets,
    setMembers,
    ...content,
    ...(input.includeStats
      ? { stats: (input.stats ?? []).filter((stat) => targetIds.has(stat.targetId)).map((stat) => ({ ...stat })) }
      : {}),
  };
}

export interface FullMemoryBackup extends MemorySetBundle {
  schemaVersion: 1;
  backupVersion: 1;
  exportType: 'full-backup';
  exportedAt: string;
  stats: MemoryStat[];
  attempts: MemoryBackupAttempt[];
  sessions: MemorySession[];
  settings: Record<string, unknown>;
}

export interface MemoryBackupAttempt extends MemoryAttempt {
  /** Append-only cancellation metadata; the original Attempt remains intact. */
  undoneAt?: string;
}

export type BackupValidationCode =
  | 'invalid_json'
  | 'document_too_large'
  | 'too_deep'
  | 'too_many_values'
  | 'string_too_long'
  | 'dangerous_text'
  | 'dangerous_key'
  | 'unknown_field'
  | 'invalid_type'
  | 'invalid_value'
  | 'duplicate_id'
  | 'missing_parent'
  | 'parent_mismatch';

export interface BackupValidationIssue {
  path: string;
  code: BackupValidationCode;
  message: string;
}

export interface FullMemoryBackupCounts {
  sets: number;
  items: number;
  senses: number;
  answers: number;
  examples: number;
  exercises: number;
  stats: number;
  attempts: number;
  sessions: number;
}

export interface FullMemoryBackupParseResult {
  valid: boolean;
  issues: BackupValidationIssue[];
  backup?: FullMemoryBackup;
  counts?: FullMemoryBackupCounts;
}

export interface FullMemoryBackupParseOptions {
  maxJsonBytes?: number;
  maxDepth?: number;
  maxStringLength?: number;
  maxValues?: number;
}

const BACKUP_DOCUMENT_FIELDS = new Set([
  'schemaVersion', 'backupVersion', 'exportType', 'exportedAt', 'sets', 'setMembers',
  'items', 'senses', 'answers', 'examples', 'exercises', 'stats', 'attempts',
  'sessions', 'settings',
]);
const SELECTED_SET_DOCUMENT_FIELDS = new Set([
  'schemaVersion', 'exportType', 'exportId', 'exportedAt', 'sets', 'setMembers',
  'items', 'senses', 'answers', 'examples', 'exercises', 'stats',
]);
const BACKUP_COMMON_FIELDS = ['id', 'source', 'verificationStatus', 'createdAt', 'updatedAt', 'revision', 'deletedAt'] as const;
const BACKUP_ITEM_FIELDS = new Set([...BACKUP_COMMON_FIELDS, 'kind', 'label', 'lemma', 'tags']);
const BACKUP_SENSE_FIELDS = new Set([...BACKUP_COMMON_FIELDS, 'itemId', 'promptJa', 'meaningJa', 'explanation', 'siblingGroupId', 'tags']);
const BACKUP_ANSWER_FIELDS = new Set([
  ...BACKUP_COMMON_FIELDS, 'senseId', 'displayForm', 'citationForm', 'pattern',
  'acceptedVariants', 'orthographicVariants', 'register', 'nuance', 'note',
]);
const BACKUP_EXAMPLE_FIELDS = new Set([...BACKUP_COMMON_FIELDS, 'senseId', 'answerId', 'english', 'japanese', 'note']);
const BACKUP_EXERCISE_FIELDS = new Set([
  ...BACKUP_COMMON_FIELDS, 'senseId', 'answerId', 'type', 'prompt', 'context',
  'acceptedAnswerIds', 'requiredTokens', 'forbiddenTokens', 'explanation', 'hint',
  'siblingGroupId',
]);
const BACKUP_SET_FIELDS = new Set(['id', 'name', 'description', 'tags', 'createdAt', 'updatedAt', 'revision', 'deletedAt']);
const BACKUP_MEMBER_FIELDS = new Set(['setId', 'itemId', 'order', 'createdAt', 'deletedAt']);
const BACKUP_STAT_FIELDS = new Set([
  'id', 'targetType', 'targetId', 'mode', 'attempts', 'correctCount', 'partialCount',
  'incorrectCount', 'skippedCount', 'consecutiveCorrect', 'consecutiveIncorrect',
  'averageResponseMs', 'hintCount', 'manualWeak', 'weaknessScore', 'revision', 'lastAttemptAt', 'updatedAt',
]);
const BACKUP_ATTEMPT_FIELDS = new Set([
  'attemptId', 'sessionId', 'clientId', 'itemId', 'senseId', 'answerId', 'exerciseId',
  'targetId', 'mode', 'exerciseType', 'userAnswer', 'normalizedAnswer', 'assessment',
  'errorTypes', 'hintUsed', 'responseMs', 'createdAt', 'syncedAt', 'undoneAt',
]);
const BACKUP_SESSION_FIELDS = new Set([
  'id', 'status', 'selectedSetIds', 'initialTargetIds', 'config', 'seed',
  'currentTargetId', 'queueState', 'completedTargetIds', 'needsReviewTargetIds',
  'answerCount', 'createdAt', 'updatedAt', 'completedAt',
]);
const BACKUP_CONFIG_FIELDS = new Set([
  'questionCount', 'direction', 'includeUnverifiedAi', 'preferredExerciseType', 'modeWeights',
]);
const BACKUP_QUESTION_COUNT_FIELDS = new Set(['type', 'count']);
const BACKUP_MODES = new Set(['input', 'output', 'context', 'composition']);
const BACKUP_EXERCISE_TYPES = new Set([
  'flashcard', 'typed_output', 'fill_blank', 'reorder', 'multiple_choice',
  'guided_composition', 'free_composition',
]);
const BACKUP_ERROR_TYPES = new Set([
  'meaning', 'recall', 'spelling', 'word_form', 'article', 'preposition', 'word_order',
  'tense', 'agreement', 'register', 'context', 'other',
]);

function backupRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function backupIssue(
  issues: BackupValidationIssue[],
  path: string,
  code: BackupValidationCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function checkBackupFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: BackupValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) backupIssue(issues, `${path}.${key}`, 'unknown_field', `許可されていないフィールドです: ${key}`);
  }
}

function backupString(
  value: Record<string, unknown>,
  field: string,
  path: string,
  issues: BackupValidationIssue[],
  optional = false,
): void {
  const candidate = value[field];
  if (optional && candidate === undefined) return;
  if (typeof candidate !== 'string' || (!optional && candidate.trim() === '')) {
    backupIssue(issues, `${path}.${field}`, 'invalid_type', `${field}は空でない文字列である必要があります`);
  }
}

function backupTimestamp(
  value: Record<string, unknown>,
  field: string,
  path: string,
  issues: BackupValidationIssue[],
  optional = false,
): void {
  const candidate = value[field];
  if (optional && candidate === undefined) return;
  if (typeof candidate !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(candidate) || Number.isNaN(Date.parse(candidate))) {
    backupIssue(issues, `${path}.${field}`, 'invalid_value', `${field}はISO日時である必要があります`);
  }
}

function backupNumber(
  value: Record<string, unknown>,
  field: string,
  path: string,
  issues: BackupValidationIssue[],
  options: { integer?: boolean; min?: number; max?: number } = {},
): void {
  const candidate = value[field];
  const valid = typeof candidate === 'number'
    && Number.isFinite(candidate)
    && (!options.integer || Number.isInteger(candidate))
    && (options.min === undefined || candidate >= options.min)
    && (options.max === undefined || candidate <= options.max);
  if (!valid) backupIssue(issues, `${path}.${field}`, 'invalid_value', `${field}の数値が不正です`);
}

function backupEnum(
  value: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<string>,
  path: string,
  issues: BackupValidationIssue[],
  optional = false,
): void {
  const candidate = value[field];
  if (optional && candidate === undefined) return;
  if (typeof candidate !== 'string' || !allowed.has(candidate)) {
    backupIssue(issues, `${path}.${field}`, 'invalid_value', `${field}の値が不正です`);
  }
}

function backupStringArray(
  value: Record<string, unknown>,
  field: string,
  path: string,
  issues: BackupValidationIssue[],
  optional = false,
  allowed?: ReadonlySet<string>,
): void {
  const candidate = value[field];
  if (optional && candidate === undefined) return;
  if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== 'string' || (allowed && !allowed.has(entry)))) {
    backupIssue(issues, `${path}.${field}`, 'invalid_type', `${field}は有効な文字列配列である必要があります`);
  }
}

function validateBackupCommon(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  path: string,
  issues: BackupValidationIssue[],
): void {
  checkBackupFields(value, fields, path, issues);
  backupString(value, 'id', path, issues);
  backupEnum(value, 'source', new Set(['user', 'import', 'ai']), path, issues);
  backupEnum(value, 'verificationStatus', new Set(['verified', 'unverified_ai']), path, issues);
  backupTimestamp(value, 'createdAt', path, issues);
  backupTimestamp(value, 'updatedAt', path, issues);
  backupNumber(value, 'revision', path, issues, { integer: true, min: 0 });
  backupTimestamp(value, 'deletedAt', path, issues, true);
}

function scanBackupValue(
  value: unknown,
  options: Required<Pick<FullMemoryBackupParseOptions, 'maxDepth' | 'maxStringLength' | 'maxValues'>>,
  issues: BackupValidationIssue[],
): void {
  let values = 0;
  let stopped = false;
  const visit = (candidate: unknown, path: string, depth: number): void => {
    if (stopped) return;
    values += 1;
    if (values > options.maxValues) {
      backupIssue(issues, path, 'too_many_values', 'JSON内の値が多すぎます');
      stopped = true;
      return;
    }
    if (depth > options.maxDepth) {
      backupIssue(issues, path, 'too_deep', 'JSONの入れ子が深すぎます');
      return;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > options.maxStringLength) {
        backupIssue(issues, path, 'string_too_long', `文字列は${options.maxStringLength}文字以内にしてください`);
      }
      if (/<\s*\/?\s*(?:script|iframe)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/iu.test(candidate)) {
        backupIssue(issues, path, 'dangerous_text', '実行可能なHTMLまたはURLは使用できません');
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!backupRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        backupIssue(issues, `${path}.${key}`, 'dangerous_key', '危険なプロパティ名は使用できません');
      }
      visit(entry, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, '$', 0);
}

function validateBackupContentArrays(value: Record<string, unknown>, issues: BackupValidationIssue[]): void {
  (value.items as unknown[]).forEach((candidate, index) => {
    const path = `$.items[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Itemはオブジェクトである必要があります');
    validateBackupCommon(candidate, BACKUP_ITEM_FIELDS, path, issues);
    backupEnum(candidate, 'kind', new Set(['word', 'phrase', 'expression', 'construction', 'composition']), path, issues);
    backupString(candidate, 'label', path, issues);
    backupString(candidate, 'lemma', path, issues, true);
    backupStringArray(candidate, 'tags', path, issues);
  });
  (value.senses as unknown[]).forEach((candidate, index) => {
    const path = `$.senses[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Senseはオブジェクトである必要があります');
    validateBackupCommon(candidate, BACKUP_SENSE_FIELDS, path, issues);
    ['itemId', 'promptJa', 'meaningJa', 'siblingGroupId'].forEach((field) => backupString(candidate, field, path, issues));
    backupString(candidate, 'explanation', path, issues, true);
    backupStringArray(candidate, 'tags', path, issues);
  });
  (value.answers as unknown[]).forEach((candidate, index) => {
    const path = `$.answers[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Answerはオブジェクトである必要があります');
    validateBackupCommon(candidate, BACKUP_ANSWER_FIELDS, path, issues);
    ['senseId', 'displayForm', 'citationForm'].forEach((field) => backupString(candidate, field, path, issues));
    ['pattern', 'nuance', 'note'].forEach((field) => backupString(candidate, field, path, issues, true));
    backupStringArray(candidate, 'acceptedVariants', path, issues);
    backupStringArray(candidate, 'orthographicVariants', path, issues);
    backupEnum(candidate, 'register', new Set(['neutral', 'formal', 'informal', 'literary']), path, issues, true);
  });
  (value.examples as unknown[]).forEach((candidate, index) => {
    const path = `$.examples[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Exampleはオブジェクトである必要があります');
    validateBackupCommon(candidate, BACKUP_EXAMPLE_FIELDS, path, issues);
    backupString(candidate, 'senseId', path, issues);
    backupString(candidate, 'english', path, issues);
    ['answerId', 'japanese', 'note'].forEach((field) => backupString(candidate, field, path, issues, true));
  });
  (value.exercises as unknown[]).forEach((candidate, index) => {
    const path = `$.exercises[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Exerciseはオブジェクトである必要があります');
    validateBackupCommon(candidate, BACKUP_EXERCISE_FIELDS, path, issues);
    ['senseId', 'prompt', 'siblingGroupId'].forEach((field) => backupString(candidate, field, path, issues));
    ['answerId', 'context', 'explanation', 'hint'].forEach((field) => backupString(candidate, field, path, issues, true));
    backupEnum(candidate, 'type', BACKUP_EXERCISE_TYPES, path, issues);
    backupStringArray(candidate, 'acceptedAnswerIds', path, issues);
    backupStringArray(candidate, 'requiredTokens', path, issues, true);
    backupStringArray(candidate, 'forbiddenTokens', path, issues, true);
  });
}

function validateBackupSetArrays(value: Record<string, unknown>, issues: BackupValidationIssue[]): void {
  (value.sets as unknown[]).forEach((candidate, index) => {
    const path = `$.sets[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Setはオブジェクトである必要があります');
    checkBackupFields(candidate, BACKUP_SET_FIELDS, path, issues);
    backupString(candidate, 'id', path, issues);
    backupString(candidate, 'name', path, issues);
    backupString(candidate, 'description', path, issues, true);
    backupStringArray(candidate, 'tags', path, issues);
    backupTimestamp(candidate, 'createdAt', path, issues);
    backupTimestamp(candidate, 'updatedAt', path, issues);
    backupNumber(candidate, 'revision', path, issues, { integer: true, min: 0 });
    backupTimestamp(candidate, 'deletedAt', path, issues, true);
  });
  (value.setMembers as unknown[]).forEach((candidate, index) => {
    const path = `$.setMembers[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'SetMemberはオブジェクトである必要があります');
    checkBackupFields(candidate, BACKUP_MEMBER_FIELDS, path, issues);
    backupString(candidate, 'setId', path, issues);
    backupString(candidate, 'itemId', path, issues);
    backupNumber(candidate, 'order', path, issues, { integer: true, min: 0 });
    backupTimestamp(candidate, 'createdAt', path, issues);
    backupTimestamp(candidate, 'deletedAt', path, issues, true);
  });
}

function validateBackupStatsAndAttempts(value: Record<string, unknown>, issues: BackupValidationIssue[]): void {
  (value.stats as unknown[]).forEach((candidate, index) => {
    const path = `$.stats[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Statはオブジェクトである必要があります');
    checkBackupFields(candidate, BACKUP_STAT_FIELDS, path, issues);
    ['id', 'targetId'].forEach((field) => backupString(candidate, field, path, issues));
    backupEnum(candidate, 'targetType', new Set(['sense', 'answer', 'exercise']), path, issues);
    backupEnum(candidate, 'mode', BACKUP_MODES, path, issues);
    ['attempts', 'correctCount', 'partialCount', 'incorrectCount', 'skippedCount', 'consecutiveCorrect', 'consecutiveIncorrect', 'hintCount']
      .forEach((field) => backupNumber(candidate, field, path, issues, { integer: true, min: 0 }));
    backupNumber(candidate, 'averageResponseMs', path, issues, { min: 0 });
    backupNumber(candidate, 'weaknessScore', path, issues, { min: 0, max: 100 });
    if (candidate.revision !== undefined) backupNumber(candidate, 'revision', path, issues, { integer: true, min: 0 });
    if (typeof candidate.manualWeak !== 'boolean') backupIssue(issues, `${path}.manualWeak`, 'invalid_type', 'manualWeakは真偽値である必要があります');
    backupTimestamp(candidate, 'lastAttemptAt', path, issues, true);
    backupTimestamp(candidate, 'updatedAt', path, issues);
    if (
      typeof candidate.attempts === 'number'
      && [candidate.correctCount, candidate.partialCount, candidate.incorrectCount, candidate.skippedCount].every((count) => typeof count === 'number')
      && candidate.attempts !== (candidate.correctCount as number) + (candidate.partialCount as number)
        + (candidate.incorrectCount as number) + (candidate.skippedCount as number)
    ) {
      backupIssue(issues, `${path}.attempts`, 'invalid_value', 'attemptsと評価別件数の合計が一致しません');
    }
  });
  (value.attempts as unknown[]).forEach((candidate, index) => {
    const path = `$.attempts[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Attemptはオブジェクトである必要があります');
    checkBackupFields(candidate, BACKUP_ATTEMPT_FIELDS, path, issues);
    ['attemptId', 'sessionId', 'clientId', 'itemId', 'senseId', 'targetId'].forEach((field) => backupString(candidate, field, path, issues));
    ['answerId', 'exerciseId', 'userAnswer', 'normalizedAnswer'].forEach((field) => backupString(candidate, field, path, issues, true));
    backupEnum(candidate, 'mode', BACKUP_MODES, path, issues);
    backupEnum(candidate, 'exerciseType', BACKUP_EXERCISE_TYPES, path, issues);
    backupEnum(candidate, 'assessment', new Set(['correct', 'partial', 'incorrect', 'skipped']), path, issues);
    backupStringArray(candidate, 'errorTypes', path, issues, false, BACKUP_ERROR_TYPES);
    if (typeof candidate.hintUsed !== 'boolean') backupIssue(issues, `${path}.hintUsed`, 'invalid_type', 'hintUsedは真偽値である必要があります');
    backupNumber(candidate, 'responseMs', path, issues, { min: 0 });
    backupTimestamp(candidate, 'createdAt', path, issues);
    backupTimestamp(candidate, 'syncedAt', path, issues, true);
    backupTimestamp(candidate, 'undoneAt', path, issues, true);
  });
}

function validateBackupSessionConfig(
  candidate: unknown,
  path: string,
  issues: BackupValidationIssue[],
): void {
  if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'configはオブジェクトである必要があります');
  checkBackupFields(candidate, BACKUP_CONFIG_FIELDS, path, issues);
  backupEnum(candidate, 'direction', new Set(['output', 'input', 'context', 'mix']), path, issues);
  if (typeof candidate.includeUnverifiedAi !== 'boolean') {
    backupIssue(issues, `${path}.includeUnverifiedAi`, 'invalid_type', 'includeUnverifiedAiは真偽値である必要があります');
  }
  backupEnum(candidate, 'preferredExerciseType', BACKUP_EXERCISE_TYPES, path, issues, true);
  if (!backupRecord(candidate.questionCount)) {
    backupIssue(issues, `${path}.questionCount`, 'invalid_type', 'questionCountはオブジェクトである必要があります');
  } else {
    checkBackupFields(candidate.questionCount, BACKUP_QUESTION_COUNT_FIELDS, `${path}.questionCount`, issues);
    backupEnum(candidate.questionCount, 'type', new Set(['weak', 'count', 'all', 'auto']), `${path}.questionCount`, issues);
    if (candidate.questionCount.type === 'weak' || candidate.questionCount.type === 'count') {
      backupNumber(candidate.questionCount, 'count', `${path}.questionCount`, issues, { integer: true, min: 1 });
    } else if (candidate.questionCount.count !== undefined) {
      backupIssue(issues, `${path}.questionCount.count`, 'invalid_value', 'all/autoではcountを指定できません');
    }
  }
  if (candidate.modeWeights !== undefined) {
    if (!backupRecord(candidate.modeWeights)) {
      backupIssue(issues, `${path}.modeWeights`, 'invalid_type', 'modeWeightsはオブジェクトである必要があります');
    } else {
      checkBackupFields(candidate.modeWeights, BACKUP_MODES, `${path}.modeWeights`, issues);
      for (const mode of Object.keys(candidate.modeWeights)) {
        backupNumber(candidate.modeWeights, mode, `${path}.modeWeights`, issues, { min: 0 });
      }
    }
  }
}

function validateBackupSessions(value: Record<string, unknown>, issues: BackupValidationIssue[]): void {
  (value.sessions as unknown[]).forEach((candidate, index) => {
    const path = `$.sessions[${index}]`;
    if (!backupRecord(candidate)) return backupIssue(issues, path, 'invalid_type', 'Sessionはオブジェクトである必要があります');
    checkBackupFields(candidate, BACKUP_SESSION_FIELDS, path, issues);
    ['id', 'seed'].forEach((field) => backupString(candidate, field, path, issues));
    backupString(candidate, 'currentTargetId', path, issues, true);
    backupEnum(candidate, 'status', new Set(['active', 'completed', 'abandoned']), path, issues);
    ['selectedSetIds', 'initialTargetIds', 'completedTargetIds', 'needsReviewTargetIds']
      .forEach((field) => backupStringArray(candidate, field, path, issues));
    validateBackupSessionConfig(candidate.config, `${path}.config`, issues);
    if (!Object.prototype.hasOwnProperty.call(candidate, 'queueState')) {
      backupIssue(issues, `${path}.queueState`, 'invalid_type', 'queueStateが必要です');
    }
    backupNumber(candidate, 'answerCount', path, issues, { integer: true, min: 0 });
    backupTimestamp(candidate, 'createdAt', path, issues);
    backupTimestamp(candidate, 'updatedAt', path, issues);
    backupTimestamp(candidate, 'completedAt', path, issues, true);
  });
}

function duplicateBackupIds(
  records: readonly unknown[],
  key: string,
  path: string,
  issues: BackupValidationIssue[],
): void {
  const seen = new Set<string>();
  records.forEach((candidate, index) => {
    if (!backupRecord(candidate) || typeof candidate[key] !== 'string') return;
    const id = candidate[key];
    if (seen.has(id)) backupIssue(issues, `$.${path}[${index}].${key}`, 'duplicate_id', `ID ${id} が重複しています`);
    seen.add(id);
  });
}

function validateBackupRelationships(document: FullMemoryBackup, issues: BackupValidationIssue[]): void {
  const items = new Map(document.items.map((record) => [record.id, record]));
  const senses = new Map(document.senses.map((record) => [record.id, record]));
  const answers = new Map(document.answers.map((record) => [record.id, record]));
  const exercises = new Map(document.exercises.map((record) => [record.id, record]));
  const sets = new Set(document.sets.map((record) => record.id));
  const sessions = new Set(document.sessions.map((record) => record.id));

  const contentIds = new Map<string, string>();
  for (const [collection, records] of [
    ['items', document.items], ['senses', document.senses], ['answers', document.answers],
    ['examples', document.examples], ['exercises', document.exercises],
  ] as const) {
    records.forEach((record, index) => {
      const previous = contentIds.get(record.id);
      if (previous) backupIssue(issues, `$.${collection}[${index}].id`, 'duplicate_id', `ID ${record.id} は${previous}でも使用されています`);
      else contentIds.set(record.id, collection);
    });
  }

  document.senses.forEach((sense, index) => {
    if (!items.has(sense.itemId)) backupIssue(issues, `$.senses[${index}].itemId`, 'missing_parent', '参照先Itemが存在しません');
  });
  document.answers.forEach((answer, index) => {
    if (!senses.has(answer.senseId)) backupIssue(issues, `$.answers[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
  });
  document.examples.forEach((example, index) => {
    if (!senses.has(example.senseId)) backupIssue(issues, `$.examples[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
    if (example.answerId) {
      const answer = answers.get(example.answerId);
      if (!answer) backupIssue(issues, `$.examples[${index}].answerId`, 'missing_parent', '参照先Answerが存在しません');
      else if (answer.senseId !== example.senseId) backupIssue(issues, `$.examples[${index}].answerId`, 'parent_mismatch', 'ExampleとAnswerのSenseが一致しません');
    }
  });
  document.exercises.forEach((exercise, index) => {
    if (!senses.has(exercise.senseId)) backupIssue(issues, `$.exercises[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
    for (const answerId of [...exercise.acceptedAnswerIds, ...(exercise.answerId ? [exercise.answerId] : [])]) {
      const answer = answers.get(answerId);
      if (!answer) backupIssue(issues, `$.exercises[${index}].acceptedAnswerIds`, 'missing_parent', `参照先Answer ${answerId} が存在しません`);
      else if (answer.senseId !== exercise.senseId) backupIssue(issues, `$.exercises[${index}].acceptedAnswerIds`, 'parent_mismatch', 'ExerciseとAnswerのSenseが一致しません');
    }
  });
  const memberKeys = new Set<string>();
  document.setMembers.forEach((member, index) => {
    const key = `${member.setId}\u0000${member.itemId}`;
    if (memberKeys.has(key)) backupIssue(issues, `$.setMembers[${index}]`, 'duplicate_id', '同じSetとItemの参照が重複しています');
    memberKeys.add(key);
    if (!sets.has(member.setId)) backupIssue(issues, `$.setMembers[${index}].setId`, 'missing_parent', '参照先Setが存在しません');
    if (!items.has(member.itemId)) backupIssue(issues, `$.setMembers[${index}].itemId`, 'missing_parent', '参照先Itemが存在しません');
  });
  const statTargets: Record<MemoryStat['targetType'], ReadonlyMap<string, unknown>> = { sense: senses, answer: answers, exercise: exercises };
  const statKeys = new Set<string>();
  document.stats.forEach((stat, index) => {
    const key = `${stat.targetType}\u0000${stat.targetId}\u0000${stat.mode}`;
    if (statKeys.has(key)) backupIssue(issues, `$.stats[${index}]`, 'duplicate_id', '同じ対象・モードのStatが重複しています');
    statKeys.add(key);
    if (!statTargets[stat.targetType].has(stat.targetId)) backupIssue(issues, `$.stats[${index}].targetId`, 'missing_parent', 'Statの対象が存在しません');
  });
  document.attempts.forEach((attempt, index) => {
    const sense = senses.get(attempt.senseId);
    if (!sessions.has(attempt.sessionId)) backupIssue(issues, `$.attempts[${index}].sessionId`, 'missing_parent', '参照先Sessionが存在しません');
    if (!items.has(attempt.itemId)) backupIssue(issues, `$.attempts[${index}].itemId`, 'missing_parent', '参照先Itemが存在しません');
    if (!sense) backupIssue(issues, `$.attempts[${index}].senseId`, 'missing_parent', '参照先Senseが存在しません');
    else if (sense.itemId !== attempt.itemId) backupIssue(issues, `$.attempts[${index}].itemId`, 'parent_mismatch', 'AttemptのItemとSenseが一致しません');
    if (attempt.answerId) {
      const answer = answers.get(attempt.answerId);
      if (!answer) backupIssue(issues, `$.attempts[${index}].answerId`, 'missing_parent', '参照先Answerが存在しません');
      else if (answer.senseId !== attempt.senseId) backupIssue(issues, `$.attempts[${index}].answerId`, 'parent_mismatch', 'AttemptのAnswerとSenseが一致しません');
    }
    if (attempt.exerciseId) {
      const exercise = exercises.get(attempt.exerciseId);
      if (!exercise) backupIssue(issues, `$.attempts[${index}].exerciseId`, 'missing_parent', '参照先Exerciseが存在しません');
      else if (exercise.senseId !== attempt.senseId) backupIssue(issues, `$.attempts[${index}].exerciseId`, 'parent_mismatch', 'AttemptのExerciseとSenseが一致しません');
    }
  });
  document.sessions.forEach((session, index) => {
    session.selectedSetIds.forEach((setId) => {
      if (!sets.has(setId)) backupIssue(issues, `$.sessions[${index}].selectedSetIds`, 'missing_parent', `参照先Set ${setId} が存在しません`);
    });
  });
}

/** Strictly validates an untrusted restore file before it can reach IndexedDB. */
export function parseFullMemoryBackup(
  input: string | unknown,
  options: FullMemoryBackupParseOptions = {},
): FullMemoryBackupParseResult {
  const issues: BackupValidationIssue[] = [];
  const maxJsonBytes = options.maxJsonBytes ?? 25_000_000;
  let value: unknown = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > maxJsonBytes) {
      backupIssue(issues, '$', 'document_too_large', `バックアップは${maxJsonBytes}バイト以内にしてください`);
      return { valid: false, issues };
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      backupIssue(issues, '$', 'invalid_json', 'JSONの構文が不正です');
      return { valid: false, issues };
    }
  }
  scanBackupValue(value, {
    maxDepth: options.maxDepth ?? 12,
    maxStringLength: options.maxStringLength ?? 20_000,
    maxValues: options.maxValues ?? 500_000,
  }, issues);
  if (!backupRecord(value)) {
    backupIssue(issues, '$', 'invalid_type', '完全バックアップはオブジェクトである必要があります');
    return { valid: false, issues };
  }
  checkBackupFields(value, BACKUP_DOCUMENT_FIELDS, '$', issues);
  if (value.schemaVersion !== 1) backupIssue(issues, '$.schemaVersion', 'invalid_value', 'schemaVersionは1である必要があります');
  if (value.backupVersion !== 1) backupIssue(issues, '$.backupVersion', 'invalid_value', 'backupVersionは1である必要があります');
  if (value.exportType !== 'full-backup') backupIssue(issues, '$.exportType', 'invalid_value', 'exportTypeはfull-backupである必要があります');
  backupTimestamp(value, 'exportedAt', '$', issues);
  const arrays = ['sets', 'setMembers', 'items', 'senses', 'answers', 'examples', 'exercises', 'stats', 'attempts', 'sessions'] as const;
  arrays.forEach((field) => {
    if (!Array.isArray(value[field])) backupIssue(issues, `$.${field}`, 'invalid_type', `${field}は配列である必要があります`);
  });
  if (!backupRecord(value.settings)) backupIssue(issues, '$.settings', 'invalid_type', 'settingsはオブジェクトである必要があります');
  if (issues.length > 0 || arrays.some((field) => !Array.isArray(value[field])) || !backupRecord(value.settings)) {
    return { valid: false, issues };
  }

  validateBackupContentArrays(value, issues);
  validateBackupSetArrays(value, issues);
  validateBackupStatsAndAttempts(value, issues);
  validateBackupSessions(value, issues);
  duplicateBackupIds(value.sets as unknown[], 'id', 'sets', issues);
  duplicateBackupIds(value.stats as unknown[], 'id', 'stats', issues);
  duplicateBackupIds(value.attempts as unknown[], 'attemptId', 'attempts', issues);
  duplicateBackupIds(value.sessions as unknown[], 'id', 'sessions', issues);
  if (issues.length > 0) return { valid: false, issues };

  const document = value as unknown as FullMemoryBackup;
  validateBackupRelationships(document, issues);
  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    issues: [],
    backup: document,
    counts: {
      sets: document.sets.length,
      items: document.items.length,
      senses: document.senses.length,
      answers: document.answers.length,
      examples: document.examples.length,
      exercises: document.exercises.length,
      stats: document.stats.length,
      attempts: document.attempts.length,
      sessions: document.sessions.length,
    },
  };
}

/**
 * Strictly validates the additive selected-set interchange format. Unlike a
 * full backup, this format cannot carry deletions, attempts, sessions, user
 * data, or settings. Stats are accepted only as an explicitly present optional
 * collection; the application still requires a separate user confirmation
 * before writing them.
 */
export function parseSelectedSetExport(
  input: string | unknown,
  options: FullMemoryBackupParseOptions = {},
): SelectedSetExportParseResult {
  const issues: BackupValidationIssue[] = [];
  const maxJsonBytes = options.maxJsonBytes ?? 25_000_000;
  let value: unknown = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > maxJsonBytes) {
      backupIssue(issues, '$', 'document_too_large', `選択セットJSONは${maxJsonBytes}バイト以内にしてください`);
      return { recognized: false, valid: false, issues, hasStats: false };
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      backupIssue(issues, '$', 'invalid_json', 'JSONの構文が不正です');
      return { recognized: false, valid: false, issues, hasStats: false };
    }
  }

  const recognized = backupRecord(value) && value.exportType === 'selected-sets';
  const hasStats = backupRecord(value)
    && Object.prototype.hasOwnProperty.call(value, 'stats')
    && value.stats !== undefined;
  scanBackupValue(value, {
    maxDepth: options.maxDepth ?? 12,
    maxStringLength: options.maxStringLength ?? 20_000,
    maxValues: options.maxValues ?? 500_000,
  }, issues);
  if (!backupRecord(value)) {
    backupIssue(issues, '$', 'invalid_type', '選択セットJSONはオブジェクトである必要があります');
    return { recognized, valid: false, issues, hasStats };
  }

  checkBackupFields(value, SELECTED_SET_DOCUMENT_FIELDS, '$', issues);
  if (value.schemaVersion !== 1) backupIssue(issues, '$.schemaVersion', 'invalid_value', 'schemaVersionは1である必要があります');
  if (value.exportType !== 'selected-sets') backupIssue(issues, '$.exportType', 'invalid_value', 'exportTypeはselected-setsである必要があります');
  backupString(value, 'exportId', '$', issues);
  backupTimestamp(value, 'exportedAt', '$', issues);
  const arrays = ['sets', 'setMembers', 'items', 'senses', 'answers', 'examples', 'exercises'] as const;
  arrays.forEach((field) => {
    if (!Array.isArray(value[field])) backupIssue(issues, `$.${field}`, 'invalid_type', `${field}は配列である必要があります`);
  });
  if (hasStats && !Array.isArray(value.stats)) {
    backupIssue(issues, '$.stats', 'invalid_type', 'statsは配列である必要があります');
  }
  if (issues.length > 0 || arrays.some((field) => !Array.isArray(value[field])) || (hasStats && !Array.isArray(value.stats))) {
    return { recognized, valid: false, issues, hasStats };
  }

  validateBackupContentArrays(value, issues);
  validateBackupSetArrays(value, issues);
  if (hasStats) validateBackupStatsAndAttempts({ ...value, attempts: [] }, issues);
  duplicateBackupIds(value.sets as unknown[], 'id', 'sets', issues);
  if (hasStats) duplicateBackupIds(value.stats as unknown[], 'id', 'stats', issues);

  // A selected-set import is additive. Tombstones in this format would turn a
  // harmless file import into an implicit deletion, so reject them outright.
  for (const collection of [...arrays, ...(hasStats ? ['stats'] as const : [])]) {
    (value[collection] as unknown[]).forEach((candidate, index) => {
      if (backupRecord(candidate) && candidate.deletedAt !== undefined) {
        backupIssue(issues, `$.${collection}[${index}].deletedAt`, 'invalid_value', '選択セットJSONでは削除データを取り込めません');
      }
    });
  }
  if (issues.length > 0) return { recognized, valid: false, issues, hasStats };

  const document = value as unknown as SelectedSetExport;
  validateBackupRelationships({
    ...document,
    backupVersion: 1,
    exportType: 'full-backup',
    stats: document.stats ?? [],
    attempts: [],
    sessions: [],
    settings: {},
  }, issues);

  const memberItemIds = new Set(document.setMembers.map((member) => member.itemId));
  document.items.forEach((item, index) => {
    if (!memberItemIds.has(item.id)) {
      backupIssue(issues, `$.items[${index}].id`, 'invalid_value', '選択セットから参照されていないItemは取り込めません');
    }
  });
  if (issues.length > 0) return { recognized, valid: false, issues, hasStats };

  return {
    recognized,
    valid: true,
    issues: [],
    document,
    hasStats,
    counts: {
      sets: document.sets.length,
      members: document.setMembers.length,
      items: document.items.length,
      senses: document.senses.length,
      answers: document.answers.length,
      examples: document.examples.length,
      exercises: document.exercises.length,
      stats: document.stats?.length ?? 0,
    },
  };
}

export function createFullMemoryBackup(input: {
  sets: readonly MemorySet[];
  setMembers: readonly MemorySetMember[];
  content: MemoryContentBundle;
  stats: readonly MemoryStat[];
  attempts: readonly MemoryBackupAttempt[];
  sessions: readonly MemorySession[];
  settings?: Readonly<Record<string, unknown>>;
  exportedAt: string;
}): FullMemoryBackup {
  return {
    schemaVersion: 1,
    backupVersion: 1,
    exportType: 'full-backup',
    exportedAt: input.exportedAt,
    sets: input.sets.map((set) => ({ ...set, tags: [...set.tags] })),
    setMembers: input.setMembers.map((member) => ({ ...member })),
    ...cloneContent(input.content, true),
    stats: input.stats.map((stat) => ({ ...stat })),
    attempts: input.attempts.map((attempt) => ({ ...attempt, errorTypes: [...attempt.errorTypes] })),
    sessions: input.sessions.map((session) => ({
      ...session,
      selectedSetIds: [...session.selectedSetIds],
      initialTargetIds: [...session.initialTargetIds],
      completedTargetIds: [...session.completedTargetIds],
      needsReviewTargetIds: [...session.needsReviewTargetIds],
      config: {
        ...session.config,
        questionCount: { ...session.config.questionCount },
        modeWeights: session.config.modeWeights ? { ...session.config.modeWeights } : undefined,
      },
    })),
    settings: { ...(input.settings ?? {}) },
  };
}

export function stringifyMemoryExport(value: AiContentDocument | SelectedSetExport | FullMemoryBackup): string {
  return JSON.stringify(value, null, 2);
}
