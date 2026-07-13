/**
 * スケジューラーV2 仕様テスト (要件13〜18)
 * 実行: npx vite-node scripts/schedulerV2.test.ts
 */
import { generatePlan } from '../src/lib/scheduler';
import { generatePlanV2, validateGeneratedScheduleV2 } from '../src/lib/schedulerV2';
import type { SolverDayInput, SolverItem } from '../src/lib/strictSolver';
import { isChunkAllowed, minutesForUnits, solveStrict } from '../src/lib/strictSolver';
import { normalizeState } from '../src/lib/storage';
import { emptyState } from '../src/state/AppContext';
import type { AppState, Material, SchedulerContext, StudyTask } from '../src/types';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

const fixedNow = new Date('2026-07-09T23:00:00.000Z'); // JST 2026-07-10 08:00
const D1 = '2026-07-10';
const D2 = '2026-07-11';
const D3 = '2026-07-12';
const D4 = '2026-07-13';
const context = (over: Partial<SchedulerContext> = {}): SchedulerContext => ({
  now: fixedNow,
  timezone: 'Asia/Tokyo',
  generationId: 'spec-test',
  maxSearchMilliseconds: 60_000,
  ...over,
});

const subject = { id: 'subj', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 } as const;

function mat(id: string, over: Partial<Material>): Material {
  return {
    id,
    subjectId: subject.id,
    name: id,
    unit: '問題',
    totalAmount: 1,
    totalUnits: over.totalAmount ?? 1,
    doneAmount: 0,
    completedRanges: [],
    startDate: D1,
    targetDate: D1,
    priority: 3,
    difficulty: 3,
    minutesPerUnit: 60,
    unitStep: 1,
    splittable: true,
    preferredCadence: { type: 'auto' },
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: 'strict',
    examRelevance: 3,
    reviewEnabled: false,
    reviewIntervals: [1, 3, 7],
    paused: false,
    round: 1,
    archived: false,
    createdAt: fixedNow.toISOString(),
    ...over,
  };
}

function baseState(materials: Material[], windows: { start: string; end: string }[], minutes: number, over: Partial<AppState> = {}): AppState {
  const empty = emptyState();
  return {
    ...empty,
    onboarded: true,
    subjects: [subject],
    materials,
    availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({ weekday, minutes, windows })),
    settings: { ...empty.settings, maxDailyMinutes: minutes, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 7 },
    ...over,
  };
}

function manualTask(id: string, over: Partial<StudyTask>): StudyTask {
  return {
    id,
    subjectId: subject.id,
    materialId: null,
    title: id,
    rangeLabel: '',
    rangeStart: null,
    rangeEnd: null,
    amount: 1,
    estimatedMinutes: 60,
    priority: 60,
    dueDate: null,
    type: 'new',
    status: 'planned',
    scheduledDate: D1,
    scheduledStart: null,
    scheduledEnd: null,
    generatedBy: 'manual',
    memo: '',
    reviewStage: null,
    createdAt: fixedNow.toISOString(),
    completedAt: null,
    sourceType: 'manual',
    sourceId: id,
    ...over,
  };
}

// ============================================================
console.log('--- 13. 貪欲配置では失敗するが解が存在するケース ---');
{
  // A: 開始1日目/期限2日目/60分・B: 開始1日目/期限1日目/60分、各日60分枠
  const state = baseState(
    [mat('mat_a', { targetDate: D2, minutesPerUnit: 60 }), mat('mat_b', { targetDate: D1, minutesPerUnit: 60 })],
    [{ start: '09:00', end: '10:00' }],
    60,
  );
  const result = generatePlanV2(state, context());
  const aTask = result.scheduledTasks.find((task) => task.materialId === 'mat_a');
  const bTask = result.scheduledTasks.find((task) => task.materialId === 'mat_b');
  check('status: success', result.status === 'success', result.status);
  check('教材Bが1日目', bTask?.scheduledDate === D1, bTask);
  check('教材Aが2日目', aTask?.scheduledDate === D2, aTask);
}
{
  // 同一期限でも、分割不可の作業が唯一入る連続枠を分割可能な作業に奪わせない
  // A: 60分・分割不可(1日目の60分連続枠にしか入らない)
  // B: 60分・分割可・最小30分(2日目の30分+30分に入れる)
  const state = baseState(
    [
      mat('mat_whole', { targetDate: D2, minutesPerUnit: 60, splittable: false }),
      mat('mat_split', { targetDate: D2, minutesPerUnit: 30, totalAmount: 2, totalUnits: 2, minimumChunkUnits: 1 }),
    ],
    [{ start: '09:00', end: '10:00' }],
    120,
    {
      dayPlans: [{ date: D2, load: 'normal', memo: '', availabilityWindows: [{ start: '09:00', end: '09:30' }, { start: '11:00', end: '11:30' }] }],
    },
  );
  const result = generatePlanV2(state, context());
  const whole = result.scheduledTasks.filter((task) => task.materialId === 'mat_whole');
  check('分割不可の作業が唯一の連続枠(1日目)を確保して全体が成功する', result.status === 'success' && whole[0]?.scheduledDate === D1, {
    status: result.status,
    tasks: result.scheduledTasks.map((task) => `${task.materialId} ${task.scheduledDate} ${task.scheduledStart}`),
  });
}

