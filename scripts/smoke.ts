/**
 * ロジック層のスモークテスト (UIなしで検証)
 * 実行: npx vite-node scripts/smoke.ts
 */
import { buildDemoState } from '../src/data/demo';
import { generatePlan, computeCapacity, computeDayStatus, availableMinutesOn, freeSlotsOn } from '../src/lib/scheduler';
import { generateReviewTasks } from '../src/lib/review';
import { computeAnalytics } from '../src/lib/analytics';
import { computeAchievements, unlockedCount } from '../src/lib/achievements';
import { addDays, today } from '../src/lib/date';
import type { StudySession } from '../src/types';

const t = today();
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

console.log('--- デモデータ生成 ---');
const state = buildDemoState();
check('目標がある', state.goal !== null);
check('科目7つ', state.subjects.length === 7);
check('教材8つ', state.materials.length === 8);
check('実績セッションあり', state.sessions.length > 20, state.sessions.length);

const todayTasks = state.tasks.filter((x) => x.scheduledDate === t && x.status === 'planned');
console.log(`今日のタスク: ${todayTasks.length}件`);
for (const task of todayTasks) {
  const s = state.subjects.find((x) => x.id === task.subjectId);
  console.log(`   [${s?.name}] ${task.title} ${task.rangeLabel} ${task.scheduledStart}〜${task.scheduledEnd} (${task.estimatedMinutes}分, type=${task.type})`);
}
check('今日のタスクが生成されている', todayTasks.length >= 2);

const cap = availableMinutesOn(state, t);
const planned = todayTasks.reduce((s, x) => s + x.estimatedMinutes, 0);
check(`今日の予定(${planned}分)が可能時間(${cap}分)以内`, planned <= cap);

// 固定予定と重ならないか
const slots = freeSlotsOn(state, t);
console.log('自由時間帯:', slots.map((s) => `${Math.floor(s.start / 60)}:${String(s.start % 60).padStart(2, '0')}-${Math.floor(s.end / 60)}:${String(s.end % 60).padStart(2, '0')}`).join(', '));
for (const task of todayTasks) {
  if (!task.scheduledStart || !task.scheduledEnd) continue;
  const [sh, sm] = task.scheduledStart.split(':').map(Number);
  const [eh, em] = task.scheduledEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const inSlot = slots.some((s) => start >= s.start && end <= s.end);
  check(`「${task.title}」(${task.scheduledStart}-${task.scheduledEnd})が固定予定と重ならない`, inSlot);
}

// 1コマ25〜90分
const outOfRange = state.tasks.filter(
  (x) => x.generatedBy === 'auto' && x.status === 'planned' && x.scheduledStart && (x.estimatedMinutes < 24 || x.estimatedMinutes > 90),
);
check('全自動タスクが25〜90分の範囲', outOfRange.length === 0, outOfRange.map((x) => `${x.title} ${x.estimatedMinutes}分`));

// 未達成タスクがデモに含まれる
const overdueDemo = state.tasks.filter((x) => x.status === 'planned' && x.scheduledDate < t);
check('デモに未達成タスクがある', overdueDemo.length >= 2, overdueDemo.length);

console.log('--- 週間タスク分布 ---');
for (let i = 0; i < 7; i++) {
  const d = addDays(t, i);
  const dayTasks = state.tasks.filter((x) => x.scheduledDate === d && x.status !== 'done');
  const min = dayTasks.reduce((s, x) => s + x.estimatedMinutes, 0);
  const subjects = new Set(dayTasks.map((x) => x.subjectId)).size;
  console.log(`  ${d}: ${dayTasks.length}件 ${min}分 (${subjects}科目) / 上限${availableMinutesOn(state, d)}分`);
}

console.log('--- キャパシティ ---');
const capacity = computeCapacity(state, t);
console.log(`  残り学習量 ${Math.round(capacity.totalRemainingMinutes / 60)}h / 確保可能 ${Math.round(capacity.totalAvailableMinutes / 60)}h / 不足 ${Math.round(capacity.deficitMinutes / 60)}h ok=${capacity.ok}`);
console.log(`  今日の状態: ${computeDayStatus(state, t)}`);

console.log('--- 再スケジューリング ---');
const { state: s2, result } = generatePlan(state, t, 'テスト再計算');
check('再計算が完了', s2.tasks.length > 0);
console.log(`  サマリー: ${result.summaryText}`);

