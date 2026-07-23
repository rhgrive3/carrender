import type { AppState, ISODate } from '../types';
import { generatePlan } from './scheduler';
import {
  prepareSessionMutation,
  type SessionMutationAction,
} from './sessionMutation';

/**
 * Synchronous compatibility adapter for reducer/unit-test callers. The UI uses
 * the deferred worker path exposed by AppContext so the record itself commits
 * before planning starts.
 */
export function applyRecordSessionTransaction(
  state: AppState,
  action: Exclude<SessionMutationAction, { type: 'DELETE_SESSION' }>,
  replanFrom: ISODate,
): AppState {
  const prepared = prepareSessionMutation(state, action, replanFrom);
  if (!prepared) return state;
  const planned = generatePlan(prepared.state, prepared.replanFrom, prepared.reason).state;
  return prepared.clearLastRescheduleOnSuccess ? { ...planned, lastReschedule: null } : planned;
}
