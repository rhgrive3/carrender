from pathlib import Path
import json
import subprocess

scheduler = Path('src/lib/schedulerV2.ts')
text = scheduler.read_text()

if '  SchedulerDiagnostics,\n' not in text:
    marker = "  SchedulerContext,\n"
    assert marker in text
    text = text.replace(marker, marker + "  SchedulerDiagnostics,\n", 1)

helper_import = "import { classifyUnscheduledReason, createSchedulerDiagnostics, requirePositiveSchedulerValue } from './schedulerDiagnostics';\n"
if helper_import not in text:
    marker = "import { earliestDateMeetingCapacity, minimumFeasibleSteppedValue } from './capacitySearch';\n"
    assert marker in text
    text = text.replace(marker, marker + helper_import, 1)

if '    diagnostics: createSchedulerDiagnostics(errors),\n' not in text:
    marker = "    objectiveReport: { ...EMPTY_OBJECTIVE },\n    validationErrors: errors,\n"
    assert marker in text
    text = text.replace(marker, "    objectiveReport: { ...EMPTY_OBJECTIVE },\n    diagnostics: createSchedulerDiagnostics(errors),\n    validationErrors: errors,\n", 1)

if '  const diagnostics: SchedulerDiagnostics = createSchedulerDiagnostics();\n' not in text:
    marker = "  const warnings: ScheduleWarning[] = [...fixed.warnings];\n"
    assert marker in text
    text = text.replace(marker, marker + "  const diagnostics: SchedulerDiagnostics = createSchedulerDiagnostics();\n", 1)

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
if 'diagnostics.capRelaxations.push({' not in text:
    assert old_relax in text
    text = text.replace(old_relax, new_relax, 1)

text = text.replace("Math.max(totalWeighted, 0.0001)", "requirePositiveSchedulerValue(totalWeighted, 'totalWeighted')")
text = text.replace("Math.max(curve.material.minutesPerUnit, 0.0001)", "requirePositiveSchedulerValue(curve.material.minutesPerUnit, `material:${curve.material.id}.minutesPerUnit`)")
text = text.replace("Math.max(material.minutesPerUnit, 0.0001)", "requirePositiveSchedulerValue(material.minutesPerUnit, `material:${material.id}.minutesPerUnit`)")

if '  diagnostics.unscheduledReasons = unscheduled.map((item) => ({\n' not in text:
    marker = "  const result: ScheduleGenerationResult = {\n    status: fixed.conflicts.length > 0\n"
    assert marker in text
    text = text.replace(marker, "  diagnostics.unscheduledReasons = unscheduled.map((item) => ({\n    workItemId: item.workItemId,\n    code: classifyUnscheduledReason(item),\n    detail: item.reason,\n  }));\n  const result: ScheduleGenerationResult = {\n    status: fixed.conflicts.length > 0\n", 1)

if '    diagnostics,\n    generatedAt: context.now.toISOString(),\n' not in text:
    marker = "    objectiveReport,\n    generatedAt: context.now.toISOString(),\n"
    assert marker in text
    text = text.replace(marker, "    objectiveReport,\n    diagnostics,\n    generatedAt: context.now.toISOString(),\n", 1)

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
assert.equal(source.includes('Math.max(totalWeighted, 0.0001)'), false);
assert.equal(source.includes('Math.max(curve.material.minutesPerUnit, 0.0001)'), false);
assert.equal(source.includes('Math.max(material.minutesPerUnit, 0.0001)'), false);
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

subprocess.run(['git', 'checkout', 'origin/main', '--', '.github/workflows/ci.yml'], check=True)
