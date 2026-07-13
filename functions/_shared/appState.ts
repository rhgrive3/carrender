function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validSubject(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string';
}

function validMaterial(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.subjectId === 'string'
    && typeof value.name === 'string'
    && finiteNumber(value.totalAmount)
    && finiteNumber(value.doneAmount);
}

function validTask(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.subjectId === 'string'
    && typeof value.title === 'string'
    && typeof value.scheduledDate === 'string'
    && finiteNumber(value.estimatedMinutes);
}

function validSession(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.subjectId === 'string'
    && typeof value.date === 'string'
    && finiteNumber(value.minutes)
    && finiteNumber(value.amountDone);
}

export interface AppStateValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * D1 must never become the first place malformed state is accepted. This is a
 * structural boundary check, while detailed migration remains the client's
 * responsibility so older valid schema versions continue to load.
 */
export function validateAppStatePayload(value: unknown): AppStateValidationResult {
  if (!isRecord(value)) return { ok: false, error: '学習データはオブジェクトである必要があります' };
  if (typeof value.onboarded !== 'boolean') return { ok: false, error: 'onboarded が不正です' };
  if (!isRecord(value.settings)) return { ok: false, error: 'settings が不正です' };

  const collections: Array<[string, unknown, (entry: unknown) => boolean]> = [
    ['subjects', value.subjects, validSubject],
    ['materials', value.materials, validMaterial],
    ['tasks', value.tasks, validTask],
    ['sessions', value.sessions, validSession],
  ];
  for (const [name, collection, validate] of collections) {
    if (!Array.isArray(collection)) return { ok: false, error: `${name} が配列ではありません` };
    if (!collection.every(validate)) return { ok: false, error: `${name} に不正な項目があります` };
  }

  for (const name of ['availability', 'dayPlans', 'fixedEvents'] as const) {
    const collection = value[name];
    if (collection !== undefined && (!Array.isArray(collection) || !collection.every(isRecord))) {
      return { ok: false, error: `${name} が不正です` };
    }
  }
  if (value.goal !== null && value.goal !== undefined && !isRecord(value.goal)) {
    return { ok: false, error: 'goal が不正です' };
  }
  if (value.version !== undefined && !finiteNumber(value.version)) return { ok: false, error: 'version が不正です' };
  if (value.schemaVersion !== undefined && !finiteNumber(value.schemaVersion)) return { ok: false, error: 'schemaVersion が不正です' };
  return { ok: true };
}
