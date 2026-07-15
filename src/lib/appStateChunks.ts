import type {
  AppSettings,
  AppState,
  AvailabilitySlot,
  DayPlanOverride,
  FixedEvent,
  Material,
  PlanHistoryEntry,
  StudySession,
  StudyTask,
  Subject,
  UserGoal,
} from '../types';
import { defaultSettings } from '../data/defaults';
import type { HistoricalMonthSummary } from './historyRetention';
import type {
  PlanRevision,
  PlanRevisionChange,
  PlanRevisionMaterialChange,
  PlanRevisionTaskPlacement,
} from './planHistory';

export const LEGACY_MAIN_STATE_CHUNK_FORMAT_VERSION = 1;
export const MAIN_STATE_CHUNK_FORMAT_VERSION = 2;
export const MAX_MAIN_STATE_CHUNK_BYTES = 384 * 1024;

export const APP_STATE_SECTION_NAMES = [
  'meta',
  'goal',
  'settings',
  'subjects',
  'materials',
  'tasks',
  'sessions',
  'planHistory',
  'availability',
  'dayPlans',
  'fixedEvents',
] as const;

export type AppStateSectionName = (typeof APP_STATE_SECTION_NAMES)[number];
export type AppStateChunkFormatVersion =
  | typeof LEGACY_MAIN_STATE_CHUNK_FORMAT_VERSION
  | typeof MAIN_STATE_CHUNK_FORMAT_VERSION;

export interface AppStateChunkManifestSection {
  name: AppStateSectionName;
  chunkCount: number;
  itemCount: number;
  byteLength: number;
  hashes: string[];
}

export interface AppStateChunkManifest {
  formatVersion: AppStateChunkFormatVersion;
  sections: AppStateChunkManifestSection[];
  totalChunks: number;
  totalItems: number;
  totalBytes: number;
}

export interface AppStateChunk {
  section: AppStateSectionName;
  index: number;
  json: string;
  hash: string;
  byteLength: number;
}

interface AppStateMetaSection {
  version: number;
  schemaVersion: number;
  isDemo: boolean;
  onboarded: boolean;
  lastReschedule: AppState['lastReschedule'];
  lastPlannedDate: AppState['lastPlannedDate'];
  lastScheduleResult: AppState['lastScheduleResult'];
  lastPlanReason: AppState['lastPlanReason'];
}

type SettingsWithUnknownHistory = Omit<AppSettings, 'historyData'> & { historyData?: unknown };
type SettingsWithoutHistory = Omit<AppSettings, 'historyData'>;

export interface CanonicalHistoryData {
  planRevisions: PlanRevision[];
  monthlySummaries: HistoricalMonthSummary[];
}

type SettingsChunkItem =
  | { kind: 'settings'; value: SettingsWithoutHistory; hasHistoryData: boolean }
  | { kind: 'planRevision'; order: number; value: Omit<PlanRevision, 'placements' | 'changes' | 'materialChanges'> }
  | { kind: 'planRevisionPlacement'; revisionId: string; value: PlanRevisionTaskPlacement }
  | { kind: 'planRevisionChange'; revisionId: string; value: PlanRevisionChange }
  | { kind: 'planRevisionMaterialChange'; revisionId: string; value: PlanRevisionMaterialChange }
  | { kind: 'monthlySummary'; value: HistoricalMonthSummary };

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const MAX_HISTORY_STRING_LENGTH = 10_000;

function historyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_HISTORY_STRING_LENGTH
    ? value
    : null;
}