// ============================================================
console.log('--- 14. 複数のreleaseDateとdeadline ---');
{
  // A: release1日目/期限4日目・B: release3日目/期限3日目・C: release2日目/期限4日目、各60分、各日60分枠
  const state = baseState(
    [
      mat('mat_ra', { startDate: D1, targetDate: D4, minutesPerUnit: 60 }),
      mat('mat_rb', { startDate: D3, targetDate: D3, minutesPerUnit: 60 }),
      mat('mat_rc', { startDate: D2, targetDate: D4, minutesPerUnit: 60 }),
    ],
    [{ start: '09:00', end: '10:00' }],
    60,
  );
  const result = generatePlanV2(state, context());
  const byMat = (id: string) => result.scheduledTasks.filter((task) => task.materialId === id);
  check('解がある場合は必ず配置する(status success)', result.status === 'success', { status: result.status, unscheduled: result.unscheduledWork });
  check('Bはrelease=期限の3日目に配置', byMat('mat_rb')[0]?.scheduledDate === D3, byMat('mat_rb'));
  check('全教材がrelease〜期限内に配置', result.scheduledTasks.every((task) => {
    const material = state.materials.find((item) => item.id === task.materialId);
    return material ? task.scheduledDate >= material.startDate && task.scheduledDate <= material.targetDate : true;
  }), result.scheduledTasks.map((task) => `${task.materialId} ${task.scheduledDate}`));
}

// ============================================================
console.log('--- 15. ロールバック後の不足量 ---');
{
  // 必要300分・途中200分まで仮配置可能・最後100分が配置不能 → 最終配置0分/不足300分
  const state = baseState(
    [mat('mat_rb300', { targetDate: D2, totalAmount: 10, totalUnits: 10, minutesPerUnit: 30 })],
    [{ start: '09:00', end: '10:40' }], // 100分/日 × 2日 = 200分 < 300分
    100,
    { settings: { ...emptyState().settings, maxDailyMinutes: 100, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 7 } },
  );
  const result = generatePlanV2(state, context());
  const report = result.deadlineReports.find((item) => item.workItemId === 'material:mat_rb300');
  check('status: infeasible', result.status === 'infeasible', result.status);
  check('最終配置0分', report?.scheduledMinutes === 0, report);
  check('不足300分(仮配置分を差し引かない)', report?.shortageMinutes === 300, report);
  check('教材のタスクが1つも採用されない', !result.scheduledTasks.some((task) => task.materialId === 'mat_rb300'), result.scheduledTasks);
}