console.log('--- 復習タスク生成 ---');
const doneTask = todayTasks[0];
const session: StudySession = {
  id: 'test', taskId: doneTask.id, subjectId: doneTask.subjectId, materialId: doneTask.materialId,
  date: t, startedAt: new Date().toISOString(), minutes: 30, amountDone: 5, rangeLabel: '',
  accuracy: 50, focus: 3, difficulty: 3, memo: '', source: 'timer',
};
const reviews = generateReviewTasks(state, doneTask, session, t);
check('正答率50% → 復習+間違い直しが生成される', reviews.length === 2, reviews.map((r) => r.rangeLabel));
for (const r of reviews) console.log(`   ${r.type}: ${r.rangeLabel} due=${r.dueDate}`);
const session2 = { ...session, accuracy: 95 };
const reviews2 = generateReviewTasks(state, doneTask, session2, t);
check('正答率95% → 復習のみ・間隔が伸びる', reviews2.length === 1 && reviews2[0].dueDate! > reviews[0].dueDate!, reviews2.map((r) => r.dueDate));

console.log('--- 分析 ---');
const a = computeAnalytics(state, t);
console.log(`  連続${a.streakDays}日(最高${a.bestStreakDays}日) 今週${Math.round(a.weekMinutes / 60)}h 達成率7d=${Math.round(a.planAchievementRate7d * 100)}%`);
check('ストリーク計算', a.streakDays >= 1);
check('教材予測が全教材分', a.materialForecasts.length === 8);
const mathForecast = a.materialForecasts.find((f) => f.materialId === 'mat_chart');
console.log(`  青チャート: status=${mathForecast?.status} 見込み=${mathForecast?.projectedFinishDate} 必要ペース=${mathForecast?.requiredPacePerDay}/日 実績ペース=${mathForecast?.currentPacePerDay}/日`);
check('数学(遅れ設定)がbehind/riskと判定される', mathForecast?.status === 'behind' || mathForecast?.status === 'risk', mathForecast?.status);
console.log('  コメント:');
for (const c of a.comments) console.log(`   ・${c}`);
check('分析コメントが生成される', a.comments.length >= 2);

console.log('--- 実績バッジ ---');
{
  const badges = computeAchievements(state, t);
  check('バッジが定義されている', badges.length >= 10, badges.length);
  const first = badges.find((b) => b.id === 'first-session');
  check('「はじめの一歩」が獲得済み(デモは実績あり)', first?.unlocked === true);
  check('全バッジのprogressが0-1', badges.every((b) => b.progress >= 0 && b.progress <= 1));
  console.log(`  獲得: ${unlockedCount(badges)}/${badges.length} → ${badges.filter((b) => b.unlocked).map((b) => b.title).join(', ')}`);
  const empty = computeAchievements({ ...state, sessions: [], tasks: [], materials: [] }, t);
  check('データなしでは獲得0', unlockedCount(empty) === 0, unlockedCount(empty));
}

console.log('--- 「今日は無理」 ---');
const impossibleTasks = state.tasks.map((x) => (x.scheduledDate === t && x.status === 'planned' ? { ...x, status: 'postponed' as const, scheduledDate: addDays(t, 1) } : x));
const { state: s3 } = generatePlan({ ...state, tasks: impossibleTasks }, addDays(t, 1), '今日は無理');
const tomorrowMin = s3.tasks.filter((x) => x.scheduledDate === addDays(t, 1) && x.status !== 'done' && x.status !== 'skipped').reduce((s, x) => s + x.estimatedMinutes, 0);
check(`明日が過積載にならない (${tomorrowMin}分 <= ${availableMinutesOn(s3, addDays(t, 1))}分)`, tomorrowMin <= availableMinutesOn(s3, addDays(t, 1)));

console.log('--- 記録後も今日の残りタスクが維持される ---');
{
  const first = todayTasks[0];
  const tasksAfterDone = state.tasks.map((x) =>
    x.id === first.id ? { ...x, status: 'done' as const, completedAt: new Date().toISOString() } : x,
  );
  const pendingBefore = tasksAfterDone.filter((x) => x.scheduledDate === t && x.status === 'planned').map((x) => x.id);
  const { state: s4 } = generatePlan({ ...state, tasks: tasksAfterDone }, addDays(t, 1), '学習実績の反映');
  const pendingAfter = s4.tasks.filter((x) => x.scheduledDate === t && x.status === 'planned').map((x) => x.id);
  check(
    `今日の未完了タスクが消えない (前${pendingBefore.length}件 → 後${pendingAfter.length}件)`,
    pendingBefore.every((id) => pendingAfter.includes(id)),
  );
  // 明日以降に同じ教材範囲が二重配置されていないか(教材ごとの総担当量が残量以下)
  for (const m of s4.materials) {
    const claimed = s4.tasks
      .filter((x) => x.materialId === m.id && x.type === 'new' && (x.status === 'planned' || x.status === 'doing'))
      .reduce((sum, x) => sum + x.amount, 0);
    const rem = Math.max(0, m.totalAmount - m.doneAmount);
    if (claimed > rem) check(`${m.name}: 配置量${claimed} > 残量${rem} (二重配置)`, false);
  }
  console.log('  ✅ 教材範囲の二重配置なし');
}

console.log(failures === 0 ? '\n🎉 ALL PASS' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
