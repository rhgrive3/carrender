import type { AppSettings, AppState } from '../types';
import { compactPlanRevisions } from './planHistory';
import {
  MAIN_STATE_ENTITY_HASH_VERSION,
  mainStateEntityDigest,
  type MainStateEntityHashVersion,
} from './mainStateEntityDigest';

export { MAIN_STATE_ENTITY_HASH_VERSION };
export type { MainStateEntityHashVersion };

export type MainStateEntitySection =
  | 'goal'
  | 'settings'
  | 'scheduleState'
  | 'subjects'
  | 'materials'
  | 'tasks'
  | 'sessions'
  | 'planHistory'
  | 'monthlySummaries'
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

/** Versioned SHA-256 digest over canonical entity JSON. */
export function mainStateEntityHash(value: unknown): string {
  return mainStateEntityDigest(value);
}

function settingsCore(settings: AppSettings): AppSettings {
  const { historyData: _historyData, ...core } = settings;
  return core as AppSettings;
}

function scheduleState(state: AppState) {
  return {
    lastReschedule: state.lastReschedule,
    lastPlannedDate: state.lastPlannedDate,
    lastScheduleResult: state.lastScheduleResult,
    lastPlanReason: state.lastPlanReason,
  };
}

function sectionEntries(state: AppState): Record<MainStateEntitySection, [string, unknown][]> {
  return {
    goal: [['value', state.goal]],
    settings: [['value', settingsCore(state.settings)]],
    scheduleState: [['value', scheduleState(state)]],
    subjects: state.subjects.map((item) => [item.id, item]),
    materials: state.materials.map((item) => [item.id, item]),
    tasks: state.tasks.map((item) => [item.id, item]),
    sessions: state.sessions.map((item) => [item.id, item]),
    planHistory: (state.planHistory ?? []).map((item) => [item.id, item]),
    monthlySummaries: (state.settings.historyData?.monthlySummaries ?? []).map((item) => [item.month, item]),
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

function mergePlanRevisions(
  local: AppSettings,
  remote: AppSettings,
  now: Date,
): NonNullable<AppSettings['historyData']>['planRevisions'] {
  const localRevisions = local.historyData?.planRevisions ?? [];
  const remoteRevisions = remote.historyData?.planRevisions ?? [];
  return compactPlanRevisions([...localRevisions, ...remoteRevisions], now);
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
  return { source: 'same', conflict: { section, key, reason: 'bothChanged' } };
}

function manualProgressMaterialId(task: AppState['tasks'][number]): string | null {
  const policy = task.manualScheduling?.progressPolicy;
  return policy?.type === 'countTowardMaterial' ? policy.materialId : null;
}

function detachUnchangedSessionsFromDeletedTasks(
  output: Map<MainStateEntitySection, Map<string, unknown>>,
  deletedKeys: string[],
  appliedLocalKeys: string[],
  appliedRemoteKeys: string[],
) {
  const deletedTaskIds = new Set(
    deletedKeys
      .filter((key) => key.startsWith('tasks:'))
      .map((key) => key.slice('tasks:'.length)),
  );
  if (deletedTaskIds.size === 0) return;

  const changedSessionKeys = new Set(
    [...appliedLocalKeys, ...appliedRemoteKeys]
      .filter((key) => key.startsWith('sessions:')),
  );
  const sessions = output.get('sessions');
  if (!sessions) return;

  for (const [sessionId, value] of sessions) {
    const session = value as AppState['sessions'][number];
    if (!session.taskId || !deletedTaskIds.has(session.taskId)) continue;
    if (changedSessionKeys.has(`sessions:${sessionId}`)) continue;
    sessions.set(sessionId, { ...session, taskId: null });
  }
}

function referentialIntegrityConflicts(
  output: Map<MainStateEntitySection, Map<string, unknown>>,
  baseHashes: MainStateEntityHashSnapshot,
  deletedKeys: string[],
  appliedLocalKeys: string[],
  appliedRemoteKeys: string[],
): MainStateMergeConflict[] {
  const deleted = new Set(deletedKeys);
  const changed = new Set([...appliedLocalKeys, ...appliedRemoteKeys]);
  const subjects = [...(output.get('subjects')?.values() ?? [])] as AppState['subjects'];
  const materials = [...(output.get('materials')?.values() ?? [])] as AppState['materials'];
  const tasks = [...(output.get('tasks')?.values() ?? [])] as AppState['tasks'];
  const sessions = [...(output.get('sessions')?.values() ?? [])] as AppState['sessions'];
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const taskIds = new Set(tasks.map((task) => task.id));
  const conflicts: MainStateMergeConflict[] = [];
  const seen = new Set<string>();
  const push = (conflict: MainStateMergeConflict) => {
    const id = `${conflict.section}:${conflict.key}:${conflict.reason}`;
    if (seen.has(id)) return;
    seen.add(id);
    conflicts.push(conflict);
  };

  for (const key of deleted) {
    if (key.startsWith('materials:')) {
      const materialId = key.slice('materials:'.length);
      const activeOrChangedTask = tasks.some((task) =>
        (task.materialId === materialId || manualProgressMaterialId(task) === materialId)
        && (task.status === 'planned' || task.status === 'doing' || changed.has(`tasks:${task.id}`)));
      const changedSession = sessions.some((session) =>
        session.materialId === materialId && changed.has(`sessions:${session.id}`));
      // 教材削除で「記録は保持」を選んだ既存session/done taskの参照は履歴として有効。
      // 一方、削除と同時に別端末で追加・編集された参照は勝手に孤立させない。
      if (activeOrChangedTask || changedSession) {
        push({ section: 'materials', key: materialId, reason: 'deleteVsEdit' });
      }
    }
    if (key.startsWith('tasks:')) {
      const taskId = key.slice('tasks:'.length);
      if (sessions.some((session) => session.taskId === taskId)) {
        push({ section: 'tasks', key: taskId, reason: 'deleteVsEdit' });
      }
    }
    if (key.startsWith('subjects:')) {
      const subjectId = key.slice('subjects:'.length);
      if (materials.some((material) => material.subjectId === subjectId)
        || tasks.some((task) => task.subjectId === subjectId)
        || sessions.some((session) => session.subjectId === subjectId)) {
        push({ section: 'subjects', key: subjectId, reason: 'deleteVsEdit' });
      }
    }
  }

  for (const material of materials) {
    if (!subjectIds.has(material.subjectId)) {
      push({ section: 'materials', key: material.id, reason: 'deleteVsEdit' });
    }
  }
  for (const task of tasks) {
    const material = task.materialId ? materialById.get(task.materialId) : undefined;
    const progressMaterialId = manualProgressMaterialId(task);
    const progressMaterial = progressMaterialId ? materialById.get(progressMaterialId) : undefined;
    if (!subjectIds.has(task.subjectId)
      || (task.materialId && !material && (task.status === 'planned' || task.status === 'doing'))
      || (material && material.subjectId !== task.subjectId)
      || (progressMaterialId && !progressMaterial)
      || (progressMaterial && progressMaterial.subjectId !== task.subjectId)) {
      push({ section: 'tasks', key: task.id, reason: 'bothChanged' });
    }
  }
  for (const session of sessions) {
    const material = session.materialId ? materialById.get(session.materialId) : undefined;
    const addedAfterBase = baseHashes.sessions?.[session.id] === undefined
      && changed.has(`sessions:${session.id}`);
    if (!subjectIds.has(session.subjectId)
      || (addedAfterBase && session.taskId && !taskIds.has(session.taskId))
      || (addedAfterBase && session.materialId && !material)
      || (material && material.subjectId !== session.subjectId)) {
      push({ section: 'sessions', key: session.id, reason: 'bothChanged' });
    }
  }

  return conflicts;
}

export function mergeMainStates(
  baseHashes: MainStateEntityHashSnapshot | null | undefined,
  local: AppState,
  remote: AppState,
  now = new Date(),
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
  detachUnchangedSessionsFromDeletedTasks(output, deletedKeys, appliedLocalKeys, appliedRemoteKeys);
  conflicts.push(...referentialIntegrityConflicts(
    output,
    baseHashes,
    deletedKeys,
    appliedLocalKeys,
    appliedRemoteKeys,
  ));
  if (conflicts.length > 0) return { merged: null, conflicts, appliedLocalKeys, appliedRemoteKeys, deletedKeys };

  const goal = (output.get('goal')?.get('value') ?? null) as AppState['goal'];
  const settingsCoreValue = output.get('settings')?.get('value') as AppSettings;
  const mergedScheduleState = output.get('scheduleState')?.get('value') as ReturnType<typeof scheduleState>;
  const values = <T>(section: MainStateEntitySection): T[] => [...(output.get(section)?.values() ?? [])] as T[];
  const monthlySummaries = values<NonNullable<AppSettings['historyData']>['monthlySummaries'][number]>('monthlySummaries')
    .sort((left, right) => left.month.localeCompare(right.month));
  const settings: AppSettings = {
    ...settingsCoreValue,
    historyData: {
      planRevisions: mergePlanRevisions(local.settings, remote.settings, now),
      monthlySummaries,
    },
  };

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
    ...mergedScheduleState,
  };
  return { merged, conflicts: [], appliedLocalKeys, appliedRemoteKeys, deletedKeys };
}
