/// <reference lib="webworker" />
import type { AppState, ISODate } from '../types';
import { generatePlan } from '../lib/scheduler';

interface PlannerRequest {
  state: AppState;
  fromDate: ISODate;
  reason: string;
}

self.onmessage = (event: MessageEvent<PlannerRequest>) => {
  try {
    const planned = generatePlan(event.data.state, event.data.fromDate, event.data.reason).state;
    self.postMessage({ ok: true, state: planned });
  } catch (caught) {
    self.postMessage({
      ok: false,
      message: caught instanceof Error ? caught.message : '計画を再計算できませんでした',
    });
  }
};

export {};
