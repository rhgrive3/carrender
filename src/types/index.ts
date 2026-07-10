// ---------- 基本単位 ----------
export type MaterialUnit = 'ページ' | '問題' | '講義' | '単語' | '年度' | 'セクション' | 'テーマ' | '題';

export type TaskType = 'new' | 'review' | 'mockReview' | 'pastExam';
export type TaskStatus = 'planned' | 'doing' | 'done' | 'skipped' | 'postponed';
export type GeneratedBy = 'auto' | 'manual';
export type DeadlinePolicy = 'strict' | 'normal' | 'flexible';
export type DayLoad = 'normal' | 'light' | 'heavy' | 'rest';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=日曜

/** ISO日付 "YYYY-MM-DD" */
export type ISODate = string;
export type LocalDate = string;
export type LocalTime = string;
export type TimeZoneId = string;

/** 時刻範囲 "HH:mm" */
export interface TimeRange {
  start: string;
  end: string;
}

export interface UnitRange {
  start: number;
  end: number;
}

export interface PreferredTimeWindow extends TimeRange {
  preference: number;
}

export type PreferredCadence =
  | { type: 'auto' }
  | { type: 'daily' }
  | { type: 'timesPerWeek'; count: number };

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
  /** V2の正規データ。doneAmountはこの範囲から導出する互換値。 */
  completedRanges?: UnitRange[];
  /** V2名。既存UI用のtotalAmountと同じ値。 */
  totalUnits?: number;
  startDate: ISODate;
  targetDate: ISODate; // 目標完了日
  preferredFinishDate?: ISODate;
  priority: 1 | 2 | 3 | 4 | 5;
  difficulty: 1 | 2 | 3 | 4 | 5;
  minutesPerUnit: number; // 1単位あたりの推定分
  unitStep?: number;
  minimumChunkUnits?: number;
  maximumChunkUnits?: number;
  splittable?: boolean;
  maxUnitsPerDay?: number;
  maxMinutesPerDay?: number;
  preferredCadence?: PreferredCadence;
  preferredTimeWindows?: PreferredTimeWindow[];
  estimateMode?: 'auto' | 'suggest' | 'fixed';
  estimatedMinutesPerUnit?: number;
  dailyTarget: number | null;
  weeklyTarget: number | null;
  deadlinePolicy: DeadlinePolicy;
  examRelevance: 1 | 2 | 3 | 4 | 5;
  reviewEnabled: boolean;
  reviewIntervals: number[];
  paused: boolean;
  round: number; // 1周目=1, 2周目=2...
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
  updatedAt?: string;
  completedAt: string | null;
  sourceType?: 'material' | 'review' | 'manual';
  sourceId?: string;
  placementStatus?: 'scheduled' | 'unscheduled' | 'conflict';
  placementLock?: 'none' | 'date' | 'time';
  materialRange?: UnitRange;
  manualScheduling?: ManualTaskScheduling;
}

export interface ManualTaskScheduling {
  placementPolicy: 'fixedTime' | 'fixedDateFlexibleTime' | 'flexibleBeforeDeadline';
  fixedDate?: LocalDate;
  fixedStartTime?: LocalTime;
  deadline?: LocalDate;
  progressPolicy:
    | { type: 'independent' }
    | { type: 'countTowardMaterial'; materialId: string; range?: UnitRange; amount?: number };
  splittable: boolean;
  minimumChunkMinutes?: number;
  maximumChunkMinutes?: number;
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
  focus: 1 | 2 | 3 | 4 | 5 | null;
  memo: string;
  source: 'timer' | 'manual';
  pausedMinutes?: number;
  excludedFromEstimate?: boolean;
}

export interface EstimateUpdateResult {
  previousEstimate: number;
  observedEstimate: number | null;
  suggestedEstimate: number | null;
  appliedEstimate: number;
  sampleCount: number;
  excludedCount: number;
  applied: boolean;
}

// ---------- スケジュール ----------
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
  startDate?: ISODate | null; // 毎週予定の有効開始日(nullなら無期限)
  endDate?: ISODate | null; // 毎週予定の有効終了日(nullなら無期限)
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
  enabled: boolean; // 復習タスクの自動生成そのもののオン/オフ(オフなら教材設定に関わらず生成しない)
  intervals: number[]; // 完了からの日数
}

