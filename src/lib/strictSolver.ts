import type { ISODate } from '../types';

/**
 * 厳守期限作業のグローバル実行可能性ソルバー。
 *
 * 全strict作業(教材・手動タスク)を共通のSolverItemへ変換し、
 * 「候補配置が少ない作業から仮配置 → 残りが配置不能ならロールバックして別候補」
 * というバックトラック探索で、区間・チャンク条件込みの配置可能性を判定する。
 *
 * - 単位はitemごとのunit(教材=単位数、手動タスク=分でminutesPerUnit=1)。
 * - maxNodes / maxMs の探索上限に達したら indeterminate を返す(infeasibleにしない)。
 */

export interface SolverSlot {
  start: number;
  end: number;
}

export interface SolverDayInput {
  date: ISODate;
  slots: SolverSlot[];
  budget: number;
}

export interface SolverItem {
  id: string;
  release: ISODate;
  deadline: ISODate;
  requiredUnits: number;
  minutesPerUnit: number;
  unitStep: number;
  minChunkUnits: number;
  maxChunkUnits: number;
  splittable: boolean;
  maxUnitsPerDay?: number;
  maxMinutesPerDay?: number;
}

export interface SolverOptions {
  maxNodes: number;
  maxMs: number;
  /** trueなら期限側の日から先に埋める(最遅スケジュール=最低予約量の算出用) */
  preferLate: boolean;
}

export interface DayAllocation {
  date: ISODate;
  units: number;
  minutes: number;
}

export interface SolveResult {
  status: 'feasible' | 'infeasible' | 'indeterminate';
  allocations: Map<string, DayAllocation[]>;
  nodes: number;
  elapsedMs: number;
}

export function minutesForUnits(minutesPerUnit: number, units: number): number {
  return units <= 0 ? 0 : Math.max(1, Math.round(units * minutesPerUnit));
}

/**
 * チャンク単位数が許されるか(brute force比較器と共有する意味論)。
 * tailEligible = 「端数チャンク(最小チャンク未満/刻み不一致)を教材末尾として置ける状況」。
 * 端数チャンクは1作業につき1つだけ、かつそれ以降その作業をより遅い日に置かないことが前提。
 */
export function isChunkAllowed(item: SolverItem, units: number, remaining: number, tailEligible: boolean): boolean {
  if (units <= 0 || units > remaining) return false;
  if (!item.splittable) return units === remaining;
  if (units > item.maxChunkUnits) return false;
  const regular = units % item.unitStep === 0 && units >= item.minChunkUnits;
  if (regular) return true;
  if (!tailEligible) return false;
  if (units === remaining) return true;
  const rest = remaining - units;
  return rest % item.unitStep === 0 && rest >= item.minChunkUnits;
}

/** 探索順のタイブレーク: 期限が早い→開始が遅い→最小チャンク大→必要量大→ID昇順 */
export function compareItemsForSearch(a: SolverItem, b: SolverItem): number {
  return a.deadline.localeCompare(b.deadline)
    || b.release.localeCompare(a.release)
    || b.minChunkUnits - a.minChunkUnits
    || b.requiredUnits * b.minutesPerUnit - a.requiredUnits * a.minutesPerUnit
    || a.id.localeCompare(b.id);
}

interface DayState {
  date: ISODate;
  slots: SolverSlot[];
  budget: number;
}

interface ItemState {
  item: SolverItem;
  remaining: number;
  firstIdx: number;
  lastIdx: number;
  perDayUnits: number[];
  perDayMinutes: number[];
  /** これまでに配置した最大日index(端数チャンクはこれ以降の日にしか置けない) */
  maxAllocIdx: number;
  /** 端数チャンクを置いた日index。以降はこの日以前にしか置けない */
  tailIdx: number;
  allocations: { dayIdx: number; units: number; minutes: number }[];
}

interface Move {
  itemIdx: number;
  dayIdx: number;
  slotIdx: number;
  units: number;
  minutes: number;
  isTail: boolean;
}

/** 指定作業の現時点での候補配置数を数える(cap打ち切り)。初期の処理順決定にも使う。 */
export function countItemPlacements(item: SolverItem, days: SolverDayInput[], cap = 33): number {
  const state = buildItemState(item, days);
  if (!state) return 0;
  let count = 0;
  for (let dayIdx = state.firstIdx; dayIdx <= state.lastIdx; dayIdx += 1) {
    const day = days[dayIdx];
    const seen = new Set<number>();
    for (let slotIdx = 0; slotIdx < day.slots.length; slotIdx += 1) {
      const len = day.slots[slotIdx].end - day.slots[slotIdx].start;
      if (len <= 0 || seen.has(len)) continue;
      seen.add(len);
      count += enumerateUnits(item, state, dayIdx, Math.min(len, day.budget), true).length;
      if (count >= cap) return cap;
    }
  }
  return count;
}

