import type { SchedulerPolicySnapshot } from '../types';

/**
 * Scheduler tuning policy.
 *
 * These values intentionally preserve existing planning behaviour. Keeping them
 * together makes later changes reviewable as one policy revision instead of an
 * accidental collection of unrelated magic-number edits.
 */
export const SCHEDULER_POLICY_VERSION = '2026-07-23.1';

export const ESTIMATE_POLICY = Object.freeze({
  /** Exponential smoothing weight applied to the newest observed median. */
  smoothingAlpha: 0.2,
  /** Reject samples below one quarter or above four times the median. */
  medianRatioFloor: 0.25,
  medianRatioCeiling: 4,
  /** Robust outlier threshold measured in median absolute deviations. */
  madMultiplier: 3,
  /** One update may reduce or increase the estimate by at most 15%. */
  maxRelativeDecrease: 0.15,
  maxRelativeIncrease: 0.15,
  /** Do not suggest or apply an automatic estimate with fewer samples. */
  minimumSamples: 3,
});

export const SCHEDULER_POLICY = Object.freeze({
  /** Target 15%/10% of the material span as strict/normal deadline buffer. */
  strictPreferredFinishRatio: 0.85,
  normalPreferredFinishRatio: 0.9,
  strictMinimumLeadDays: 2,
  normalMinimumLeadDays: 1,
  reserveShortSpanMaxDays: 7,
  reserveMediumSpanMaxDays: 21,
  reserveLongSpanMaxDays: 60,
  reserveShortDays: 1,
  reserveMediumDays: 2,
  reserveLongDays: 5,
  reserveProportion: 0.12,
  strictAdditionalReserveDays: 1,
  /** Daily load caps are searched in five-minute increments. */
  balancedLoadStepMinutes: 5,
  /** Prevent cap relaxation from becoming an unbounded loop. */
  maximumCapRelaxationAttempts: 12,
  /** Enough candidate information for deterministic search ordering. */
  placementCountCap: 33,
});

export function schedulerPolicyReport(): SchedulerPolicySnapshot {
  return {
    version: SCHEDULER_POLICY_VERSION,
    estimate: { ...ESTIMATE_POLICY },
    scheduler: { ...SCHEDULER_POLICY },
  };
}
