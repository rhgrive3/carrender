import type { AppState, Material, StudySession, StudyTask, Subject } from '../types';
import { addDays, genId, today } from '../lib/date';
import { generatePlan } from '../lib/scheduler';
import { defaultSettings, defaultAvailability } from './defaults';

/**
 * デモデータ生成。日付はすべて「今日」からの相対で作るので、
 * いつ起動しても「使い込まれた完成アプリ」に見える。
 */
export function buildDemoState(): AppState {
  const t = today();
  const examDate = addDays(t, 120);

  const subjects: Subject[] = [
    { id: 'subj_math', name: '数学', color: '#4f7cff', importance: 5, weakness: 4 },
    { id: 'subj_eng', name: '英語', color: '#00b894', importance: 5, weakness: 2 },
    { id: 'subj_phys', name: '物理', color: '#9a5cff', importance: 4, weakness: 3 },
    { id: 'subj_chem', name: '化学', color: '#ff7043', importance: 4, weakness: 2 },
    { id: 'subj_jpn', name: '国語', color: '#e84393', importance: 3, weakness: 3 },
    { id: 'subj_geo', name: '地理', color: '#00a8cc', importance: 2, weakness: 2 },
    { id: 'subj_info', name: '情報', color: '#fbc531', importance: 2, weakness: 1 },
  ];

  const createdAt = new Date(Date.now() - 30 * 86400000).toISOString();

  const mat = (
    id: string,
    subjectId: string,
    name: string,
    unit: Material['unit'],
    total: number,
    done: number,
    targetOffsetDays: number,
    priority: Material['priority'],
    difficulty: Material['difficulty'],
    minutesPerUnit: number,
  ): Material => ({
    id,
    subjectId,
    name,
    unit,
    totalAmount: total,
    doneAmount: done,
    startDate: addDays(t, -30),
    targetDate: addDays(t, targetOffsetDays),
    priority,
    difficulty,
    minutesPerUnit,
    dailyTarget: null,
    weeklyTarget: null,
    deadlinePolicy: targetOffsetDays <= 95 && priority >= 4 ? 'strict' : 'normal',
    examRelevance: priority,
    reviewEnabled: true,
    reviewIntervals: defaultSettings().reviewRule.intervals,
    paused: false,
    round: 1,
    archived: false,
    createdAt,
  });

  const materials: Material[] = [
    // 数学は少し遅れている設定 (30日経過で本来90問ペースのところ62問)
    mat('mat_chart', 'subj_math', '青チャート 例題', '問題', 300, 62, 90, 5, 4, 12),
    mat('mat_tango', 'subj_eng', '英単語ターゲット1900', '単語', 1900, 640, 100, 4, 2, 0.5),
    mat('mat_chobun', 'subj_eng', '英語長文ポラリス', '題', 40, 14, 80, 4, 3, 35),
    mat('mat_phys', 'subj_phys', '物理 重要問題集', '問題', 120, 30, 95, 4, 4, 18),
    mat('mat_chem', 'subj_chem', '化学 重要問題集', '問題', 150, 48, 95, 4, 3, 15),
    mat('mat_gendai', 'subj_jpn', '現代文アクセス', '題', 30, 11, 85, 3, 3, 40),
    mat('mat_geo', 'subj_geo', '共通テスト地理 総整理', 'テーマ', 60, 20, 100, 2, 2, 25),
    mat('mat_info', 'subj_info', '共通テスト情報I対策', 'テーマ', 40, 15, 105, 2, 2, 25),
  ];

  // ---------- 過去14日の実績セッション ----------
  const sessions: StudySession[] = [];
  const doneTasks: StudyTask[] = [];

  // 曜日で濃淡をつけたリアルな学習パターン(2日前は休んだ)
  // 数学(mat_chart)と国語(mat_gendai)は必要ペースに届かず「遅れ」、他は概ね順調になる量にしてある
  const pattern: { offset: number; entries: [string, number, number, 1 | 2 | 3 | 4 | 5][] }[] = [
    { offset: -13, entries: [['mat_chart', 60, 5, 3], ['mat_tango', 30, 60, 4]] },
    { offset: -12, entries: [['mat_phys', 55, 5, 3], ['mat_tango', 25, 55, 4], ['mat_chobun', 40, 1, 3]] },
    { offset: -11, entries: [['mat_chem', 50, 6, 4], ['mat_gendai', 45, 1, 3]] },
    { offset: -10, entries: [['mat_chart', 70, 6, 2], ['mat_geo', 30, 3, 4]] },
    { offset: -9, entries: [['mat_tango', 35, 65, 5], ['mat_chobun', 40, 1, 4], ['mat_info', 30, 2, 4]] },
    { offset: -8, entries: [['mat_phys', 60, 6, 3], ['mat_chem', 45, 5, 3]] },
    { offset: -7, entries: [['mat_chart', 55, 4, 3], ['mat_tango', 30, 60, 4], ['mat_gendai', 40, 1, 4]] },
    { offset: -6, entries: [['mat_chobun', 45, 2, 3], ['mat_geo', 25, 3, 4]] },
    { offset: -5, entries: [['mat_chem', 55, 6, 4], ['mat_tango', 25, 50, 4], ['mat_phys', 50, 5, 2]] },
    { offset: -4, entries: [['mat_chart', 65, 5, 3], ['mat_info', 30, 3, 5], ['mat_geo', 25, 3, 4]] },
    { offset: -3, entries: [['mat_tango', 30, 55, 4], ['mat_gendai', 45, 1, 3], ['mat_chobun', 40, 2, 4]] },
    // -2日は勉強できなかった(リアルさのため)
    { offset: -1, entries: [['mat_chart', 50, 4, 3], ['mat_tango', 25, 50, 4], ['mat_phys', 45, 5, 4]] },
  ];

  for (const dayPat of pattern) {
    const date = addDays(t, dayPat.offset);
    let hour = 19;
    for (const [materialId, minutes, amount, focus] of dayPat.entries) {
      const m = materials.find((x) => x.id === materialId);
      if (!m) continue;
      const startedAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
      hour += 1;
      const taskId = genId('task');
      sessions.push({
        id: genId('sess'),
        taskId,
        subjectId: m.subjectId,
        materialId,
        date,
        startedAt,
        minutes,
        amountDone: amount,
        rangeLabel: `${m.name}`,
        focus,
        memo: '',
        source: 'timer',
      });
      // 対応する完了済みタスク(達成率の計算用)
      doneTasks.push({
        id: taskId,
        subjectId: m.subjectId,
        materialId,
        title: m.name,
        rangeLabel: `${amount}${m.unit}`,
        rangeStart: null,
        rangeEnd: null,
        amount,
        estimatedMinutes: minutes,
        priority: 50,
        dueDate: null,
        type: 'new',
        status: 'done',
        scheduledDate: date,
        scheduledStart: null,
        scheduledEnd: null,
        generatedBy: 'auto',
        reviewStage: null,
        createdAt: startedAt,
        completedAt: startedAt,
      });
    }
  }

  // 未達成タスクを少し混ぜる(達成率がリアルになる)
  // ※generatePlanの後に追加する。先に入れると全体再計算に吸収されて消えるため。
  const missedTasks: StudyTask[] = [];
  const missed: [string, number, number][] = [
    ['mat_phys', -3, 50],
    ['mat_chart', -6, 60],
    ['mat_geo', -1, 30],
  ];
  for (const [materialId, offset, minutes] of missed) {
    const m = materials.find((x) => x.id === materialId);
    if (!m) continue;
    missedTasks.push({
      id: genId('task'),
      subjectId: m.subjectId,
      materialId,
      title: m.name,
      rangeLabel: '未着手分',
      rangeStart: null,
      rangeEnd: null,
      amount: Math.max(1, Math.round(minutes / m.minutesPerUnit)),
      estimatedMinutes: minutes,
      priority: 50,
      dueDate: null,
      type: 'new',
      status: 'planned',
      scheduledDate: addDays(t, offset),
      scheduledStart: null,
      scheduledEnd: null,
      generatedBy: 'auto',
      reviewStage: null,
      createdAt: createdAt,
      completedAt: null,
    });
  }

  // ---------- 復習タスク(期限が近いもの・過ぎたもの) ----------
  const reviewSeeds: [string, string, number, number][] = [
    // materialId, range, dueOffset, stage
    ['mat_chart', '例題45〜50', -1, 1],
    ['mat_phys', '力学 21〜24', 0, 0],
    ['mat_tango', '501〜550', 1, 2],
    ['mat_chem', '理論 31〜34', 2, 0],
  ];
  const reviewTasks: StudyTask[] = reviewSeeds.map(([materialId, range, dueOffset, stage]) => {
    const m = materials.find((x) => x.id === materialId)!;
    const due = addDays(t, dueOffset);
    return {
      id: genId('task'),
      subjectId: m.subjectId,
      materialId,
      title: m.name,
      rangeLabel: `復習${stage + 1}回目 ${range}`,
      rangeStart: null,
      rangeEnd: null,
      amount: 5,
      estimatedMinutes: 25,
      priority: 0,
      dueDate: due,
      type: 'review',
      status: 'planned',
      scheduledDate: due,
      scheduledStart: null,
      scheduledEnd: null,
      generatedBy: 'auto',
      reviewStage: stage,
      createdAt,
      completedAt: null,
    };
  });

  const base: AppState = {
    version: 2,
    isDemo: true,
    onboarded: true,
    goal: {
      id: genId('goal'),
      name: '大学受験 本番',
      examDate,
      createdAt,
    },
    subjects,
    materials,
    tasks: [...doneTasks, ...reviewTasks],
    sessions,
    availability: defaultAvailability(),
    dayPlans: [],
    fixedEvents: [
      { id: genId('ev'), title: '学校', weekday: 1, date: null, start: '08:00', end: '16:00' },
      { id: genId('ev'), title: '学校', weekday: 2, date: null, start: '08:00', end: '16:00' },
      { id: genId('ev'), title: '学校', weekday: 3, date: null, start: '08:00', end: '16:00' },
      { id: genId('ev'), title: '学校', weekday: 4, date: null, start: '08:00', end: '16:00' },
      { id: genId('ev'), title: '学校', weekday: 5, date: null, start: '08:00', end: '16:00' },
      { id: genId('ev'), title: '塾', weekday: 6, date: null, start: '13:00', end: '15:00' },
    ],
    settings: defaultSettings(),
    lastReschedule: null,
    lastPlannedDate: null,
  };

  // 今日以降の計画を自動生成して完成状態にする
  const { state } = generatePlan(base, t, '初期プラン作成');
  return { ...state, tasks: [...state.tasks, ...missedTasks], lastReschedule: null };
}
