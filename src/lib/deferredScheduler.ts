import type { AppState, ISODate } from '../types';

export type DeferredPlanningStatus = 'idle' | 'planning' | 'error';

export interface DeferredPlanRequest {
  state: AppState;
  fromDate: ISODate;
  reason: string;
}

interface WorkerSuccessMessage {
  ok: true;
  state: AppState;
}

interface WorkerFailureMessage {
  ok: false;
  message: string;
}

type WorkerResponse = WorkerSuccessMessage | WorkerFailureMessage;

export interface DeferredPlanHandle {
  generation: number;
  promise: Promise<AppState>;
}

export interface DeferredScheduler {
  request(input: DeferredPlanRequest): DeferredPlanHandle;
  cancel(): void;
  dispose(): void;
  generation(): number;
}

export class DeferredPlanCancelledError extends Error {
  constructor() {
    super('計画の再計算は新しい操作に置き換えられました');
    this.name = 'DeferredPlanCancelledError';
  }
}

const WORKER_TIMEOUT_MS = 60_000;

/**
 * Owns one planner worker. A newer request terminates and rejects the older
 * computation so stale plans neither consume CPU nor leave pending promises.
 */
export function createDeferredScheduler(): DeferredScheduler {
  let currentGeneration = 0;
  let activeWorker: Worker | null = null;
  let activeReject: ((reason?: unknown) => void) | null = null;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearActive = (worker?: Worker) => {
    if (worker && activeWorker !== worker) return;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = null;
    activeWorker = null;
    activeReject = null;
  };

  const cancel = () => {
    currentGeneration += 1;
    const worker = activeWorker;
    const reject = activeReject;
    clearActive();
    worker?.terminate();
    reject?.(new DeferredPlanCancelledError());
  };

  return {
    request(input) {
      cancel();
      const generation = currentGeneration;
      const worker = new Worker(new URL('../workers/scheduler.worker.ts', import.meta.url), { type: 'module' });
      activeWorker = worker;
      const promise = new Promise<AppState>((resolve, reject) => {
        activeReject = reject;
        const finish = () => {
          clearActive(worker);
          worker.terminate();
        };
        activeTimer = setTimeout(() => {
          finish();
          reject(new Error('計画の再計算がタイムアウトしました'));
        }, WORKER_TIMEOUT_MS);
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          finish();
          if (event.data.ok) resolve(event.data.state);
          else reject(new Error(event.data.message));
        };
        worker.onerror = (event) => {
          finish();
          reject(new Error(event.message || '計画ワーカーでエラーが発生しました'));
        };
        worker.postMessage(input);
      });
      return { generation, promise };
    },
    cancel,
    dispose: cancel,
    generation: () => currentGeneration,
  };
}

export function canApplyDeferredPlan(
  requestedGeneration: number,
  currentGeneration: number,
  committedState: AppState,
  currentState: AppState,
): boolean {
  return requestedGeneration === currentGeneration && committedState === currentState;
}
