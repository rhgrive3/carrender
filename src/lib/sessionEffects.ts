import type { AppState, Material, StudySession } from '../types';
import { normalizeUnitRanges, sumRangeLengths, updateMinutesPerUnitEstimate } from './scheduler';

function subtractRanges(
  ranges: { start: number; end: number }[],
  removals: { start: number; end: number }[],
): { start: number; end: number }[] {
  let current = normalizeUnitRanges(ranges, Number.MAX_SAFE_INTEGER);
  for (const removal of normalizeUnitRanges(removals, Number.MAX_SAFE_INTEGER)) {
    current = current.flatMap((range) => {
      if (removal.end < range.start || removal.start > range.end) return [range];
      return [
        ...(removal.start > range.start ? [{ start: range.start, end: removal.start - 1 }] : []),
        ...(removal.end < range.end ? [{ start: removal.end + 1, end: range.end }] : []),
      ];
    });
  }
  return current;
}

/**
 * Keeps legacy progress without provenance as a baseline and rebuilds only the
 * exact ranges contributed by current-format sessions.
 */
export function rebuildMaterialProgress(
  material: Material,
  beforeSessions: StudySession[],
  nextSessions: StudySession[],
): Material {
  const current = material.completedRanges
    ?? (material.doneAmount > 0 ? [{ start: 1, end: material.doneAmount }] : []);
  const beforeContributions = beforeSessions
    .filter((session) => session.materialId === material.id)
    .flatMap((session) => session.progressRangesAdded ?? []);
  const baseline = subtractRanges(current, beforeContributions);
  const nextContributions = nextSessions
    .filter((session) => session.materialId === material.id)
    .flatMap((session) => session.progressRangesAdded ?? []);
  const completedRanges = normalizeUnitRanges(
    [...baseline, ...nextContributions],
    material.totalAmount,
  );
  return { ...material, completedRanges, doneAmount: sumRangeLengths(completedRanges) };
}

/** Reverses every durable side effect represented by one study session. */
export function revertSessionEffects(state: AppState, session: StudySession): AppState {
  const sessions = state.sessions.filter((entry) => entry.id !== session.id);
  let tasks = state.tasks.filter((task) =>
    !(session.generatedReviewTaskIds ?? []).includes(task.id)
    && !(session.replacementTaskIds ?? []).includes(task.id));
  if (session.taskSnapshotBefore) {
    tasks = [
      ...tasks.filter((task) => task.id !== session.taskSnapshotBefore!.id),
      session.taskSnapshotBefore,
    ];
  }
  let materials = state.materials.map((material) =>
    rebuildMaterialProgress(material, state.sessions, sessions));
  materials = materials.map((material) => {
    const estimate = updateMinutesPerUnitEstimate(
      material,
      sessions,
      state.settings.estimateAlpha ?? 0.2,
    );
    return {
      ...material,
      minutesPerUnit: estimate.appliedEstimate,
      estimatedMinutesPerUnit:
        estimate.suggestedEstimate ?? material.estimatedMinutesPerUnit,
    };
  });
  return { ...state, sessions, materials, tasks };
}
