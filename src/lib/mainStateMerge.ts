import type { AppSettings, AppState } from '../types';

export type MainStateEntitySection =
  | 'goal'
  | 'settings'
  | 'subjects'
  | 'materials'
  | 'tasks'
  | 'sessions'
  | 'planHistory'
  | 'availability'
  | 'dayPlans'
  | 'fixedEvents';

export type MainStateEntityHashSnapshot = Partial<Record<MainStateEntitySection, Record<string, string>>>;

export interface MainStateMergeConflict {
  section: MainStateEntitySection;
  key: string;
  reason: 'bothChanged' | 'deleteVsEdit' | 'concurrentAdd';
}

export interface MainStateMergeResult {
  merged: AppState | null;
  conflicts: MainStateMergeConflict[];
  appliedLocalKeys: string[];
  appliedRemoteKeys: string[];
  deletedKeys: string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

/** Small deterministic hash. It is a change detector, not a security primitive. */
export function mainStateEntityHash(value: unknown): string {
  const input = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function settingsCore(settings: AppSettings): AppSettings {
  const { historyData: _historyData, ...core } = settings;
  return core as AppSettings;
}

function sectionEntries(state: AppState): Record<MainStateEntitySection, [string, unknown][]> {
  return {
    goal: [['value', state.goal]],
    settings: [['value', settingsCore(state.settings)]],
    subjects: state.subjects.map((item) => [item.id, item]),
    materials: state.materials.map((item) => [item.id, item]),
    tasks: state.tasks.map((item) => [item.id, item]),
    sessions: state.sessions.map((item) => [item.id, item]),
    planHistory: (state.planHistory ?? []).map((item) => [item.id, item]),
    availability: state.availability.map((item) => [String(item.weekday), item]),
    dayPlans: state.dayPlans.map((item) => [item.date, item]),
    fixedEvents: state.fixedEvents.map((item) => [item.id, item]),
  };
}

export function snapshotMainStateEntityHashes(state: AppState): MainStateEntityHashSnapshot {
  const snapshot: MainStateEntityHashSnapshot = {};
  const sections = sectionEntries(state);
  for (const [section, entries] of Object.entries(sections) as [MainStateEntitySection, [string, unknown][]][]) {
    snapshot[section] = Object.fromEntries(entries.map(([key, value]) => [key, mainStateEntityHash(value)]));
  }
  return snapshot;
}

function mapOf(entries: [string, unknown][]): Map<string, unknown> {
  return new Map(entries);
}

function mergeHistoryData(local: AppSettings, remote: AppSettings): AppSettings['historyData'] {
  const localData = local.historyData ?? { planRevisions: [], monthlySummaries: [] };
  const remoteData = remote.historyData ?? { planRevisions: [], monthlySummaries: [] };
  const revisions = [...new Map([...localData.planRevisions, ...remoteData.planRevisions].map((item) => [item.id, item])).values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-32);
  const months = new Map<string, (typeof localData.monthlySummaries)[number]>();
  for (const summary of [...localData.monthlySummaries, ...remoteData.monthlySummaries]) {
    const current = months.get(summary.month);
    if (!current) {
      months.set(summary.month, summary);
      continue;
    }
    const subjectMinutes = new Map(current.subjectMinutes.map((item) => [item.subjectId, item.minutes]));
    for (const item of summary.subjectMinutes) {
      subjectMinutes.set(item.subjectId, Math.max(subjectMinutes.get(item.subjectId) ?? 0, item.minutes));
    }
    months.set(summary.month, {
      month: summary.month,
      studyMinutes: Math.max(current.studyMinutes, summary.studyMinutes),
      sessionCount: Math.max(current.sessionCount, summary.sessionCount),
      completedTaskCount: Math.max(current.completedTaskCount, summary.completedTaskCount),
      plannedMinutes: Math.max(current.plannedMinutes, summary.plannedMinutes),
      missedMinutes: Math.max(current.missedMinutes, summary.missedMinutes),
      subjectMinutes: [...subjectMinutes.entries()].map(([subjectId, minutes]) => ({ subjectId, minutes })).sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    });
  }
  return { planRevisions: revisions, monthlySummaries: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}

function chooseEntity(input: {
  section: MainStateEntitySection;
  key: string;
  baseHash: string | undefined;
  local: unknown | undefined;
  remote: unknown | undefined;
  localPresent: boolean;
  remotePresent: boolean;
}): { value?: unknown; source: 'local' | 'remote' | 'same' | 'deleted'; conflict?: MainStateMergeConflict } {
  const { section, key, baseHash, local, remote, localPresent, remotePresent } = input;
  const localHash = localPresent ? mainStateEntityHash(local) : undefined;
  const remoteHash = remotePresent ? mainStateEntityHash(remote) : undefined;
  if (localPresent === remotePresent && localHash === remoteHash) {
    return localPresent ? { value: local, source: 'same' } : { source: 'deleted' };
  }
  const localUnchanged = localHash === baseHash && localPresent === (baseHash !== undefined);
  const remoteUnchanged = remoteHash === baseHash && remotePresent === (baseHash !== undefined);
  if (localUnchanged) return remotePresent ? { value: remote, source: 'remote' } : { source: 'deleted' };
  if (remoteUnchanged) return localPresent ? { value: local, source: 'local' } : { source: 'deleted' };

  if (baseHash === undefined) {
    if (localPresent && !remotePresent) return { value: local, source: 'local' };
    if (!localPresent && remotePresent) return { value: remote, source: 'remote' };
    return { source: 'same', conflict: { section, key, reason: 'concurrentAdd' } };
  }
  if (localPresent !== remotePresent) {
    return { source: 'same', conflict: { section, key, reason: 'deleteVsEdit' } };
  }
  return { source: 'same', conflict: { section, key, reason: 'bothChanged' };
}

export function mergeMainStates(
  baseHashes: MainStateEntityHashSnapshot | null | undefined,
  local: AppState,
  remote: AppState,
): MainStateMergeResult {
  if (!baseHashes) {
    return {
      merged: null,
      conflicts: [{ section: 'settings', key: 'value', reason: 'bothChanged' }],
      appliedLocalKeys: [],
      appliedRemoteKeys: [],
      deletedKeys: [],
    };
  }

  const localSections = sectionEntries(local);
  const remoteSections = sectionEntries(remote);
  const output = new Map<MainStateEntitySection, Map<string, unknown>>();
  const conflicts: MainStateMergeConflict[] = [];
  const appliedLocalKeys: string[] = [];
  const appliedRemoteKeys: string[] = [];
  const deletedKeys: string[] = [];

  for (const section of Object.keys(localSections) as MainStateEntitySection[]) {
    const localMap = mapOf(localSections[section]);
    const remoteMap = mapOf(remoteSections[section]);
    const keys = new Set([...Object.keys(baseHashes[section] ?? {}), ...localMap.keys(), ...remoteMap.keys()]);
    const result = new Map<string, unknown>();
    for (const key of keys) {
      const chosen = chooseEntity({
        section,
        key,
        baseHash: baseHashes[section]?.[key],
        local: localMap.get(key),
        remote: remoteMap.get(key),
        localPresent: localMap.has(key),
        remotePresent: remoteMap.has(key),
      });
      if (chosen.conflict) {
        conflicts.push(chosen.conflict);
        continue;
      }
      if (chosen.source === 'local') appliedLocalKeys.push(`${section}:${key}`);
      if (chosen.source === 'remote') appliedRemoteKeys.push(`${section}:${key}`);
      if (chosen.source === 'deleted') deletedKeys.push(`${section}:${key}`);
      if (chosen.value !== undefined) result.set(key, chosen.value);
    }
    output.set(section, result);
  }
  if (conflicts.length > 0) return { merged: null, conflicts, appliedLocalKeys, appliedRemoteKeys, deletedKeys };

  const goal = (output.get('goal')?.get('value') ?? null) as AppState['goal'];
  const settingsCoreValue = output.get('settings')?.get('value') as AppSettings;
  const settings: AppSettings = { ...settingsCoreValue, historyData: mergeHistoryData(local.settings, remote.settings) };
  const values = <T>(section: MainStateEntitySection): T[] => [...(output.get(section)?.values() ?? [])] as T[];

  const merged: AppState = {
    ...remote,
    version: Math.max(local.version, remote.version),
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    isDemo: local.isDemo && remote.isDemo,
    onboarded: local.onboarded || remote.onboarded,
    goal,
    settings,
    subjects: values<AppState['subjects'][number]>('subjects'),
    materials: values<AppState['materials'][number]>('materials'),
    tasks: values<AppState['tasks'][number]>('tasks'),
    sessions: values<AppState['sessions'][number]>('sessions'),
    planHistory: values<NonNullable<AppState['planHistory']>[number]>('planHistory'),
    availability: values<AppState['availability'][number]>('availability').sort((a, b) => a.weekday - b.weekday),
    dayPlans: values<AppState['dayPlans'][number]>('dayPlans').sort((a, b) => a.date.localeCompare(b.date)),
    fixedEvents: values<AppState['fixedEvents'][number]>('fixedEvents'),
    lastReschedule: local.lastReschedule?.at && remote.lastReschedule?.at
      ? (local.lastReschedule.at >= remote.lastReschedule.at ? local.lastReschedule : remote.lastReschedule)
      : local.lastReschedule ?? remote.lastReschedule,
    lastPlannedDate: [local.lastPlannedDate, remote.lastPlannedDate].filter(Boolean).sort().at(-1) ?? null,
    lastScheduleResult: local.lastScheduleResult ?? remote.lastScheduleResult,
    lastPlanReason: '端末版とクラウド版の非競合変更を自動統合',
  };
  return { merged, conflicts: [], appliedLocalKeys, appliedRemoteKeys, deletedKeys };
}