function buildItemState(item: SolverItem, days: { date: ISODate }[]): ItemState | null {
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < days.length; i += 1) {
    const date = days[i].date;
    if (date >= item.release && date <= item.deadline) {
      if (firstIdx < 0) firstIdx = i;
      lastIdx = i;
    }
  }
  if (firstIdx < 0) return null;
  return {
    item,
    remaining: item.requiredUnits,
    firstIdx,
    lastIdx,
    perDayUnits: new Array(days.length).fill(0),
    perDayMinutes: new Array(days.length).fill(0),
    maxAllocIdx: -1,
    tailIdx: Number.POSITIVE_INFINITY,
    allocations: [],
  };
}

/** その日・その空き容量に置けるチャンク単位数の候補(大きい順) */
function enumerateUnits(item: SolverItem, state: ItemState, dayIdx: number, freeMinutes: number, tailEligibleDay: boolean): number[] {
  const remaining = state.remaining;
  if (remaining <= 0 || freeMinutes <= 0) return [];
  const capMinutes = Math.min(
    freeMinutes,
    item.maxMinutesPerDay === undefined ? Number.POSITIVE_INFINITY : item.maxMinutesPerDay - state.perDayMinutes[dayIdx],
  );
  const capUnitsByDay = item.maxUnitsPerDay === undefined ? Number.POSITIVE_INFINITY : item.maxUnitsPerDay - state.perDayUnits[dayIdx];
  if (capMinutes <= 0 || capUnitsByDay <= 0) return [];
  let fitUnits = Math.min(remaining, capUnitsByDay, Math.floor(capMinutes / Math.max(item.minutesPerUnit, 0.0001)));
  while (fitUnits > 0 && minutesForUnits(item.minutesPerUnit, fitUnits) > capMinutes) fitUnits -= 1;
  if (fitUnits <= 0) return [];
  if (!item.splittable) {
    return fitUnits >= remaining ? [remaining] : [];
  }
  const tailEligible = tailEligibleDay && state.tailIdx === Number.POSITIVE_INFINITY && dayIdx >= state.maxAllocIdx;
  const kMax = Math.min(item.maxChunkUnits, fitUnits);
  const result: number[] = [];
  // 通常チャンク: unitStepの倍数かつ最小チャンク以上(大きい順)
  const step = Math.max(1, item.unitStep);
  for (let k = Math.floor(kMax / step) * step; k >= item.minChunkUnits; k -= step) {
    if (k > 0 && isChunkAllowed(item, k, remaining, tailEligible)) result.push(k);
  }
  // 全量チャンク(端数含む)
  if (remaining <= kMax && !result.includes(remaining) && isChunkAllowed(item, remaining, remaining, tailEligible)) {
    result.unshift(remaining);
  }
  // 端数(末尾)チャンク: 残り − k が通常チャンクへ分解可能なもの
  if (tailEligible) {
    for (let k = Math.min(kMax, remaining - item.minChunkUnits); k >= 1; k -= 1) {
      if ((remaining - k) % step !== 0) continue;
      if (result.includes(k)) continue;
      if (isChunkAllowed(item, k, remaining, true)) result.push(k);
    }
  }
  return result;
}

