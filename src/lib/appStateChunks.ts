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

export const MAIN_STATE_CHUNK_FORMAT_VERSION = 1;
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

export interface AppStateChunkManifestSection {
  name: AppStateSectionName;
  chunkCount: number;
  itemCount: number;
  byteLength: number;
  hashes: string[];
}

export interface AppStateChunkManifest {
  formatVersion: typeof MAIN_STATE_CHUNK_FORMAT_VERSION;
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

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
    settings: [state.settings],
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<AppStateChunkManifest>;
  if (candidate.formatVersion !== MAIN_STATE_CHUNK_FORMAT_VERSION
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
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) return false;
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
  if (metaItems.length !== 1 || settingsItems.length !== 1 || goalItems.length > 1) {
    throw new Error('クラウド予定データのsingleton sectionが不正です');
  }
  const meta = metaItems[0] as AppStateMetaSection;
  return {
    version: meta.version,
    schemaVersion: meta.schemaVersion,
    isDemo: meta.isDemo,
    onboarded: meta.onboarded,
    goal: (goalItems[0] as UserGoal | undefined) ?? null,
    settings: settingsItems[0] as AppSettings,
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