// ---------- 分析 ----------
export interface SubjectStat {
  subjectId: string;
  plannedMinutes: number;
  actualMinutes: number;
  completionRate: number; // 0-1
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

// ---------- タイマー ----------
export type TimerMode = 'stopwatch' | 'pomodoro';

export interface PomodoroSettings {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesUntilLongBreak: number;
}

export interface TimerSettings {
  defaultMode: TimerMode;
  pomodoro: PomodoroSettings;
  sound: boolean;
  vibration: boolean;
  notification: boolean;
  keepScreenOn: boolean;
}

// ---------- 設定 ----------
export interface AppSettings {
  theme: 'auto' | 'dark' | 'light';
  maxDailyMinutes: number;
  sessionMinMinutes: number;
  sessionMaxMinutes: number;
  reviewRule: ReviewRule;
  /** 週間目標学習時間(分)。0なら未設定 */
  weeklyTargetMinutes: number;
  timer: TimerSettings;
  timezone?: TimeZoneId;
  taskGenerationHorizonDays?: number;
  estimateAlpha?: number;
}

export interface SchedulerContext {
  now: Date;
  timezone: TimeZoneId;
  generationId: string;
  maxSearchNodes?: number;
  maxSearchMilliseconds?: number;
}

export interface WorkItem {
  id: string;
  sourceType: 'material' | 'review' | 'manual';
  sourceId: string;
  releaseDate: LocalDate;
  hardDeadline?: LocalDate;
  preferredFinishDate?: LocalDate;
  requiredMinutes: number;
  minimumChunkMinutes: number;
  maximumChunkMinutes: number;
  splittable: boolean;
  maxMinutesPerDay?: number;
  priorityClass: 'strict' | 'baseline' | 'flexible';
  placementLock: 'none' | 'date' | 'time';
  unitMetadata?: {
    materialId: string;
    unitStep: number;
    minutesPerUnit: number;
    remainingRanges: UnitRange[];
  };
}

export type ScheduleGenerationStatus =
  | 'success'
  | 'partial'
  | 'infeasible'
  | 'indeterminate'
  | 'invalidInput'
  | 'conflict';

export interface ValidationIssue {
  targetId: string;
  field: string;
  value: unknown;
  reason: string;
  suggestion: string;
}

export interface UnscheduledWorkItem {
  workItemId: string;
  sourceId: string;
  minutes: number;
  reason: string;
}

/** 固定タスクが配置できない具体的理由 */
export type ConflictCode =
  | 'OUTSIDE_AVAILABILITY'
  | 'OVERLAPS_FIXED_EVENT'
  | 'OVERLAPS_LOCKED_TASK'
  | 'EXCEEDS_DAILY_BUDGET'
  | 'PAST_TIME'
  | 'INVALID_TIME_RANGE'
  | 'DURATION_MISMATCH'
  | 'OUTSIDE_HORIZON';

export interface ScheduleConflict {
  taskId: string;
  code: ConflictCode | string;
  message: string;
}

export interface ScheduleWarning {
  code: string;
  message: string;
  targetId?: string;
  minutes?: number;
}

export interface ProgressDeficit {
  materialId: string;
  units: number;
  minutes: number;
  calculatedForDate: LocalDate;
}

export interface SuggestedAction {
  type: 'increaseDailyMinutes' | 'addDayCapacity' | 'extendDeadline' | 'reduceMinimumChunk' | 'allowSplit' | 'pauseMaterial' | 'relaxDeadline' | 'raiseDailyLimit';
  label: string;
  value?: number;
}

export interface CapacityShortage {
  periodStart: LocalDate;
  periodEnd: LocalDate;
  requiredMinutes: number;
  availableMinutes: number;
  shortageMinutes: number;
  affectedWorkItemIds: string[];
  suggestedActions: SuggestedAction[];
}

export interface CapacityReport {
  horizonStart: LocalDate;
  horizonEnd: LocalDate;
  requiredMinutes: number;
  availableMinutes: number;
  shortages: CapacityShortage[];
}

export interface DeadlineReport {
  workItemId: string;
  policy: DeadlinePolicy;
  deadline?: LocalDate;
  feasible: boolean | null;
  scheduledMinutes: number;
  requiredMinutes: number;
  shortageMinutes: number;
  overdueDays: number;
}

export interface ObjectiveReport {
  strictDeadlineViolations: number;
  lockViolations: number;
  unscheduledStrictMinutes: number;
  progressDebtMinutes: number;
  normalOverdueMinutes: number;
  unscheduledMinutes: number;
  subjectImbalance: number;
  timePreferenceViolations: number;
  taskSwitches: number;
  /** 同一教材が同日内で連続したブロック数(旧保存データには存在しない) */
  sameMaterialStreak?: number;
}

export interface ScheduleGenerationResult {
  status: ScheduleGenerationStatus;
  scheduledTasks: StudyTask[];
  unscheduledWork: UnscheduledWorkItem[];
  conflicts: ScheduleConflict[];
  warnings: ScheduleWarning[];
  progressDeficits: ProgressDeficit[];
  capacityReport: CapacityReport;
  deadlineReports: DeadlineReport[];
  objectiveReport: ObjectiveReport;
  validationErrors?: ValidationIssue[];
  generatedAt: string;
  generationId: string;
}

// ---------- アプリ全体 ----------
export interface AppState {
  version: number;
  schemaVersion: number;
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
  lastPlannedDate: ISODate | null; // 最後に計画を生成したローカル日付
  lastScheduleResult?: ScheduleGenerationResult | null;
  lastPlanReason?: string | null;
}