// ============================================================
console.log('--- 16. 固定条件誤判定 ---');
{
  // 日付固定: 指定日の先頭時刻が塞がっていても、同日内の別時刻へ配置してconflictにしない
  const state = baseState([], [{ start: '09:00', end: '12:00' }], 180, {
    fixedEvents: [{ id: 'ev_am', title: '模試', weekday: null, date: D1, start: '09:00', end: '10:00' }],
    tasks: [manualTask('task_datelock', { placementLock: 'date', scheduledDate: D1, estimatedMinutes: 60 })],
  });
  const result = generatePlanV2(state, context());
  const placed = result.scheduledTasks.find((task) => task.id === 'task_datelock');
  check('日付固定タスクはconflictにならない', result.conflicts.length === 0, result.conflicts);
  check('指定日内の空き時刻(10:00〜)へ配置される', placed?.scheduledDate === D1 && placed?.scheduledStart === '10:00', placed);
}
{
  // 時刻固定タスクが日別予算だけを超える場合: 固定を維持し、警告を出し、自動タスクを減らす
  const state = baseState(
    [mat('mat_auto', { deadlinePolicy: 'normal', targetDate: '2026-07-20', totalAmount: 20, totalUnits: 20, minutesPerUnit: 30 })],
    [{ start: '09:00', end: '12:00' }],
    60, // 予算60分 < 固定90分(利用可能時間帯180分の内側)
    {
      tasks: [manualTask('task_over', { placementLock: 'time', scheduledDate: D1, scheduledStart: '09:00', scheduledEnd: '10:30', estimatedMinutes: 90 })],
    },
  );
  const result = generatePlanV2(state, context());
  const kept = result.scheduledTasks.find((task) => task.id === 'task_over');
  const autoMinutesOnDay = result.scheduledTasks
    .filter((task) => task.scheduledDate === D1 && task.id !== 'task_over')
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);
  check('予算超過だけではconflictにしない', result.conflicts.length === 0, result.conflicts);
  check('時刻固定タスクは維持される', kept?.scheduledStart === '09:00' && kept?.estimatedMinutes === 90, kept);
  check('EXCEEDS_DAILY_BUDGET警告を出す', result.warnings.some((warning) => warning.code === 'EXCEEDS_DAILY_BUDGET'), result.warnings);
  check('その日の自動タスクは0分に減らされる', autoMinutesOnDay === 0, autoMinutesOnDay);
}
{
  // 完了済み未来タスク: 未来容量を予約しない・固定衝突を出さない
  const done = manualTask('task_done_future', {
    status: 'done',
    completedAt: fixedNow.toISOString(),
    scheduledDate: D2,
    scheduledStart: '09:00',
    scheduledEnd: '10:00',
    estimatedMinutes: 60,
    placementLock: 'time',
  });
  const state = baseState(
    [mat('mat_fill', { deadlinePolicy: 'normal', targetDate: D2, totalAmount: 4, totalUnits: 4, minutesPerUnit: 30 })],
    [{ start: '09:00', end: '10:00' }],
    60,
    { tasks: [done] },
  );
  const result = generatePlanV2(state, context());
  const day2Planned = result.scheduledTasks.filter((task) => task.scheduledDate === D2 && task.status === 'planned');
  check('完了済み未来タスクを固定衝突にしない', result.conflicts.length === 0, result.conflicts);
  check('完了済みタスクはscheduledTasksへ入らない(履歴のまま)', !result.scheduledTasks.some((task) => task.id === done.id));
  check('完了済みタスクの時間帯(09:00〜)が未来容量として使える', day2Planned.some((task) => task.scheduledStart === '09:00'), day2Planned);
}
{
  // 旧手動タスク: 時刻の有無から固定を推測せず、明示ポリシーだけを移行する
  const legacyTimed = manualTask('task_legacy_t', { scheduledStart: '18:00', scheduledEnd: '19:00' });
  const legacyDated = manualTask('task_legacy_d', {});
  delete (legacyTimed as Partial<StudyTask>).placementLock;
  delete (legacyDated as Partial<StudyTask>).placementLock;
  const migrated = normalizeState({ ...emptyState(), tasks: [legacyTimed, legacyDated] });
  check('旧データ移行で時刻ありでもplacementLock=none', migrated.tasks.find((task) => task.id === 'task_legacy_t')?.placementLock === 'none');
  check('旧データ移行で時刻なしもplacementLock=none', migrated.tasks.find((task) => task.id === 'task_legacy_d')?.placementLock === 'none');
  // 通常スケジューラーはgeneratedBy==='manual'から推測しない: 明示ロックが無ければ固定扱いされない
  const unlocked = manualTask('task_nolock', { scheduledStart: '09:00', scheduledEnd: '10:00', estimatedMinutes: 60 });
  delete (unlocked as Partial<StudyTask>).placementLock;
  const state = baseState([], [{ start: '11:00', end: '12:00' }], 60, { tasks: [unlocked] });
  const result = generatePlanV2(state, context());
  const moved = result.scheduledTasks.find((task) => task.id === 'task_nolock');
  check('明示ロックの無い手動タスクは固定扱いせずconflictも出さない', result.conflicts.length === 0, result.conflicts);
  check('明示ロックの無い手動タスクは空き時間へ再配置される', moved?.scheduledStart === '11:00', moved);
}
{
  const now20 = new Date('2026-07-10T11:00:00.000Z'); // JST 20:00
  const pastAuto = manualTask('task_past_auto', {
    generatedBy: 'auto', sourceType: 'review', type: 'review', placementLock: 'none',
    scheduledDate: D1, scheduledStart: '18:00', scheduledEnd: '19:00', estimatedMinutes: 60,
  });
  const replanned = generatePlan(baseState([], [{ start: '18:00', end: '23:00' }], 300, { tasks: [pastAuto] }), D2, '保護タスク再計算', {
    now: now20, timezone: 'Asia/Tokyo', generationId: 'past-auto-regression',
  }).state;
  const output = replanned.tasks.find((task) => task.id === pastAuto.id);
  check('未固定の自動タスクを保護時にtime固定へ昇格しない', output?.placementLock !== 'time', output);
  check('未固定の自動タスクはPAST_TIME衝突にならない', !replanned.lastScheduleResult?.conflicts.some((conflict) => conflict.taskId === pastAuto.id && conflict.code === 'PAST_TIME'), replanned.lastScheduleResult?.conflicts);
}
{
  const strict = mat('mat_exact_slot', { minutesPerUnit: 60, splittable: false, targetDate: D1 });
  const normal = manualTask('task_normal_30', { placementLock: 'none', estimatedMinutes: 30, dueDate: D1 });
  const result = generatePlanV2(baseState([strict], [{ start: '09:00', end: '10:00' }, { start: '11:00', end: '11:30' }], 90, { tasks: [normal] }), context());
  const strictTask = result.scheduledTasks.find((task) => task.materialId === strict.id);
  const normalTask = result.scheduledTasks.find((task) => task.id === normal.id);
  check('strictの実時刻区間を保持する', strictTask?.scheduledStart === '09:00' && strictTask.scheduledEnd === '10:00', result.scheduledTasks);
  check('通常タスクはstrict実区間を避ける', normalTask?.scheduledStart === '11:00' && normalTask.scheduledEnd === '11:30', result.scheduledTasks);
}
{
  const item: SolverItem = {
    id: 'exact-allocation', release: D1, deadline: D1, requiredUnits: 1, minutesPerUnit: 60,
    unitStep: 1, minChunkUnits: 1, maxChunkUnits: 1, splittable: false,
  };
  const solved = solveStrict([item], [{ date: D1, slots: [{ start: 540, end: 600 }], budget: 60 }], { maxNodes: 1000, maxMs: 1000, preferLate: true });
  const allocation = solved.allocations.get(item.id)?.[0];
  check('strictソルバーが正確なstart/endを返す', solved.status === 'feasible' && allocation?.start === 540 && allocation.end === 600, allocation);
}
{
  const strict = mat('mat_no_fake_reserve', { minutesPerUnit: 60, splittable: false, targetDate: D1 });
  const result = generatePlanV2(baseState([strict], [{ start: '09:00', end: '09:30' }, { start: '11:00', end: '11:30' }], 60), context());
  const report = result.deadlineReports.find((entry) => entry.workItemId === `material:${strict.id}`);
  check('分断30分+30分を連続60分の架空予約として保証しない', report?.feasible === false && report.scheduledMinutes === 0, report);
}
{
  const split = manualTask('task_split_amount', {
    amount: 6, estimatedMinutes: 180, dueDate: D3, placementLock: 'none',
    manualScheduling: {
      placementPolicy: 'flexibleBeforeDeadline', progressPolicy: { type: 'independent' },
      splittable: true, minimumChunkMinutes: 60, maximumChunkMinutes: 60,
    },
  });
  const result = generatePlanV2(baseState([], [{ start: '09:00', end: '10:00' }], 60, { tasks: [split] }), context());
  const chunks = result.scheduledTasks.filter((task) => task.sourceId === split.id).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  check('分割手動タスクのamountは各チャンクへ比例配分', chunks.length === 3 && chunks.every((task) => task.amount === 2), chunks);
  check('分割後amountの合計は元タスク全量と一致', chunks.reduce((sum, task) => sum + task.amount, 0) === 6, chunks);
}
{
  const legacy = manualTask('legacy_undefined_range', {});
  delete (legacy as Partial<StudyTask>).rangeStart;
  delete (legacy as Partial<StudyTask>).rangeEnd;
  const migrated = normalizeState({ ...emptyState(), tasks: [legacy] });
  check('旧JSONのundefined範囲からmaterialRangeを生成しない', migrated.tasks[0].materialRange === undefined, migrated.tasks[0]);
}

