from pathlib import Path
import json
import subprocess

# Shared diagnostics types.
types = Path('src/types/index.ts')
text = types.read_text()
marker = "export interface UnscheduledWorkItem {\n  workItemId: string;\n  sourceId: string;\n  minutes: number;\n  reason: string;\n}\n"
assert marker in text
addition = marker + "\nexport type UnscheduledReasonCode = 'capacity' | 'cadence' | 'deadline' | 'fixedSlot' | 'solverLimit' | 'unknown';\n\nexport interface SchedulerCapRelaxationDiagnostic {\n  phase: 'strictDailyLoad';\n  attempt: number;\n  fromCap: number;\n  toCap: number;\n  trigger: 'infeasible' | 'indeterminate';\n  outcome: 'feasible' | 'infeasible' | 'indeterminate';\n  termination: 'relaxed' | 'nodeBudget' | 'timeBudget';\n}\n\nexport interface SchedulerDiagnostics {\n  capRelaxations: SchedulerCapRelaxationDiagnostic[];\n  inputGuards: Array<{ targetId: string; field: string; reason: string }>;\n  unscheduledReasons: Array<{ workItemId: string; code: UnscheduledReasonCode; detail: string }>;\n}\n"
text = text.replace(marker, addition, 1)
result_marker = "  objectiveReport: ObjectiveReport;\n  validationErrors?: ValidationIssue[];\n"
assert result_marker in text
text = text.replace(result_marker, "  objectiveReport: ObjectiveReport;\n  diagnostics?: SchedulerDiagnostics;\n  validationErrors?: ValidationIssue[];\n", 1)
types.write_text(text)

# Runtime-independent diagnostic helpers.
Path('src/lib/schedulerDiagnostics.ts').write_text("""import type { SchedulerDiagnostics, UnscheduledReasonCode, UnscheduledWorkItem, ValidationIssue } from '../types';

export function createSchedulerDiagnostics(errors: ValidationIssue[] = []): SchedulerDiagnostics {
  return {
    capRelaxations: [],
    inputGuards: errors.map((error) => ({ targetId: error.targetId, field: error.field, reason: error.reason })),
    unscheduledReasons: [],
  };
}

export function classifyUnscheduledReason(item: UnscheduledWorkItem): UnscheduledReasonCode {
  const detail = item.reason;
  if (/ソルバー|探索上限|判定でき/.test(detail)) return 'solverLimit';
  if (/指定日|固定|時刻|空き区間/.test(detail)) return 'fixedSlot';
  if (/頻度|cadence/.test(detail)) return 'cadence';
  if (/期限|期日|deadline/.test(detail)) return 'deadline';
  if (/容量|予算|空き時間|余剰/.test(detail)) return 'capacity';
  return 'unknown';
}

export function requirePositiveSchedulerValue(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`SCHEDULER_INVARIANT:${field}:${String(value)}`);
  }
  return value;
}
""")

scheduler = Path('src/lib/schedulerV2.ts')
text = scheduler.read_text()
text = text.replace("  SchedulerContext,\n", "  SchedulerContext,\n  SchedulerDiagnostics,\n", 1)
import_marker = "import { earliestDateMeetingCapacity, minimumFeasibleSteppedValue } from './capacitySearch';\n"
assert import_marker in text
text = text.replace(import_marker, import_marker + "import { classifyUnscheduledReason, createSchedulerDiagnostics, requirePositiveSchedulerValue } from './schedulerDiagnostics';\n", 1)
empty_marker = "    objectiveReport: { ...EMPTY_OBJECTIVE },\n    validationErrors: errors,\n"
assert empty_marker in text
text = text.replace(empty_marker, "    objectiveReport: { ...EMPTY_OBJECTIVE },\n    diagnostics: createSchedulerDiagnostics(errors),\n    validationErrors: errors,\n", 1)
warning_marker = "  const warnings: ScheduleWarning[] = [...fixed.warnings];\n"
assert warning_marker in text
text = text.replace(warning_marker, warning_marker + "  const diagnostics: SchedulerDiagnostics = createSchedulerDiagnostics();\n", 1)
old_relax = """      let balanced = runSolve(balancedItems, balancedDays, false);
      // 大きな分割不可チャンク等で均等な総日負荷上限だけが狭すぎる場合は、
      // 教材別の分散上限を維持したまま総日負荷だけを一度緩める。
      if (balanced.status !== 'feasible' && remainingNodes > 0 && Date.now() < searchDeadline) {
        balanced = runSolve(balancedItems, balancedDaysBase, false);
      }
"""
new_relax = """      let balanced = runSolve(balancedItems, balancedDays, false);
      // 大きな分割不可チャンク等で均等な総日負荷上限だけが狭すぎる場合は、
      // 教材別の分散上限を維持したまま総日負荷だけを一度緩める。
      if (balanced.status !== 'feasible') {
        const trigger = balanced.status;
        const canRelax = remainingNodes > 0 && Date.now() < searchDeadline;
        if (canRelax) balanced = runSolve(balancedItems, balancedDaysBase, false);
        diagnostics.capRelaxations.push({
          phase: 'strictDailyLoad',
          attempt: 1,
          fromCap: perDayTarget,
          toCap: maxAvailableBudget,
          trigger,
          outcome: canRelax ? balanced.status : trigger,
          termination: canRelax ? 'relaxed' : remainingNodes <= 0 ? 'nodeBudget' : 'timeBudget',
        });
      }
"""
assert old_relax in text
text = text.replace(old_relax, new_relax, 1)
text = text.replace("Math.max(totalWeighted, 0.0001)", "requirePositiveSchedulerValue(totalWeighted, 'totalWeighted')")
text = text.replace("Math.max(curve.material.minutesPerUnit, 0.0001)", "requirePositiveSchedulerValue(curve.material.minutesPerUnit, `material:${curve.material.id}.minutesPerUnit`)")
text = text.replace("Math.max(material.minutesPerUnit, 0.0001)", "requirePositiveSchedulerValue(material.minutesPerUnit, `material:${material.id}.minutesPerUnit`)")
result_marker = "  const result: ScheduleGenerationResult = {\n    status: fixed.conflicts.length > 0\n"
assert result_marker in text
text = text.replace(result_marker, "  diagnostics.unscheduledReasons = unscheduled.map((item) => ({\n    workItemId: item.workItemId,\n    code: classifyUnscheduledReason(item),\n    detail: item.reason,\n  }));\n  const result: ScheduleGenerationResult = {\n    status: fixed.conflicts.length > 0\n", 1)
objective_marker = "    objectiveReport,\n    generatedAt: context.now.toISOString(),\n"
assert objective_marker in text
text = text.replace(objective_marker, "    objectiveReport,\n    diagnostics,\n    generatedAt: context.now.toISOString(),\n", 1)
assert '0.0001' not in text
scheduler.write_text(text)

