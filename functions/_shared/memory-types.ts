export type MemoryEntityType =
  | 'item'
  | 'sense'
  | 'answer'
  | 'example'
  | 'exercise'
  | 'set'
  | 'set_member'
  | 'session'
  | 'stat_preference'
  | 'attempt_void';

export type MemoryMutationOperation = 'create' | 'update' | 'delete' | 'upsert';
export type MemoryMode = 'input' | 'output' | 'context' | 'composition';
export type MemoryTargetType = 'sense' | 'answer' | 'exercise';

export interface MemoryMutationInput {
  mutationId: string;
  clientId: string;
  entityType: MemoryEntityType;
  entityId: string;
  entityKey: string;
  operation: MemoryMutationOperation;
  baseRevision?: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryAttemptInput {
  attemptId: string;
  sessionId: string;
  clientId: string;
  itemId: string;
  senseId: string;
  answerId?: string;
  exerciseId?: string;
  targetId: string;
  mode: MemoryMode;
  exerciseType: string;
  userAnswer?: string;
  normalizedAnswer?: string;
  assessment: 'correct' | 'partial' | 'incorrect' | 'skipped';
  errorTypes: string[];
  hintUsed: boolean;
  responseMs: number;
  createdAt: string;
}

export interface MemorySyncInput {
  schemaVersion: 1;
  clientId: string;
  cursor: number;
  mutations: MemoryMutationInput[];
  attempts: MemoryAttemptInput[];
}

export interface MemoryConflictOutput {
  id: string;
  mutationId: string;
  entityType: MemoryEntityType;
  entityId: string;
  entityKey: string;
  localValue: unknown;
  serverValue: unknown;
  baseRevision?: number;
  createdAt: string;
}

export interface MemoryRemoteChanges {
  items?: unknown[];
  senses?: unknown[];
  answers?: unknown[];
  examples?: unknown[];
  exercises?: unknown[];
  sets?: unknown[];
  setMembers?: unknown[];
  stats?: unknown[];
  sessions?: unknown[];
  attempts?: unknown[];
}

export interface MemorySyncOutput {
  schemaVersion: 1;
  serverTime: string;
  cursor: string;
  acceptedMutationIds: string[];
  acceptedAttemptIds: string[];
  conflicts: MemoryConflictOutput[];
  changes: MemoryRemoteChanges;
  hasMore?: boolean;
}

export interface AffectedStatTarget {
  targetType: MemoryTargetType;
  targetId: string;
  modes: Set<MemoryMode>;
}