// ============================================================
console.log('--- 17. 完全探索比較(小規模ランダムケース) ---');
{
  // ソルバーと同じチャンク述語(isChunkAllowed)を使う、独立実装の総当たり判定器
  function bruteSolvable(items: SolverItem[], days: SolverDayInput[]): boolean | null {
    const slots = days.map((day) => day.slots.map((slot) => ({ ...slot })));
    const budgets = days.map((day) => day.budget);
    const states = items.map((item) => ({
      item,
      remaining: item.requiredUnits,
      perDayUnits: days.map(() => 0),
      perDayMinutes: days.map(() => 0),
      maxIdx: -1,
      tailIdx: Number.POSITIVE_INFINITY,
    }));
    let nodes = 0;
    let limit = false;
    const rec = (): boolean => {
      nodes += 1;
      if (nodes > 3_000_000) {
        limit = true;
        return false;
      }
      const state = states.find((item) => item.remaining > 0);
      if (!state) return true;
      const item = state.item;
      for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
        const date = days[dayIdx].date;
        if (date < item.release || date > item.deadline || dayIdx > state.tailIdx) continue;
        for (let slotIdx = 0; slotIdx < slots[dayIdx].length; slotIdx += 1) {
          for (let units = state.remaining; units >= 1; units -= 1) {
            const tailEligible = state.tailIdx === Number.POSITIVE_INFINITY && dayIdx >= state.maxIdx;
            if (!isChunkAllowed(item, units, state.remaining, tailEligible)) continue;
            const minutes = minutesForUnits(item.minutesPerUnit, units);
            const slot = slots[dayIdx][slotIdx];
            if (slot.end - slot.start < minutes || budgets[dayIdx] < minutes) continue;
            if (item.maxUnitsPerDay !== undefined && state.perDayUnits[dayIdx] + units > item.maxUnitsPerDay) continue;
            if (item.maxMinutesPerDay !== undefined && state.perDayMinutes[dayIdx] + minutes > item.maxMinutesPerDay) continue;
            const isTail = item.splittable && (units % Math.max(1, item.unitStep) !== 0 || units < item.minChunkUnits);
            slot.start += minutes;
            budgets[dayIdx] -= minutes;
            state.remaining -= units;
            state.perDayUnits[dayIdx] += units;
            state.perDayMinutes[dayIdx] += minutes;
            const prevMax = state.maxIdx;
            const prevTail = state.tailIdx;
            if (isTail) state.tailIdx = dayIdx;
            if (dayIdx > state.maxIdx) state.maxIdx = dayIdx;
            if (rec()) return true;
            slot.start -= minutes;
            budgets[dayIdx] += minutes;
            state.remaining += units;
            state.perDayUnits[dayIdx] -= units;
            state.perDayMinutes[dayIdx] -= minutes;
            state.maxIdx = prevMax;
            state.tailIdx = prevTail;
            if (limit) return false;
          }
        }
      }
      return false;
    };
    const solvable = rec();
    return limit && !solvable ? null : solvable;
  }

  let seed = 0xC0FFEE >>> 0;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const dates = [D1, D2, D3, D4];
  let mismatches = 0;
  let indeterminate = 0;
  let solvableCount = 0;
  const CASES = 500;
  for (let caseIdx = 0; caseIdx < CASES; caseIdx += 1) {
    const dayCount = 1 + rand(4);
    const days: SolverDayInput[] = [];
    for (let i = 0; i < dayCount; i += 1) {
      const slotCount = 1 + rand(2);
      const slots = [];
      let cursor = 9 * 60;
      for (let s = 0; s < slotCount; s += 1) {
        const len = 20 + rand(8) * 10; // 20〜90分
        slots.push({ start: cursor, end: cursor + len });
        cursor += len + 30;
      }
      const total = slots.reduce((sum, slot) => sum + slot.end - slot.start, 0);
      days.push({ date: dates[i], slots, budget: rand(3) === 0 ? Math.max(10, total - 20) : total });
    }
    const itemCount = 1 + rand(4);
    const items: SolverItem[] = [];
    for (let i = 0; i < itemCount; i += 1) {
      const releaseIdx = rand(dayCount);
      const deadlineIdx = releaseIdx + rand(dayCount - releaseIdx);
      const splittable = rand(10) < 7;
      const step = 1 + rand(2);
      const minChunk = 1 + rand(3);
      items.push({
        id: `item${i}`,
        release: dates[releaseIdx],
        deadline: dates[deadlineIdx],
        requiredUnits: 1 + rand(8),
        minutesPerUnit: 10,
        unitStep: step,
        minChunkUnits: minChunk,
        maxChunkUnits: minChunk + rand(5),
        splittable,
        maxUnitsPerDay: rand(4) === 0 ? 2 + rand(5) : undefined,
        maxMinutesPerDay: rand(5) === 0 ? 30 + rand(6) * 10 : undefined,
      });
    }
    const brute = bruteSolvable(items, days);
    if (brute === null) continue; // 総当たり側の上限到達はスキップ
    const solved = solveStrict(items, days, { maxNodes: 400_000, maxMs: 20_000, preferLate: true });
    if (solved.status === 'indeterminate') {
      indeterminate += 1; // 探索上限のindeterminateは許容
      continue;
    }
    if (brute) solvableCount += 1;
    if (brute && solved.status === 'infeasible') {
      mismatches += 1;
      if (mismatches <= 3) console.log('    総当たり=解あり / V2=infeasible', JSON.stringify({ items, days }));
    }
    if (!brute && solved.status === 'feasible') {
      mismatches += 1;
      if (mismatches <= 3) console.log('    総当たり=解なし / V2=feasible', JSON.stringify({ items, days }));
    }
  }
  check(`完全探索と${CASES}ケース一致(解あり${solvableCount}件, indeterminate ${indeterminate}件)`, mismatches === 0, { mismatches });
  check('比較ケースに解あり・解なしの両方が含まれる', solvableCount > 50 && solvableCount < CASES, solvableCount);
}

