export type MemoryItemKind =
  | 'word'
  | 'phrase'
  | 'expression'
  | 'construction'
  | 'composition';

export type MemoryMode = 'input' | 'output' | 'context' | 'composition';

export type VerificationStatus = 'verified' | 'unverified_ai';

export type ContentSource = 'user' | 'import' | 'ai';

export type Assessment = 'correct' | 'partial' | 'incorrect' | 'skipped';

export type ErrorType =
  | 'meaning'
  | 'recall'
  | 'spelling'
  | 'word_form'
  | 'article'
  | 'preposition'
  | 'word_order'
  | 'tense'
  | 'agreement'
  | 'register'
  | 'context'
  | 'other';

export type ExerciseType =
  | 'flashcard'
  | 'typed_output'
  | 'fill_blank'
  | 'reorder'
  | 'multiple_choice'
  | 'guided_composition'
  | 'free_composition';

export type MemoryTargetType = 'sense' | 'answer' | 'exercise';

interface RevisionedMemoryRecord {
  id: string;
  source: ContentSource;
  verificationStatus: VerificationStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
}

export interface MemoryItem extends RevisionedMemoryRecord {
  kind: MemoryItemKind;
  label: string;
  lemma?: string;
  tags: string[];
}

export interface MemorySense extends RevisionedMemoryRecord {
  itemId: string;
  promptJa: string;
  meaningJa: string;
  explanation?: string;
  siblingGroupId: string;
  tags: string[];
}

export interface MemoryAnswer extends RevisionedMemoryRecord {
  senseId: string;
  displayForm: string;
  citationForm: string;
  pattern?: string;
  acceptedVariants: string[];
  orthographicVariants: string[];
  register?: 'neutral' | 'formal' | 'informal' | 'literary';
  nuance?: string;
  note?: string;
}

export interface MemoryExample extends RevisionedMemoryRecord {
  senseId: string;
  answerId?: string;
  english: string;
  japanese?: string;
  note?: string;
}

export interface MemoryExercise extends RevisionedMemoryRecord {
  senseId: string;
  answerId?: string;
  type: ExerciseType;
  prompt: string;
  context?: string;
  acceptedAnswerIds: string[];
  requiredTokens?: string[];
  forbiddenTokens?: string[];
  explanation?: string;
  hint?: string;
  siblingGroupId: string;
}

export interface MemorySet {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
}

export interface MemorySetMember {
  setId: string;
  itemId: string;
  order: number;
  createdAt: string;
  deletedAt?: string;
}

export interface MemoryStat {
  id: string;
  targetType: MemoryTargetType;
  targetId: string;
  mode: MemoryMode;
  attempts: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  skippedCount: number;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
  averageResponseMs: number;
  hintCount: number;
  manualWeak: boolean;
  weaknessScore: number;
  /** Server-side optimistic-concurrency revision for synced preferences. */
  revision?: number;
  lastAttemptAt?: string;
  updatedAt: string;
}

export interface MemoryAttempt {
  attemptId: string;
  sessionId: string;
  clientId: string;
  itemId: string;
  senseId: string;
  answerId?: string;
  exerciseId?: string;
  targetId: string;
  mode: MemoryMode;
  exerciseType: ExerciseType;
  userAnswer?: string;
  normalizedAnswer?: string;
  assessment: Assessment;
  errorTypes: ErrorType[];
  hintUsed: boolean;
  responseMs: number;
  createdAt: string;
  syncedAt?: string;
}

export type MemoryQuestionCount =
  | { type: 'weak'; count: number }
  | { type: 'count'; count: number }
  | { type: 'all' }
  | { type: 'auto' };

export type MemoryStudyDirection = 'output' | 'input' | 'context' | 'mix';

export interface MemorySessionConfig {
  questionCount: MemoryQuestionCount;
  direction: MemoryStudyDirection;
  includeUnverifiedAi: boolean;
  preferredExerciseType?: ExerciseType;
  modeWeights?: Partial<Record<MemoryMode, number>>;
}

export interface MemorySession {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  selectedSetIds: string[];
  initialTargetIds: string[];
  config: MemorySessionConfig;
  seed: string;
  currentTargetId?: string;
  queueState: unknown;
  completedTargetIds: string[];
  needsReviewTargetIds: string[];
  answerCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface MemoryContentBundle {
  items: MemoryItem[];
  senses: MemorySense[];
  answers: MemoryAnswer[];
  examples: MemoryExample[];
  exercises: MemoryExercise[];
}

export interface MemorySetBundle extends MemoryContentBundle {
  sets: MemorySet[];
  setMembers: MemorySetMember[];
}

export interface LearningTarget {
  /** Stable identity made from mode + sense + optional answer/exercise. */
  id: string;
  mode: MemoryMode;
  itemId: string;
  senseId: string;
  answerId?: string;
  exerciseId?: string;
  exerciseType: ExerciseType;
  siblingGroupId: string;
  verificationStatus: VerificationStatus;
}

export interface MemoryUiState {
  activeSessionId?: string;
  selectedSetIds: string[];
  lastOpenedSetId?: string;
}

export const MEMORY_MODES: readonly MemoryMode[] = ['input', 'output', 'context', 'composition'];

export const DEFAULT_MIX_MODE_WEIGHTS: Readonly<Record<MemoryMode, number>> = {
  output: 0.5,
  input: 0.2,
  context: 0.2,
  composition: 0.1,
};

export const MASTERY_MODE_WEIGHTS: Readonly<Record<MemoryMode, number>> = {
  input: 0.2,
  output: 0.45,
  context: 0.25,
  composition: 0.1,
};
