// ---------- 基本単位 ----------
export type MaterialUnit = 'ページ' | '問題' | '講義' | '単語' | '年度' | 'セクション' | 'テーマ' | '題';

export type TaskType = 'new' | 'review' | 'correction' | 'mockReview' | 'pastExam';
export type TaskStatus = 'planned' | 'doing' | 'done' | 'skipped' | 'postponed';
export type GeneratedBy = 'auto' | 'manual';
export type MaterialPhase = 'first' | 'second' | 'correction' | 'review';
export type DeadlinePolicy = 'strict' | 'normal' | 'flexible';
export type DayLoad = 'normal' | 'light' | 'heavy' | 'rest';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=日曜

/** ISO日付 "YYYY-MM-DD" */
export type ISODate = string;

/** 時刻範囲 "HH:mm" */
export interface TimeRange {
  start: string;
  end: string;
}

// ---------- 目標 ----------
export interface UserGoal {
  id: string;
  name: string;
  examDate: ISODate;
  createdAt: string;
}

// ---------- 科目 ----------
export interface Subject {
  id: string;
  name: string;
  color: string; // HSLベースのキーカラー
  importance: 1 | 2 | 3 | 4 | 5; // 重要度
  weakness: 1 | 2 | 3 | 4 | 5; // 苦手度(5=最も苦手)
}

// ---------- 教材 ----------
export interface Material {
  id: string;
  subjectId: string;
  name: string;
  unit: MaterialUnit;
  totalAmount: number;
  doneAmount: number;
  startDate: ISODate;
  targetDate: ISODate; // 目標完了日
  priority: 1 | 2 | 3 | 4 | 5;
  difficulty: 1 | 2 | 3 | 4 | 5;
  minutesPerUnit: number; // 1単位あたりの推定分
  dailyTarget: number | null;
  weeklyTarget: number | null;
  phase: MaterialPhase;
  deadlinePolicy: DeadlinePolicy;
  examRelevance: 1 | 2 | 3 | 4 | 5;
  reviewEnabled: boolean;
  reviewIntervals: number[];
  paused: boolean;
  round: number; // 1周目=1, 2周目=2...
  lastStudiedAt: ISODate | null;
  nextReviewAt: ISODate | null;
  archived: boolean;
  createdAt: string;
}

// ---------- タスク ----------
export interface StudyTask {
  id: string;
  subjectId: string;
  materialId: string | null; // 手動タスクはnull許容
  title: string;
  rangeLabel: string; // 例: "例題 121〜130"
  rangeStart: number | null;
  rangeEnd: number | null;
  amount: number; // 単位数
  estimatedMinutes: number;
  priority: number; // 計算済みスコア
  dueDate: ISODate | null;
  type: TaskType;
  status: TaskStatus;
  scheduledDate: ISODate;
  scheduledStart: string | null; // "HH:mm"
  scheduledEnd: string | null;
  generatedBy: GeneratedBy;
  memo?: string;
  /** 復習タスクの段階(0=初回復習)。復習完了時に次の段階を自動生成する */
  reviewStage: number | null;
  createdAt: string;
  completedAt: string | null;
}

// ---------- 勉強セッション(記録) ----------
export interface StudySession {
  id: string;
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  date: ISODate;
  startedAt: string; // ISO datetime
  minutes: number;
  amountDone: number;
  rangeLabel: string;
  accuracy: number | null; // 0-100
  focus: 1 | 2 | 3 | 4 | 5 | null;
  difficulty: 1 | 2 | 3 | 4 | 5 | null;
  memo: string;
  source: 'timer' | 'manual';
}

// ---------- スケジュール ----------
export interface ScheduleBlock {
  taskId: string;
  date: ISODate;
  start: string; // "HH:mm"
  end: string;
}

export interface AvailabilitySlot {
  weekday: Weekday;
  minutes: number; // その曜日に勉強できる分数
  windows: TimeRange[]; // 実際に勉強できる時間帯
}

export interface FixedEvent {
  id: string;
  title: string;
  weekday: Weekday | null; // 繰り返し(毎週)ならweekday、単発ならdate
  date: ISODate | null;
  start: string; // "HH:mm"
  end: string;
}

export interface DayPlanOverride {
  date: ISODate;
  load: DayLoad;
  memo: string;
  availabilityWindows: TimeRange[] | null; // nullなら曜日テンプレートを使う
}

// ---------- 復習ルール ----------
export interface ReviewRule {
  intervals: number[]; // 完了からの日数
  lowAccuracyThreshold: number; // これ未満なら早める
  highAccuracyThreshold: number; // これ以上なら伸ばす
  correctionThreshold: number; // これ未満なら間違い直しタスク生成
}

// ---------- 分析 ----------
export interface SubjectStat {
  subjectId: string;
  plannedMinutes: number;
  actualMinutes: number;
  completionRate: number; // 0-1
  avgAccuracy: number | null;
}

export interface MaterialForecast {
  materialId: string;
  remainingAmount: number;
  remainingMinutes: number;
  requiredPacePerDay: number; // 目標完了日に間に合わせるための1日あたり単位数
  currentPacePerDay: number; // 直近14日の実績ペース
  projectedFinishDate: ISODate | null; // 現在ペースでの完了見込み
  status: 'ahead' | 'onTrack' | 'behind' | 'risk';
  delayDays: number; // 見込み-目標 (正=遅れ)
}

export interface CapacityWarning {
  totalRemainingMinutes: number;
  totalAvailableMinutes: number;
  deficitMinutes: number; // 正なら不足
  ok: boolean;
}

export interface AnalyticsSummary {
  streakDays: number;
  bestStreakDays: number;
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  planAchievementRate7d: number; // 0-1
  subjectStats: SubjectStat[];
  materialForecasts: MaterialForecast[];
  capacity: CapacityWarning;
  overdueReviewCount: number;
  heatmap: { date: ISODate; minutes: number }[]; // 直近12週
  comments: string[]; // 自動生成コメント
}

// ---------- 再スケジューリング結果 ----------
export interface RescheduleChange {
  kind: 'added' | 'moved' | 'postponed' | 'shrunk' | 'grown';
  taskTitle: string;
  subjectId: string;
  detail: string;
}

export interface RescheduleResult {
  at: string; // ISO datetime
  reason: string;
  changes: RescheduleChange[];
  subjectMinuteDelta: { subjectId: string; deltaMinutes: number }[];
  capacity: CapacityWarning;
  summaryText: string;
}

// ---------- 設定 ----------
export interface AppSettings {
  theme: 'auto' | 'dark' | 'light';
  maxDailyMinutes: number;
  sessionMinMinutes: number;
  sessionMaxMinutes: number;
  reviewRule: ReviewRule;
}

// ---------- アプリ全体 ----------
export interface AppState {
  version: number;
  isDemo: boolean;
  onboarded: boolean;
  goal: UserGoal | null;
  subjects: Subject[];
  materials: Material[];
  tasks: StudyTask[];
  sessions: StudySession[];
  availability: AvailabilitySlot[];
  dayPlans: DayPlanOverride[];
  fixedEvents: FixedEvent[];
  settings: AppSettings;
  lastReschedule: RescheduleResult | null;
  lastPlannedDate: ISODate | null; // どこまで計画生成済みか
}