// ============================================================
console.log('--- 18. ランダムAppStateのプロパティテスト(10,000ケース) ---');
{
  let seed = 0x5EED5EED >>> 0;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const pick = <T,>(values: T[]): T => values[rand(values.length)];
  const windowSets: { start: string; end: string }[][] = [
    [{ start: '09:00', end: '11:00' }],
    [{ start: '09:00', end: '10:00' }, { start: '18:00', end: '20:00' }],
    [{ start: '18:00', end: '21:00' }],
    [],
  ];

  function randomMaterial(index: number): Material {
    const total = 2 + rand(10);
    const doneUnits = rand(3) === 0 ? rand(total) : 0;
    const step = pick([1, 1, 2]);
    const minChunk = rand(3) === 0 ? 1 + rand(3) : undefined;
    return mat(`m${index}`, {
      deadlinePolicy: pick(['strict', 'normal', 'flexible']),
      totalAmount: total,
      totalUnits: total,
      minutesPerUnit: pick([10, 15, 30]),
      unitStep: step,
      minimumChunkUnits: minChunk,
      maximumChunkUnits: minChunk !== undefined && rand(2) === 0 ? minChunk + 1 + rand(4) : undefined,
      splittable: rand(6) !== 0,
      maxUnitsPerDay: rand(5) === 0 ? 1 + rand(5) : undefined,
      maxMinutesPerDay: rand(6) === 0 ? 30 + rand(4) * 15 : undefined,
      startDate: pick([D1, D1, D2]),
      targetDate: pick([D1, D2, D3, D4, '2026-07-16']),
      completedRanges: doneUnits > 0 ? [{ start: 1, end: doneUnits }] : [],
      doneAmount: doneUnits,
    });
  }

  function randomTask(index: number): StudyTask {
    const kind = rand(5);
    const startMin = (9 + rand(10)) * 60 + rand(2) * 30;
    const est = 20 + rand(4) * 10;
    const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    if (kind === 0) {
      return manualTask(`t${index}`, {
        placementLock: 'time',
        scheduledDate: pick([D1, D2, D3]),
        scheduledStart: hm(startMin),
        scheduledEnd: hm(startMin + est),
        estimatedMinutes: est,
      });
    }
    if (kind === 1) {
      return manualTask(`t${index}`, { placementLock: 'date', scheduledDate: pick([D1, D2, D3]), estimatedMinutes: est });
    }
    if (kind === 2) {
      // 完了済み(未来日含む)
      return manualTask(`t${index}`, {
        status: 'done',
        completedAt: fixedNow.toISOString(),
        scheduledDate: pick([D1, D2, D3]),
        scheduledStart: hm(startMin),
        scheduledEnd: hm(startMin + est),
        estimatedMinutes: est,
        placementLock: pick(['time', 'none']),
      });
    }
    if (kind === 3) {
      return manualTask(`t${index}`, {
        placementLock: 'none',
        estimatedMinutes: est,
        manualScheduling: {
          placementPolicy: 'flexibleBeforeDeadline',
          deadline: pick([D2, D3, D4]),
          progressPolicy: { type: 'independent' },
          splittable: rand(2) === 0,
          minimumChunkMinutes: 10,
          maximumChunkMinutes: 60,
        },
      });
    }
    return manualTask(`t${index}`, { placementLock: 'none', estimatedMinutes: est, dueDate: pick([D2, D3]) });
  }

  function randomState(): AppState {
    const materials = Array.from({ length: rand(3) }, (_, index) => randomMaterial(index));
    const tasks = Array.from({ length: rand(3) }, (_, index) => randomTask(index));
    const empty = emptyState();
    return {
      ...empty,
      onboarded: true,
      subjects: [subject],
      materials,
      tasks,
      availability: ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => {
        const windows = pick(windowSets);
        return { weekday, minutes: windows.reduce((sum, w) => sum + (Number(w.end.slice(0, 2)) * 60 + Number(w.end.slice(3))) - (Number(w.start.slice(0, 2)) * 60 + Number(w.start.slice(3))), 0), windows };
      }),
      fixedEvents: rand(3) === 0 ? [{ id: 'ev', title: '予定', weekday: null, date: pick([D1, D2]), start: '09:30', end: '10:30' }] : [],
      settings: {
        ...empty.settings,
        maxDailyMinutes: pick([60, 120, 240]),
        sessionMinMinutes: pick([5, 25]),
        sessionMaxMinutes: 90,
        taskGenerationHorizonDays: 2 + rand(3),
      },
    };
  }

  const CASES = 10_000;
  let bad = 0;
  let invalidInputs = 0;
  const firstErrors: unknown[] = [];
  for (let caseIdx = 0; caseIdx < CASES; caseIdx += 1) {
    const state = randomState();
    const ctx = context({ generationId: `prop-${caseIdx}`, maxSearchNodes: 4000 });
    const result = generatePlanV2(state, ctx);
    const problems: string[] = [];
    // 同一入力で同一出力
    const again = generatePlanV2(state, ctx);
    if (JSON.stringify(result) !== JSON.stringify(again)) problems.push('非決定的な出力');
    if (result.warnings.some((warning) => warning.code === 'INTERNAL_VALIDATION_FAILURE')) problems.push('生成後検証に失敗');
    if (result.status === 'invalidInput') {
      invalidInputs += 1;
    } else {
      // 重複なし・固定予定重複なし・利用可能時間外なし・開始日前なし・厳守期限後なし・
      // 完了範囲重複なし・教材範囲重複なし・日別/教材別上限超過なし・チャンク違反なし・ID重複なし
      const issues = validateGeneratedScheduleV2(state, result, ctx);
      if (issues.length > 0) problems.push(`検証エラー: ${JSON.stringify(issues.slice(0, 2))}`);
      // 教材残量超過なし
      for (const material of state.materials) {
        const total = material.totalUnits ?? material.totalAmount;
        const claimed = result.scheduledTasks
          .filter((task) => task.materialId === material.id)
          .reduce((sum, task) => sum + task.amount, 0);
        if (claimed > total - material.doneAmount) problems.push(`教材${material.id}の残量超過: ${claimed}`);
      }
      // 分割不可教材は1タスク以下
      for (const material of state.materials.filter((item) => item.splittable === false)) {
        const count = result.scheduledTasks.filter((task) => task.materialId === material.id && task.sourceType === 'material').length;
        if (count > 1) problems.push(`分割不可教材${material.id}が${count}タスクに分割`);
      }
      const today = D1;
      for (const task of state.tasks) {
        // 時刻ロック: conflictか、同日・同時刻で配置されるか、のどちらか
        if (task.status === 'planned' && task.placementLock === 'time' && task.scheduledDate >= today) {
          const out = result.scheduledTasks.find((item) => item.id === task.id);
          const conflicted = result.conflicts.some((conflict) => conflict.taskId === task.id);
          if (!conflicted && out && (out.scheduledDate !== task.scheduledDate || out.scheduledStart !== task.scheduledStart)) {
            problems.push(`時刻ロック違反: ${task.id}`);
          }
          if (!conflicted && !out) problems.push(`時刻ロックタスク消失: ${task.id}`);
        }
        // 日付ロック: 配置されるなら同日
        if (task.status === 'planned' && task.placementLock === 'date' && task.scheduledDate >= today) {
          const outs = result.scheduledTasks.filter((item) => item.sourceId === task.id || item.id === task.id);
          if (outs.some((item) => item.scheduledDate !== task.scheduledDate)) problems.push(`日付ロック違反: ${task.id}`);
        }
        // 完了済みタスクは配置・衝突の対象にしない
        if (task.status === 'done') {
          if (result.scheduledTasks.some((item) => item.id === task.id)) problems.push(`完了済み${task.id}が再配置`);
          if (result.conflicts.some((conflict) => conflict.taskId === task.id)) problems.push(`完了済み${task.id}が衝突扱い`);
        }
      }
    }
    if (problems.length > 0) {
      bad += 1;
      if (firstErrors.length < 3) firstErrors.push({ caseIdx, problems, state: JSON.stringify(state).slice(0, 600) });
    }
  }
  check(`ランダム${CASES}ケースで全プロパティ成立(invalidInput ${invalidInputs}件は入力起因)`, bad === 0, firstErrors);
}