export function solveStrict(items: SolverItem[], daysInput: SolverDayInput[], options: SolverOptions): SolveResult {
  const startedAt = Date.now();
  const days: DayState[] = daysInput.map((day) => ({
    date: day.date,
    slots: day.slots.map((slot) => ({ ...slot })).filter((slot) => slot.end > slot.start),
    budget: day.budget,
  }));
  const itemStates: ItemState[] = [];
  let impossible: string | null = null;
  for (const item of [...items].sort(compareItemsForSearch)) {
    if (item.requiredUnits <= 0) continue;
    const state = buildItemState(item, days);
    if (!state) {
      impossible = item.id;
      break;
    }
    itemStates.push(state);
  }
  if (impossible !== null) {
    return { status: 'infeasible', allocations: new Map(), nodes: 0, elapsedMs: Date.now() - startedAt };
  }

  let nodes = 0;
  let hitLimit = false;

  const boundOk = (): boolean => {
    for (const state of itemStates) {
      if (state.remaining <= 0) continue;
      const item = state.item;
      const needed = minutesForUnits(item.minutesPerUnit, state.remaining);
      let capacity = 0;
      const lastAllowed = Math.min(state.lastIdx, state.tailIdx);
      for (let i = state.firstIdx; i <= lastAllowed; i += 1) {
        const dayCap = item.maxMinutesPerDay === undefined
          ? days[i].budget
          : Math.min(days[i].budget, item.maxMinutesPerDay - state.perDayMinutes[i]);
        if (dayCap > 0) capacity += dayCap;
        if (capacity >= needed) break;
      }
      if (capacity < needed) return false;
    }
    return true;
  };

  const movesFor = (itemIdx: number, cap: number): Move[] => {
    const state = itemStates[itemIdx];
    const item = state.item;
    const moves: Move[] = [];
    const lastAllowed = Math.min(state.lastIdx, state.tailIdx);
    const dayOrder: number[] = [];
    if (options.preferLate) {
      for (let i = lastAllowed; i >= state.firstIdx; i -= 1) dayOrder.push(i);
    } else {
      for (let i = state.firstIdx; i <= lastAllowed; i += 1) dayOrder.push(i);
    }
    for (const dayIdx of dayOrder) {
      const day = days[dayIdx];
      if (day.budget <= 0) continue;
      // 同じ長さのスロットは等価なので代表1つに絞る
      const seen = new Set<number>();
      const slotOrder = day.slots
        .map((slot, slotIdx) => ({ slotIdx, len: slot.end - slot.start }))
        .filter(({ len }) => {
          if (len <= 0 || seen.has(len)) return false;
          seen.add(len);
          return true;
        })
        .sort((a, b) => a.len - b.len); // best-fit: 小さいスロットから
      for (const { slotIdx, len } of slotOrder) {
        const free = Math.min(len, day.budget);
        for (const units of enumerateUnits(item, state, dayIdx, free, true)) {
          const minutes = minutesForUnits(item.minutesPerUnit, units);
          const isTail = item.splittable && (units % Math.max(1, item.unitStep) !== 0 || units < item.minChunkUnits);
          moves.push({ itemIdx, dayIdx, slotIdx, units, minutes, isTail });
          if (moves.length >= cap) return moves;
        }
      }
    }
    return moves;
  };

  const apply = (move: Move) => {
    const state = itemStates[move.itemIdx];
    const day = days[move.dayIdx];
    day.slots[move.slotIdx].start += move.minutes;
    day.budget -= move.minutes;
    state.remaining -= move.units;
    state.perDayUnits[move.dayIdx] += move.units;
    state.perDayMinutes[move.dayIdx] += move.minutes;
    state.allocations.push({ dayIdx: move.dayIdx, units: move.units, minutes: move.minutes });
    if (move.isTail) state.tailIdx = move.dayIdx;
    if (move.dayIdx > state.maxAllocIdx) state.maxAllocIdx = move.dayIdx;
  };

  const undo = (move: Move, prevMaxAllocIdx: number, prevTailIdx: number) => {
    const state = itemStates[move.itemIdx];
    const day = days[move.dayIdx];
    day.slots[move.slotIdx].start -= move.minutes;
    day.budget += move.minutes;
    state.remaining += move.units;
    state.perDayUnits[move.dayIdx] -= move.units;
    state.perDayMinutes[move.dayIdx] -= move.minutes;
    state.allocations.pop();
    state.maxAllocIdx = prevMaxAllocIdx;
    state.tailIdx = prevTailIdx;
  };

  const search = (): boolean => {
    nodes += 1;
    if (nodes > options.maxNodes) {
      hitLimit = true;
      return false;
    }
    if ((nodes & 63) === 0 && Date.now() - startedAt > options.maxMs) {
      hitLimit = true;
      return false;
    }
    const pending = itemStates.filter((state) => state.remaining > 0);
    if (pending.length === 0) return true;
    if (!boundOk()) return false;
    // MRV: 候補配置が最も少ない作業を選ぶ
    let bestIdx = -1;
    let bestCount = Number.POSITIVE_INFINITY;
    for (const state of pending) {
      const itemIdx = itemStates.indexOf(state);
      const count = movesFor(itemIdx, 33).length;
      if (count === 0) return false;
      if (count < bestCount || (count === bestCount && compareItemsForSearch(state.item, itemStates[bestIdx].item) < 0)) {
        bestCount = count;
        bestIdx = itemIdx;
      }
    }
    const moves = movesFor(bestIdx, 4096);
    for (const move of moves) {
      const state = itemStates[bestIdx];
      const prevMax = state.maxAllocIdx;
      const prevTail = state.tailIdx;
      apply(move);
      if (search()) return true;
      undo(move, prevMax, prevTail);
      if (hitLimit) return false;
    }
    return false;
  };

  const found = search();
  const elapsedMs = Date.now() - startedAt;
  if (found) {
    const allocations = new Map<string, DayAllocation[]>();
    for (const state of itemStates) {
      const byDay = new Map<number, { units: number; minutes: number }>();
      for (const alloc of state.allocations) {
        const entry = byDay.get(alloc.dayIdx) ?? { units: 0, minutes: 0 };
        entry.units += alloc.units;
        entry.minutes += alloc.minutes;
        byDay.set(alloc.dayIdx, entry);
      }
      allocations.set(
        state.item.id,
        [...byDay.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([dayIdx, entry]) => ({ date: days[dayIdx].date, units: entry.units, minutes: entry.minutes })),
      );
    }
    return { status: 'feasible', allocations, nodes, elapsedMs };
  }
  return { status: hitLimit ? 'indeterminate' : 'infeasible', allocations: new Map(), nodes, elapsedMs };
}
