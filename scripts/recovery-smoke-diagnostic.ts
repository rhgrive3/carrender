import { buildDemoState } from '../src/data/demo';
import { addDays, today } from '../src/lib/date';
import { generateReviewTasks } from '../src/lib/review';
import { generatePlan } from '../src/lib/scheduler';
import type { StudyTask } from '../src/types';

const t = today();
const state = buildDemoState();
const todayTasks = state.tasks.filter((task) => task.scheduledDate === t && task.status === 'planned');
const doneTask = todayTasks.find((task) => task.type === 'new') ?? todayTasks[0];
if (!doneTask) throw new Error('NO_TODAY_TASK');
const reviewSeedTask = { ...doneTask, type: 'review' as const, reviewStage: 0, rangeLabel: `復習1回目 ${doneTask.rangeLabel}` };
const reviews = generateReviewTasks(state, reviewSeedTask, t);
if (!reviews[0]) throw new Error('NO_REVIEW_CREATED');
const plannedReview: StudyTask = {
  ...reviews[0],
  id: 'task_review_off_test',
  status: 'planned',
  scheduledDate: addDays(t, 1),
};
const withReview = { ...state, tasks: [...state.tasks, plannedReview] };
const input = {
  ...withReview,
  materials: withReview.materials.map((material) =>
    material.id === plannedReview.materialId ? { ...material, reviewEnabled: false } : material,
  ),
};
const output = generatePlan(input, t, '復習オフの反映');
console.log(JSON.stringify({
  today: t,
  status: output.state.lastScheduleResult?.status,
  validationErrors: output.state.lastScheduleResult?.validationErrors,
  warnings: output.state.lastScheduleResult?.warnings,
  unscheduled: output.state.lastScheduleResult?.unscheduledWork,
  reviewPresent: output.state.tasks.some((task) => task.id === plannedReview.id),
  overdueMaterials: input.materials
    .filter((material) => material.targetDate < t && material.doneAmount < material.totalAmount)
    .map((material) => ({ id: material.id, name: material.name, startDate: material.startDate, targetDate: material.targetDate, policy: material.deadlinePolicy })),
  overdueTasks: input.tasks
    .filter((task) => task.status === 'planned' && ((task.dueDate && task.dueDate < t) || (task.manualScheduling?.deadline && task.manualScheduling.deadline < t)))
    .map((task) => ({ id: task.id, type: task.type, materialId: task.materialId, scheduledDate: task.scheduledDate, dueDate: task.dueDate, deadline: task.manualScheduling?.deadline })),
}, null, 2));