console.log('--- 復習・小数時間・将来手動タスクの回帰 ---');
{
  const reviewed = mat('reviewed', { totalAmount: 20, totalUnits: 20, doneAmount: 5, completedRanges: [{ start: 1, end: 5 }], reviewEnabled: true, deadlinePolicy: 'normal', targetDate: D4 });
  const review = manualTask('review-task', {
    materialId: reviewed.id, sourceType: 'review', sourceId: 'review-task', type: 'review', generatedBy: 'auto',
    rangeStart: 1, rangeEnd: 5, materialRange: { start: 1, end: 5 }, amount: 5, estimatedMinutes: 30,
    scheduledDate: D2, dueDate: D2, placementLock: 'none', manualScheduling: undefined,
  });
  const reviewState = baseState([reviewed], [{ start: '09:00', end: '12:00' }], 180, {
    tasks: [review], settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 7, reviewRule: { enabled: true, intervals: [1] } },
  });
  const reviewResult = generatePlanV2(reviewState, context());
  check('完了済み範囲を使う復習はinvalidInputにしない', reviewResult.status !== 'invalidInput', reviewResult.validationErrors);
  check('復習は予定日より前へ置かれない', reviewResult.scheduledTasks.filter((item) => item.type === 'review').every((item) => item.scheduledDate >= D2), reviewResult.scheduledTasks);

  const tiny = mat('tiny', { totalAmount: 1, totalUnits: 1, minutesPerUnit: 0.1, deadlinePolicy: 'normal', targetDate: D1 });
  const tinyResult = generatePlanV2(baseState([tiny], [{ start: '09:00', end: '10:00' }], 60), context());
  check('小数分教材でも0分タスクを生成しない', tinyResult.scheduledTasks.every((item) => item.estimatedMinutes >= 1), tinyResult.scheduledTasks);
}