Path('scripts/scheduler-diagnostics.test.ts').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyUnscheduledReason, createSchedulerDiagnostics, requirePositiveSchedulerValue } from '../src/lib/schedulerDiagnostics';

assert.equal(classifyUnscheduledReason({ workItemId: 'a', sourceId: 'a', minutes: 10, reason: '指定日の空き時間が不足しています' }), 'fixedSlot');
assert.equal(classifyUnscheduledReason({ workItemId: 'b', sourceId: 'b', minutes: 10, reason: '具体計画期間内の余剰容量が不足しています' }), 'capacity');
assert.equal(classifyUnscheduledReason({ workItemId: 'c', sourceId: 'c', minutes: 10, reason: '期限までに配置できません' }), 'deadline');
assert.equal(classifyUnscheduledReason({ workItemId: 'd', sourceId: 'd', minutes: 10, reason: '指定頻度を満たせません' }), 'cadence');
assert.equal(classifyUnscheduledReason({ workItemId: 'e', sourceId: 'e', minutes: 10, reason: '探索上限により判定できません' }), 'solverLimit');
assert.throws(() => requirePositiveSchedulerValue(0, 'minutesPerUnit'), /SCHEDULER_INVARIANT/);
assert.throws(() => requirePositiveSchedulerValue(Number.NaN, 'minutesPerUnit'), /SCHEDULER_INVARIANT/);
assert.throws(() => requirePositiveSchedulerValue(Number.POSITIVE_INFINITY, 'minutesPerUnit'), /SCHEDULER_INVARIANT/);
assert.equal(requirePositiveSchedulerValue(0.1, 'minutesPerUnit'), 0.1);
const diagnostics = createSchedulerDiagnostics([{ targetId: 'm1', field: 'minutesPerUnit', value: 0, reason: '0より大きい有限値が必要です', suggestion: '正の値を入力してください' }]);
assert.deepEqual(diagnostics.inputGuards, [{ targetId: 'm1', field: 'minutesPerUnit', reason: '0より大きい有限値が必要です' }]);
const source = await readFile(new URL('../src/lib/schedulerV2.ts', import.meta.url), 'utf8');
assert.equal(source.includes('0.0001'), false, '不正入力を微小値へ置換する防御値を戻さない');
assert.match(source, /diagnostics\.capRelaxations\.push/);
assert.match(source, /termination: canRelax \? 'relaxed'/);
assert.match(source, /diagnostics\.unscheduledReasons = unscheduled\.map/);
console.log('✅ scheduler diagnostics contracts passed');
""")

package = Path('package.json')
data = json.loads(package.read_text())
command = 'vite-node scripts/scheduler-diagnostics.test.ts'
if command not in data['scripts']['test:scheduler']:
    data['scripts']['test:scheduler'] += ' && ' + command
package.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

# Restore the ordinary CI workflow before the final commit.
subprocess.run(['git', 'checkout', 'origin/main', '--', '.github/workflows/ci.yml'], check=True)