function nullableHistoryString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return historyString(value) ?? undefined;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function canonicalPlanRevisionPlacement(value: unknown): PlanRevisionTaskPlacement | null {
  if (!isRecord(value)) return null;
  const key = historyString(value.key);
  const taskId = historyString(value.taskId);
  const title = historyString(value.title);
  const materialId = nullableHistoryString(value.materialId);
  const estimatedMinutes = nonNegativeNumber(value.estimatedMinutes);
  const scheduledDate = historyString(value.scheduledDate);
  const scheduledStart = nullableHistoryString(value.scheduledStart);
  const scheduledEnd = nullableHistoryString(value.scheduledEnd);
  if (!key || !taskId || !title || materialId === undefined || estimatedMinutes === null
    || !scheduledDate || scheduledStart === undefined || scheduledEnd === undefined) return null;

  const placementStatus = value.placementStatus === 'scheduled'
    || value.placementStatus === 'unscheduled'
    || value.placementStatus === 'conflict'
    ? value.placementStatus
    : undefined;
  const placementLock = value.placementLock === 'none'
    || value.placementLock === 'date'
    || value.placementLock === 'time'
    ? value.placementLock
    : undefined;
  const manualOrder = Number.isSafeInteger(value.manualOrder) ? value.manualOrder as number : undefined;
  return {
    key,
    taskId,
    title,
    materialId,
    estimatedMinutes,
    scheduledDate,
    scheduledStart,
    scheduledEnd,
    ...(placementStatus ? { placementStatus } : {}),
    ...(placementLock ? { placementLock } : {}),
    ...(manualOrder !== undefined ? { manualOrder } : {}),
  };
}

