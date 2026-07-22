import assert from 'node:assert/strict';
import type { Material } from '../src/types';
import type { SolverDayInput, SolverItem, SlotAllocation } from '../src/lib/strictSolver';
import { solveStrict } from '../src/lib/strictSolver';
import { validateMaterialIntegrity } from '../src/lib/materialIntegrity';

const seedCount = Math.max(1, Math.min(5000, Number.parseInt(process.env.PROPERTY_SEEDS ?? '80', 10) || 80));
const baseSeed = Number.parseInt(process.env.PROPERTY_BASE_SEED ?? '20260722', 10) || 20260722;

function rngFor(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function integer(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function isoDay(index: number): string {
  return `2026-08-${String(index + 1).padStart(2, '0')}`;
}

function fingerprint(status: string, nodes: number, allocations: Map<string, SlotAllocation[]>): string {
  const normalized = [...allocations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, values]) => [id, [...values].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end)]);
  return JSON.stringify({ status, nodes, allocations: normalized });
}

function generatedCase(seed: number): { items: SolverItem[]; days: SolverDayInput[] } {
  const random = rngFor(seed);
  const dayCount = integer(random, 3, 8);
  const itemCount = integer(random, 1, 5);
  const days: SolverDayInput[] = Array.from({ length: dayCount }, (_, index) => {
    const start = integer(random, 7, 10) * 60;
    const available = integer(random, 360, 600);
    return {
      date: isoDay(index),
      slots: [{ start, end: start + available }],
      budget: available,
    };
  });

  const items: SolverItem[] = Array.from({ length: itemCount }, (_, index) => {
    const step = integer(random, 1, 3);
    const requiredUnits = integer(random, 1, 15);
    const minutesPerUnit = integer(random, 5, 30) / integer(random, 1, 3);
    return {
      id: `seed-${seed}-item-${index}`,
      release: days[integer(random, 0, Math.max(0, dayCount - 2))].date,
      deadline: days[dayCount - 1].date,
      requiredUnits,
      minutesPerUnit,
      unitStep: step,
      minChunkUnits: step,
      maxChunkUnits: Math.max(step, step * integer(random, 1, 4)),
      splittable: true,
      maxUnitsPerDay: integer(random, Math.max(step, 4), 30),
      maxMinutesPerDay: integer(random, 120, 600),
    };
  });

  return { items, days };
}

function verifyFeasible(seed: number, items: SolverItem[], days: SolverDayInput[], allocations: Map<string, SlotAllocation[]>): void {
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const allByDate = new Map<string, Array<SlotAllocation & { itemId: string }>>();

  for (const item of items) {
    const values = allocations.get(item.id) ?? [];
    assert.equal(values.reduce((sum, allocation) => sum + allocation.units, 0), item.requiredUnits, `seed=${seed}: ${item.id}の単位総量を保存する`);
    const perDayUnits = new Map<string, number>();
    const perDayMinutes = new Map<string, number>();
    for (const allocation of values) {
      assert.ok(allocation.units > 0 && Number.isFinite(allocation.units), `seed=${seed}: 単位数は正の有限値`);
      assert.ok(allocation.minutes > 0 && Number.isFinite(allocation.minutes), `seed=${seed}: 分数は正の有限値`);
      assert.ok(allocation.end > allocation.start, `seed=${seed}: 区間長は正`);
      assert.ok(allocation.date >= item.release && allocation.date <= item.deadline, `seed=${seed}: release/deadline内へ配置する`);
      const day = dayByDate.get(allocation.date);
      assert.ok(day, `seed=${seed}: 存在する日へ配置する`);
      assert.ok(day!.slots.some((slot) => allocation.start >= slot.start && allocation.end <= slot.end), `seed=${seed}: slot内へ配置する`);
      perDayUnits.set(allocation.date, (perDayUnits.get(allocation.date) ?? 0) + allocation.units);
      perDayMinutes.set(allocation.date, (perDayMinutes.get(allocation.date) ?? 0) + allocation.minutes);
      allByDate.set(allocation.date, [...(allByDate.get(allocation.date) ?? []), { ...allocation, itemId: item.id }]);
    }
    for (const units of perDayUnits.values()) assert.ok(units <= (item.maxUnitsPerDay ?? Number.POSITIVE_INFINITY), `seed=${seed}: 教材別日単位上限を守る`);
    for (const minutes of perDayMinutes.values()) assert.ok(minutes <= (item.maxMinutesPerDay ?? Number.POSITIVE_INFINITY), `seed=${seed}: 教材別日時間上限を守る`);
  }

  for (const [date, values] of allByDate) {
    const day = dayByDate.get(date)!;
    const ordered = [...values].sort((a, b) => a.start - b.start || a.end - b.end || a.itemId.localeCompare(b.itemId));
    for (let index = 1; index < ordered.length; index += 1) {
      assert.ok(ordered[index - 1].end <= ordered[index].start, `seed=${seed}: ${date}の配置を重ねない`);
    }
    assert.ok(values.reduce((sum, allocation) => sum + allocation.minutes, 0) <= day.budget, `seed=${seed}: ${date}の日別budgetを超えない`);
  }
}

for (let caseIndex = 0; caseIndex < seedCount; caseIndex += 1) {
  const seed = (baseSeed + Math.imul(caseIndex + 1, 0x9e3779b1)) >>> 0;
  const { items, days } = generatedCase(seed);
  const options = { maxNodes: 100_000, maxMs: 10_000, preferLate: caseIndex % 2 === 0 };
  const first = solveStrict(items, days, options);
  const second = solveStrict(items, days, options);
  assert.equal(
    fingerprint(first.status, first.nodes, first.allocations),
    fingerprint(second.status, second.nodes, second.allocations),
    `seed=${seed} case=${caseIndex}: 同じseedと入力で決定的な結果を返す`,
  );
  if (first.status === 'feasible') verifyFeasible(seed, items, days, first.allocations);
  else assert.notEqual(first.status, 'indeterminate', `seed=${seed}: 十分な探索budgetで上限終了しない`);
}

const validMaterial = {
  id: 'property-material', subjectId: 'subject', name: '教材', unit: '問', totalAmount: 100, totalUnits: 100,
  doneAmount: 10, completedRanges: [{ start: 1, end: 10 }], startDate: '2026-08-01', targetDate: '2026-09-01',
  priority: 3, difficulty: 3, minutesPerUnit: 2.5, unitStep: 1, minimumChunkUnits: 1, maximumChunkUnits: 10,
  splittable: true, preferredCadence: { type: 'auto' as const }, dailyTarget: null, weeklyTarget: null,
  deadlinePolicy: 'normal' as const, examRelevance: 3, reviewEnabled: true, reviewIntervals: [1, 3, 7], paused: false,
  round: 1, archived: false, createdAt: '2026-07-22T00:00:00.000Z',
} satisfies Material;

const invalidMaterials: Material[] = [
  { ...validMaterial, totalAmount: 10.5, totalUnits: 10.5 },
  { ...validMaterial, unitStep: Number.NaN },
  { ...validMaterial, minutesPerUnit: Number.POSITIVE_INFINITY },
  { ...validMaterial, completedRanges: [{ start: 1, end: 9 }] },
];
for (const [index, material] of invalidMaterials.entries()) {
  assert.ok(validateMaterialIntegrity(material).length > 0, `invalid-case=${index}: 不正教材を共有validatorが拒否する`);
}

console.log(`✅ strict solver property tests passed: seeds=${seedCount}, baseSeed=${baseSeed}`);