console.log('--- 19. 負荷平準化・安全完了日・頻度目標 ---');
{
  const byDay = (tasks: StudyTask[]) => {
    const result = new Map<string, number>();
    for (const task of tasks) result.set(task.scheduledDate, (result.get(task.scheduledDate) ?? 0) + task.estimatedMinutes);
    return result;
  };
  // ケースA: 余裕のある通常教材は、初日の空きを全て前倒しに使わない。
  const normalA = mat('balanced-a', { deadlinePolicy: 'normal', targetDate: '2026-07-22', totalAmount: 24, totalUnits: 24, minutesPerUnit: 10 });
  const normalB = mat('balanced-b', { deadlinePolicy: 'normal', targetDate: '2026-07-22', totalAmount: 24, totalUnits: 24, minutesPerUnit: 10 });
  const resultA = generatePlanV2(baseState([normalA, normalB], [{ start: '09:00', end: '12:00' }], 180, {
    settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 14 },
  }), context({ generationId: 'balance-a' }));
  const loadA = byDay(resultA.scheduledTasks);
  check('通常教材は初日180分へ集中しない', (loadA.get(D1) ?? 0) < 100, Object.fromEntries(loadA));
  check('通常教材の最大日負荷は必要平均から大きく外れない', resultA.objectiveReport.maxDailyMinutes <= 100, resultA.objectiveReport);
  check('通常教材の安全予備を侵食しない', resultA.objectiveReport.safetyBufferViolationMinutes === 0, resultA.objectiveReport);

  // ケースB: strictの最遅解を実予定にせず、期限前の安全日まで分散する。
  const strict = mat('balanced-strict', { deadlinePolicy: 'strict', targetDate: '2026-07-19', totalAmount: 60, totalUnits: 60, minutesPerUnit: 10 });
  const resultB = generatePlanV2(baseState([strict], [{ start: '09:00', end: '12:00' }], 180, {
    settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 10 },
  }), context({ generationId: 'balance-b' }));
  const strictDates = resultB.scheduledTasks.filter((task) => task.materialId === strict.id).map((task) => task.scheduledDate);
  check('strictは期限直前だけへ集中しない', new Set(strictDates).size >= 5 && Math.max(...strictDates.map((date) => Number(date.slice(-2)))) <= 16, strictDates);
  check('strictは期限前の安全予備を残す', resultB.objectiveReport.safetyBufferViolationMinutes === 0, resultB.objectiveReport);
  check('strictは期限保証を維持する', resultB.deadlineReports.find((report) => report.workItemId === `material:${strict.id}`)?.feasible === true, resultB.deadlineReports);

  // ケースC: 週3回は週の前半一日に固めず、選んだ3日程度に分散する。
  const cadence = mat('cadence-3', {
    deadlinePolicy: 'normal', targetDate: '2026-08-09', totalAmount: 12, totalUnits: 12, minutesPerUnit: 10,
    preferredCadence: { type: 'timesPerWeek', count: 3 },
  });
  const resultC = generatePlanV2(baseState([cadence], [{ start: '09:00', end: '12:00' }], 180, {
    settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 31 },
  }), context({ generationId: 'balance-c' }));
  const cadenceDates = [...new Set(resultC.scheduledTasks.filter((task) => task.materialId === cadence.id).map((task) => task.scheduledDate))];
  check('週3回指定は1週へ過剰集中しない', cadenceDates.filter((date) => date >= '2026-07-13' && date <= '2026-07-19').length === 3, cadenceDates);
  check('週3回指定の超過は結果指標から分かる', resultC.objectiveReport.cadenceViolations === 0, resultC.objectiveReport);

  // 日次・週次目標は上限ではなく、余裕がある時の希望ペースとして使う。
  const dailyGoal = mat('daily-goal', {
    deadlinePolicy: 'normal', targetDate: '2026-07-19', totalAmount: 36, totalUnits: 36, minutesPerUnit: 10,
    dailyTarget: 6,
  });
  const resultDaily = generatePlanV2(baseState([dailyGoal], [{ start: '09:00', end: '12:00' }], 180, {
    settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 10 },
  }), context({ generationId: 'balance-daily-target' }));
  check('dailyTargetがある通常日は目標量へ近づく', resultDaily.objectiveReport.dailyTargetDeviation <= 30 && resultDaily.objectiveReport.maxDailyMinutes <= 90, resultDaily.objectiveReport);

  const weeklyGoal = mat('weekly-goal', {
    deadlinePolicy: 'normal', targetDate: '2026-08-09', totalAmount: 84, totalUnits: 84, minutesPerUnit: 10,
    weeklyTarget: 21,
  });
  const resultWeekly = generatePlanV2(baseState([weeklyGoal], [{ start: '09:00', end: '12:00' }], 180, {
    settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 31 },
  }), context({ generationId: 'balance-weekly-target' }));
  const weekMiddleMinutes = resultWeekly.scheduledTasks
    .filter((task) => task.materialId === weeklyGoal.id && task.scheduledDate >= '2026-07-13' && task.scheduledDate <= '2026-07-19')
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);
  check('weeklyTargetが週内で前半だけへ偏らない', weekMiddleMinutes >= 180 && weekMiddleMinutes <= 240, { weekMiddleMinutes, objective: resultWeekly.objectiveReport });
  check('期限上必要なら目標より期限を優先できる', resultWeekly.deadlineReports.find((report) => report.workItemId === `material:${weeklyGoal.id}`)?.feasible === true, resultWeekly.deadlineReports);

  // ケースD: 後半の固定予定で容量が消える時は、必要量だけ前半へ寄せて期限を守る。
  const constrained = mat('future-blocked', { deadlinePolicy: 'normal', targetDate: '2026-07-16', totalAmount: 60, totalUnits: 60, minutesPerUnit: 10 });
  const resultD = generatePlanV2(baseState([constrained], [{ start: '09:00', end: '12:00' }], 180, {
    fixedEvents: ['2026-07-12', '2026-07-13', '2026-07-14'].map((date) => ({ id: `block-${date}`, title: '固定', weekday: null, date, start: '09:00', end: '12:00' })),
    settings: { ...emptyState().settings, maxDailyMinutes: 180, sessionMinMinutes: 5, sessionMaxMinutes: 90, taskGenerationHorizonDays: 7 },
  }), context({ generationId: 'balance-d' }));
  const earlyMinutes = resultD.scheduledTasks.filter((task) => task.materialId === constrained.id && task.scheduledDate <= '2026-07-11').reduce((sum, task) => sum + task.estimatedMinutes, 0);
  check('後半固定予定を見越して必要量を前半へ置く', earlyMinutes >= 300, { earlyMinutes, tasks: resultD.scheduledTasks });
  check('後半固定予定でも通常期限を守る', resultD.deadlineReports.find((report) => report.workItemId === `material:${constrained.id}`)?.feasible === true, resultD.deadlineReports);
}

console.log(failures === 0 ? '\n🎉 ALL PASS (schedulerV2 spec)' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