function canonicalPlanRevisionChange(value: unknown): PlanRevisionChange | null {
  if (!isRecord(value)) return null;
  const key = historyString(value.key);
  const taskId = historyString(value.taskId);
  const title = historyString(value.title);
  const materialId = nullableHistoryString(value.materialId);
  const kind = value.kind === 'added' || value.kind === 'removed' || value.kind === 'moved' || value.kind === 'updated'
    ? value.kind
    : null;
  const before = value.before === undefined ? undefined : canonicalPlanRevisionPlacement(value.before);
  const after = value.after === undefined ? undefined : canonicalPlanRevisionPlacement(value.after);
  if (!key || !taskId || !title || materialId === undefined || !kind
    || before === null || after === null) return null;
  return {
    key,
    taskId,
    title,
    materialId,
    kind,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

function canonicalPlanRevisionMaterialChange(value: unknown): PlanRevisionMaterialChange | null {
  if (!isRecord(value)) return null;
  const materialId = historyString(value.materialId);
  const changedTasks = nonNegativeNumber(value.changedTasks);
  const movedTasks = nonNegativeNumber(value.movedTasks);
  const beforeMinutes = nonNegativeNumber(value.beforeMinutes);
  const afterMinutes = nonNegativeNumber(value.afterMinutes);
  if (!materialId || changedTasks === null || movedTasks === null || beforeMinutes === null || afterMinutes === null) return null;
  return { materialId, changedTasks, movedTasks, beforeMinutes, afterMinutes };
}

function canonicalPlanRevision(value: unknown): PlanRevision | null {
  if (!isRecord(value)
    || !Array.isArray(value.placements)
    || !Array.isArray(value.changes)
    || !Array.isArray(value.materialChanges)) return null;
  const id = historyString(value.id);
  const generationId = historyString(value.generationId);
  const createdAt = historyString(value.createdAt);
  const reason = historyString(value.reason);
  const fromDate = historyString(value.fromDate);
  if (!id || !generationId || !createdAt || !reason || !fromDate) return null;
  return {
    id,
    generationId,
    createdAt,
    reason,
    fromDate,
    placements: value.placements.map(canonicalPlanRevisionPlacement).filter((item): item is PlanRevisionTaskPlacement => Boolean(item)),
    changes: value.changes.map(canonicalPlanRevisionChange).filter((item): item is PlanRevisionChange => Boolean(item)),
    materialChanges: value.materialChanges
      .map(canonicalPlanRevisionMaterialChange)
      .filter((item): item is PlanRevisionMaterialChange => Boolean(item)),
  };
}

function canonicalHistoricalMonthSummary(value: unknown): HistoricalMonthSummary | null {
  if (!isRecord(value) || !Array.isArray(value.subjectMinutes)) return null;
  const month = typeof value.month === 'string' && /^\d{4}-\d{2}$/.test(value.month) ? value.month : null;
  const studyMinutes = nonNegativeNumber(value.studyMinutes);
  const sessionCount = nonNegativeNumber(value.sessionCount);
  const completedTaskCount = nonNegativeNumber(value.completedTaskCount);
  const plannedMinutes = nonNegativeNumber(value.plannedMinutes);
  const missedMinutes = nonNegativeNumber(value.missedMinutes);
  if (!month || studyMinutes === null || sessionCount === null || completedTaskCount === null
    || plannedMinutes === null || missedMinutes === null) return null;
  const subjectMinutes = new Map<string, { subjectId: string; minutes: number }>();
  for (const rawItem of value.subjectMinutes) {
    if (!isRecord(rawItem)) continue;
    const subjectId = historyString(rawItem.subjectId);
    const minutes = nonNegativeNumber(rawItem.minutes);
    if (!subjectId || minutes === null) continue;
    subjectMinutes.set(subjectId, { subjectId, minutes });
  }
  return {
    month,
    studyMinutes,
    sessionCount,
    completedTaskCount,
    plannedMinutes,
    missedMinutes,
    subjectMinutes: [...subjectMinutes.values()],
  };
}

/**
 * 旧版・破損settingsから利用可能な計画履歴だけを救出する。
 * 未知プロパティを除去し、重複ID/月は後勝ちで一意化するため、再適用しても結果は変わらない。
 */
export function canonicalizeHistoryData(value: unknown): CanonicalHistoryData {
  if (!isRecord(value)) return { planRevisions: [], monthlySummaries: [] };
  const revisions = new Map<string, PlanRevision>();
  if (Array.isArray(value.planRevisions)) {
    for (const rawRevision of value.planRevisions) {
      const revision = canonicalPlanRevision(rawRevision);
      if (revision) revisions.set(revision.id, revision);
    }
  }
  const summaries = new Map<string, HistoricalMonthSummary>();
  if (Array.isArray(value.monthlySummaries)) {
    for (const rawSummary of value.monthlySummaries) {
      const summary = canonicalHistoricalMonthSummary(rawSummary);
      if (summary) summaries.set(summary.month, summary);
    }
  }
  return {
    planRevisions: [...revisions.values()],
    monthlySummaries: [...summaries.values()],
  };
}

/**
 * クラウドへ保存する設定本体は現行schemaで定義した項目だけへ絞る。
 * 計画履歴は別のsettings明細として分割し、巨大な未知プロパティだけを除外する。
 */
export function canonicalizeCloudSettings(input: AppSettings): AppSettings {
  const defaults = defaultSettings();
  const settings = input && typeof input === 'object' ? input : defaults;
  const reviewRule = settings.reviewRule && typeof settings.reviewRule === 'object'
    ? settings.reviewRule
    : defaults.reviewRule;
  const timer = settings.timer && typeof settings.timer === 'object'
    ? settings.timer
    : defaults.timer;
  const pomodoro = timer.pomodoro && typeof timer.pomodoro === 'object'
    ? timer.pomodoro
    : defaults.timer.pomodoro;
  const intervals = Array.isArray(reviewRule.intervals)
    && reviewRule.intervals.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? [...reviewRule.intervals]
    : [...defaults.reviewRule.intervals];

  return {
    theme: settings.theme === 'auto' || settings.theme === 'dark' || settings.theme === 'light'
      ? settings.theme
      : defaults.theme,
    maxDailyMinutes: finiteNumber(settings.maxDailyMinutes, defaults.maxDailyMinutes),
    sessionMinMinutes: finiteNumber(settings.sessionMinMinutes, defaults.sessionMinMinutes),
    sessionMaxMinutes: finiteNumber(settings.sessionMaxMinutes, defaults.sessionMaxMinutes),
    reviewRule: {
      enabled: typeof reviewRule.enabled === 'boolean' ? reviewRule.enabled : defaults.reviewRule.enabled,
      intervals,
    },
    weeklyTargetMinutes: finiteNumber(settings.weeklyTargetMinutes, defaults.weeklyTargetMinutes),
    timer: {
      defaultMode: timer.defaultMode === 'stopwatch' || timer.defaultMode === 'pomodoro'
        ? timer.defaultMode
        : defaults.timer.defaultMode,
      pomodoro: {
        workMinutes: finiteNumber(pomodoro.workMinutes, defaults.timer.pomodoro.workMinutes),
        breakMinutes: finiteNumber(pomodoro.breakMinutes, defaults.timer.pomodoro.breakMinutes),
        longBreakMinutes: finiteNumber(pomodoro.longBreakMinutes, defaults.timer.pomodoro.longBreakMinutes),
        cyclesUntilLongBreak: finiteNumber(pomodoro.cyclesUntilLongBreak, defaults.timer.pomodoro.cyclesUntilLongBreak),
      },
      sound: typeof timer.sound === 'boolean' ? timer.sound : defaults.timer.sound,
      vibration: typeof timer.vibration === 'boolean' ? timer.vibration : defaults.timer.vibration,
      notification: typeof timer.notification === 'boolean' ? timer.notification : defaults.timer.notification,
      keepScreenOn: typeof timer.keepScreenOn === 'boolean' ? timer.keepScreenOn : defaults.timer.keepScreenOn,
    },
    taskGenerationHorizonDays: finiteNumber(
      settings.taskGenerationHorizonDays,
      defaults.taskGenerationHorizonDays ?? 42,
    ),
    estimateAlpha: finiteNumber(settings.estimateAlpha, defaults.estimateAlpha ?? 0.2),
  };
}

/** 現行設定本体と、存在する場合だけ検証済みの計画履歴を組み直す。 */
export function canonicalizeSettingsWithHistory(input: unknown): AppSettings | null {
  if (!isRecord(input)) return null;
  const source = input as SettingsWithUnknownHistory;
  const settings = canonicalizeCloudSettings(input as unknown as AppSettings);
  if (!Object.prototype.hasOwnProperty.call(source, 'historyData')) return settings;
  return {
    ...settings,
    historyData: canonicalizeHistoryData(source.historyData),
  } as AppSettings;
}

function splitSettings(state: AppState): SettingsChunkItem[] {
  const source = state.settings as SettingsWithUnknownHistory;
  const hasHistoryData = Object.prototype.hasOwnProperty.call(source, 'historyData');
  const historyData = canonicalizeHistoryData(source.historyData);
  const settings = canonicalizeCloudSettings(state.settings) as SettingsWithoutHistory;

  const items: SettingsChunkItem[] = [{ kind: 'settings', value: settings, hasHistoryData }];
  historyData.planRevisions.forEach((revision, order) => {
    const { placements, changes, materialChanges, ...metadata } = revision;
    items.push({ kind: 'planRevision', order, value: metadata });
    for (const value of placements) items.push({ kind: 'planRevisionPlacement', revisionId: revision.id, value });
    for (const value of changes) items.push({ kind: 'planRevisionChange', revisionId: revision.id, value });
    for (const value of materialChanges) items.push({ kind: 'planRevisionMaterialChange', revisionId: revision.id, value });
  });
  for (const value of historyData.monthlySummaries) items.push({ kind: 'monthlySummary', value });
  return items;
}

function sectionItems(state: AppState): Record<AppStateSectionName, unknown[]> {
  const meta: AppStateMetaSection = {
    version: state.version,
    schemaVersion: state.schemaVersion,
    isDemo: state.isDemo,
    onboarded: state.onboarded,
    lastReschedule: state.lastReschedule,
    lastPlannedDate: state.lastPlannedDate,
    lastScheduleResult: state.lastScheduleResult ?? null,
    lastPlanReason: state.lastPlanReason ?? null,
  };
  return {
    meta: [meta],
    goal: state.goal ? [state.goal] : [],
    settings: splitSettings(state),
    subjects: state.subjects,
    materials: state.materials,
    tasks: state.tasks,
    sessions: state.sessions,
    planHistory: state.planHistory ?? [],
    availability: state.availability,
    dayPlans: state.dayPlans,
    fixedEvents: state.fixedEvents,
  };
}

async function encodeSection(
  name: AppStateSectionName,
  items: unknown[],
  maxChunkBytes: number,
): Promise<{ manifest: AppStateChunkManifestSection; chunks: AppStateChunk[] }> {
  const chunks: AppStateChunk[] = [];
  let current: unknown[] = [];

  const flush = async () => {
    if (current.length === 0) return;
    const json = JSON.stringify(current);
    const byteLength = utf8Length(json);
    const index = chunks.length;
    chunks.push({ section: name, index, json, hash: await sha256Hex(json), byteLength });
    current = [];
  };

  for (const item of items) {
    const candidate = [...current, item];
    const candidateJson = JSON.stringify(candidate);
    const candidateBytes = utf8Length(candidateJson);
    if (candidateBytes <= maxChunkBytes) {
      current = candidate;
      continue;
    }
    if (current.length === 0) {
      throw new Error(`${name}の1項目がクラウド保存上限を超えています (${candidateBytes} bytes)`);
    }
    await flush();
    const singleJson = JSON.stringify([item]);
    const singleBytes = utf8Length(singleJson);
    if (singleBytes > maxChunkBytes) {
      throw new Error(`${name}の1項目がクラウド保存上限を超えています (${singleBytes} bytes)`);
    }
    current = [item];
  }
  await flush();

  return {
    manifest: {
      name,
      chunkCount: chunks.length,
      itemCount: items.length,
      byteLength: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      hashes: chunks.map((chunk) => chunk.hash),
    },
    chunks,
  };
}

export async function encodeAppStateChunks(
  state: AppState,
  maxChunkBytes = MAX_MAIN_STATE_CHUNK_BYTES,
): Promise<{ manifest: AppStateChunkManifest; chunks: AppStateChunk[] }> {
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1024) {
    throw new Error('chunk size must be an integer of at least 1024 bytes');
  }
  const itemsBySection = sectionItems(state);
  const encoded = [] as { manifest: AppStateChunkManifestSection; chunks: AppStateChunk[] }[];
  for (const name of APP_STATE_SECTION_NAMES) {
    encoded.push(await encodeSection(name, itemsBySection[name], maxChunkBytes));
  }
  const sections = encoded.map((entry) => entry.manifest);
  const chunks = encoded.flatMap((entry) => entry.chunks);
  return {
    manifest: {
      formatVersion: MAIN_STATE_CHUNK_FORMAT_VERSION,
      sections,
      totalChunks: chunks.length,
      totalItems: sections.reduce((sum, section) => sum + section.itemCount, 0),
      totalBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    },
    chunks,
  };
}

export function validateAppStateChunkManifest(value: unknown): value is AppStateChunkManifest {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<AppStateChunkManifest>;
  if ((candidate.formatVersion !== LEGACY_MAIN_STATE_CHUNK_FORMAT_VERSION
      && candidate.formatVersion !== MAIN_STATE_CHUNK_FORMAT_VERSION)
    || !Array.isArray(candidate.sections)
    || !Number.isSafeInteger(candidate.totalChunks)
    || !Number.isSafeInteger(candidate.totalItems)
    || !Number.isSafeInteger(candidate.totalBytes)
    || (candidate.totalChunks ?? -1) < 0
    || (candidate.totalItems ?? -1) < 0
    || (candidate.totalBytes ?? -1) < 0) return false;
  if (candidate.sections.length !== APP_STATE_SECTION_NAMES.length) return false;

  let totalChunks = 0;
  let totalItems = 0;
  let totalBytes = 0;
  const seen = new Set<string>();
  for (const rawSection of candidate.sections) {
    if (!isRecord(rawSection)) return false;
    const section = rawSection as Partial<AppStateChunkManifestSection>;
    if (!APP_STATE_SECTION_NAMES.includes(section.name as AppStateSectionName)
      || seen.has(section.name as string)
      || !Number.isSafeInteger(section.chunkCount)
      || !Number.isSafeInteger(section.itemCount)
      || !Number.isSafeInteger(section.byteLength)
      || (section.chunkCount ?? -1) < 0
      || (section.itemCount ?? -1) < 0
      || (section.byteLength ?? -1) < 0
      || !Array.isArray(section.hashes)
      || section.hashes.length !== section.chunkCount
      || section.hashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) return false;
    seen.add(section.name as string);
    totalChunks += section.chunkCount ?? 0;
    totalItems += section.itemCount ?? 0;
    totalBytes += section.byteLength ?? 0;
  }
  return totalChunks === candidate.totalChunks
    && totalItems === candidate.totalItems
    && totalBytes === candidate.totalBytes
    && APP_STATE_SECTION_NAMES.every((name) => seen.has(name));
}

function decodeSplitSettings(items: unknown[]): AppSettings {
  let settings: SettingsWithoutHistory | null = null;
  let hasHistoryData = false;
  const revisions = new Map<string, {
    order: number;
    value: Omit<PlanRevision, 'placements' | 'changes' | 'materialChanges'>;
    placements: PlanRevisionTaskPlacement[];
    changes: PlanRevisionChange[];
    materialChanges: PlanRevisionMaterialChange[];
  }>();
  const pendingChildren: Array<Exclude<SettingsChunkItem, { kind: 'settings' | 'planRevision' | 'monthlySummary' }>> = [];
  const monthlySummaries: HistoricalMonthSummary[] = [];

  for (const rawItem of items) {
    if (!isRecord(rawItem) || typeof rawItem.kind !== 'string') throw new Error('settings chunk itemが不正です');
    const item = rawItem as unknown as SettingsChunkItem;
    switch (item.kind) {
      case 'settings':
        if (settings || !isRecord(item.value)) throw new Error('settings本体が重複または不正です');
        settings = item.value;
        hasHistoryData = item.hasHistoryData === true;
        break;
      case 'planRevision': {
        if (!Number.isSafeInteger(item.order) || item.order < 0 || !isRecord(item.value)) throw new Error('計画履歴metadataが不正です');
        const id = item.value.id;
        if (typeof id !== 'string' || !id || revisions.has(id)) throw new Error('計画履歴IDが重複または不正です');
        revisions.set(id, { order: item.order, value: item.value, placements: [], changes: [], materialChanges: [] });
        break;
      }
      case 'planRevisionPlacement':
      case 'planRevisionChange':
      case 'planRevisionMaterialChange':
        if (typeof item.revisionId !== 'string' || !item.revisionId || !isRecord(item.value)) throw new Error('計画履歴明細が不正です');
        pendingChildren.push(item);
        break;
      case 'monthlySummary':
        if (!isRecord(item.value)) throw new Error('月次集計が不正です');
        monthlySummaries.push(item.value);
        break;
      default:
        throw new Error('未知のsettings chunk itemです');
    }
  }

  if (!settings) throw new Error('settings本体がありません');
  for (const item of pendingChildren) {
    const revision = revisions.get(item.revisionId);
    if (!revision) throw new Error('計画履歴明細の親がありません');
    if (item.kind === 'planRevisionPlacement') revision.placements.push(item.value);
    else if (item.kind === 'planRevisionChange') revision.changes.push(item.value);
    else revision.materialChanges.push(item.value);
  }

  const orders = new Set<number>();
  const planRevisions = [...revisions.values()]
    .sort((left, right) => left.order - right.order)
    .map((revision) => {
      if (orders.has(revision.order)) throw new Error('計画履歴順序が重複しています');
      orders.add(revision.order);
      return {
        ...revision.value,
        placements: revision.placements,
        changes: revision.changes,
        materialChanges: revision.materialChanges,
      } satisfies PlanRevision;
    });

  if (!hasHistoryData && planRevisions.length === 0 && monthlySummaries.length === 0) return settings as AppSettings;
  const historyData = canonicalizeHistoryData({ planRevisions, monthlySummaries });
  return {
    ...settings,
    historyData,
  } as AppSettings;
}

export async function decodeAppStateChunks(
  manifest: AppStateChunkManifest,
  chunks: AppStateChunk[],
): Promise<AppState> {
  if (!validateAppStateChunkManifest(manifest)) throw new Error('クラウド予定データのmanifestが不正です');
  if (chunks.length !== manifest.totalChunks) throw new Error('クラウド予定データのchunk数が一致しません');

  const decoded = new Map<AppStateSectionName, unknown[]>();
  for (const section of manifest.sections) {
    const sectionChunks = chunks
      .filter((chunk) => chunk.section === section.name)
      .sort((left, right) => left.index - right.index);
    if (sectionChunks.length !== section.chunkCount) throw new Error(`${section.name}のchunk数が一致しません`);
    const items: unknown[] = [];
    let bytes = 0;
    for (let index = 0; index < sectionChunks.length; index += 1) {
      const chunk = sectionChunks[index];
      if (chunk.index !== index) throw new Error(`${section.name}のchunk indexが連続していません`);
      const byteLength = utf8Length(chunk.json);
      if (byteLength !== chunk.byteLength || byteLength > MAX_MAIN_STATE_CHUNK_BYTES) {
        throw new Error(`${section.name}[${index}]のbyte lengthが不正です`);
      }
      const hash = await sha256Hex(chunk.json);
      if (hash !== chunk.hash || hash !== section.hashes[index]) {
        throw new Error(`${section.name}[${index}]のhashが一致しません`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(chunk.json);
      } catch {
        throw new Error(`${section.name}[${index}]がJSONではありません`);
      }
      if (!Array.isArray(parsed)) throw new Error(`${section.name}[${index}]は配列である必要があります`);
      items.push(...parsed);
      bytes += byteLength;
    }
    if (items.length !== section.itemCount || bytes !== section.byteLength) {
      throw new Error(`${section.name}のitem countまたはbyte lengthが一致しません`);
    }
    decoded.set(section.name, items);
  }

  const metaItems = decoded.get('meta') ?? [];
  const goalItems = decoded.get('goal') ?? [];
  const settingsItems = decoded.get('settings') ?? [];
  if (metaItems.length !== 1 || goalItems.length > 1) {
    throw new Error('クラウド予定データのsingleton sectionが不正です');
  }
  const settings = manifest.formatVersion === LEGACY_MAIN_STATE_CHUNK_FORMAT_VERSION
    ? (settingsItems.length === 1 ? canonicalizeSettingsWithHistory(settingsItems[0]) : null)
    : decodeSplitSettings(settingsItems);
  if (!settings) throw new Error('クラウド予定データのsettings sectionが不正です');

  const meta = metaItems[0] as AppStateMetaSection;
  return {
    version: meta.version,
    schemaVersion: meta.schemaVersion,
    isDemo: meta.isDemo,
    onboarded: meta.onboarded,
    goal: (goalItems[0] as UserGoal | undefined) ?? null,
    settings,
    subjects: (decoded.get('subjects') ?? []) as Subject[],
    materials: (decoded.get('materials') ?? []) as Material[],
    tasks: (decoded.get('tasks') ?? []) as StudyTask[],
    sessions: (decoded.get('sessions') ?? []) as StudySession[],
    planHistory: (decoded.get('planHistory') ?? []) as PlanHistoryEntry[],
    availability: (decoded.get('availability') ?? []) as AvailabilitySlot[],
    dayPlans: (decoded.get('dayPlans') ?? []) as DayPlanOverride[],
    fixedEvents: (decoded.get('fixedEvents') ?? []) as FixedEvent[],
    lastReschedule: meta.lastReschedule,
    lastPlannedDate: meta.lastPlannedDate,
    lastScheduleResult: meta.lastScheduleResult ?? null,
    lastPlanReason: meta.lastPlanReason ?? null,
  };
}
