function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function validTimeRange(value: unknown): boolean {
  return isRecord(value) && validTime(value.start) && validTime(value.end) && value.start < value.end;
}

function uniqueIds(name: string, values: unknown[]): string | null {
  const ids = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || !nonEmptyString(value.id)) return `${name} に空のidがあります`;
    if (ids.has(value.id)) return `${name} に重複idがあります`;
    ids.add(value.id);
  }
  return null;
}

/** completedRanges の重複・隣接を統合した実完了量。null は範囲自体が不正。 */
function completedRangeAmount(value: unknown, totalAmount: number): number | null {
  if (!Array.isArray(value)) return null;
  const ranges: { start: number; end: number }[] = [];
  for (const range of value) {
    if (!isRecord(range)
      || !Number.isInteger(range.start)
      || !Number.isInteger(range.end)
      || (range.start as number) < 1
      || (range.end as number) < (range.start as number)
      || (range.end as number) > totalAmount) return null;
    ranges.push({ start: range.start as number, end: range.end as number });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  let amount = 0;
  let current: { start: number; end: number } | null = null;
  for (const range of ranges) {
    if (!current) {
      current = { ...range };
      continue;
    }
    if (range.start <= current.end + 1) {
      current.end = Math.max(current.end, range.end);
      continue;
    }
    amount += current.end - current.start + 1;
    current = { ...range };
  }
  if (current) amount += current.end - current.start + 1;
  return amount;
}

export interface AppStateValidationResult {
  ok: boolean;
  error?: string;
}

export interface AppStateValidationOptions {
  /**
   * v5以前に保存済みの「教材期限 > 単一目標日」だけを読出し時に通す。
   * クライアントのv6移行が目標日を延長してから、次のPUTで正規化する。
   */
  allowLegacyGoalDateOverflow?: boolean;
}

/**
 * D1 must never become the first place malformed state is accepted. Older
 * valid schema versions may omit newer optional fields, but any supplied
 * values and all cross references must already be internally consistent.
 */
export function validateAppStatePayload(value: unknown, options: AppStateValidationOptions = {}): AppStateValidationResult {
  if (!isRecord(value)) return { ok: false, error: '学習データはオブジェクトである必要があります' };
  if (typeof value.onboarded !== 'boolean') return { ok: false, error: 'onboarded が不正です' };
  if (!isRecord(value.settings)) return { ok: false, error: 'settings が不正です' };

  const collectionNames = ['subjects', 'materials', 'tasks', 'sessions'] as const;
  for (const name of collectionNames) {
    if (!Array.isArray(value[name])) return { ok: false, error: `${name} が配列ではありません` };
    const idError = uniqueIds(name, value[name]);
    if (idError) return { ok: false, error: idError };
  }
  if (value.planHistory !== undefined && !Array.isArray(value.planHistory)) {
    return { ok: false, error: 'planHistory が配列ではありません' };
  }
  if (Array.isArray(value.planHistory)) {
    const idError = uniqueIds('planHistory', value.planHistory);
    if (idError) return { ok: false, error: idError };
  }

  const subjects = value.subjects as Record<string, unknown>[];
  const materials = value.materials as Record<string, unknown>[];
  const tasks = value.tasks as Record<string, unknown>[];
  const sessions = value.sessions as Record<string, unknown>[];
  const subjectIds = new Set(subjects.map((entry) => entry.id as string));
  const materialIds = new Set(materials.map((entry) => entry.id as string));

  for (const subject of subjects) {
    if (!nonEmptyString(subject.name)) return { ok: false, error: 'subjects に不正な名前があります' };
  }

  let examDate: string | null = null;
  if (value.goal !== null && value.goal !== undefined) {
    if (!isRecord(value.goal)
      || !nonEmptyString(value.goal.id)
      || !nonEmptyString(value.goal.name)
      || !validISODate(value.goal.examDate)) {
      return { ok: false, error: 'goal が不正です' };
    }
    examDate = value.goal.examDate;
  }

  for (const material of materials) {
    if (!subjectIds.has(String(material.subjectId))) return { ok: false, error: 'materials に存在しないsubjectIdがあります' };
    if (!nonEmptyString(material.name)) return { ok: false, error: 'materials に不正な名前があります' };
    if (!finiteNumber(material.totalAmount) || material.totalAmount <= 0) return { ok: false, error: 'materials のtotalAmountが不正です' };
    if (!finiteNumber(material.doneAmount) || material.doneAmount < 0 || material.doneAmount > material.totalAmount) {
      return { ok: false, error: 'materials のdoneAmountが不正です' };
    }
    if (material.minutesPerUnit !== undefined && (!finiteNumber(material.minutesPerUnit) || material.minutesPerUnit <= 0)) {
      return { ok: false, error: 'materials のminutesPerUnitが不正です' };
    }
    if (material.startDate !== undefined && !validISODate(material.startDate)) return { ok: false, error: 'materials のstartDateが不正です' };
    if (!validISODate(material.targetDate)) return { ok: false, error: 'materials のtargetDateが不正です' };
    if (typeof material.startDate === 'string' && material.startDate > material.targetDate) {
      return { ok: false, error: 'materials の開始日と目標完了日の順序が不正です' };
    }
    if (!options.allowLegacyGoalDateOverflow && examDate && material.archived !== true && material.targetDate > examDate) {
      return { ok: false, error: 'materials の目標完了日が試験日より後です' };
    }
    if (material.completedRanges !== undefined) {
      const rangeAmount = completedRangeAmount(material.completedRanges, material.totalAmount);
      if (rangeAmount === null) return { ok: false, error: 'materials のcompletedRangesが総量外です' };
      if (rangeAmount !== material.doneAmount) {
        return { ok: false, error: 'materials のdoneAmountとcompletedRangesが一致しません' };
      }
    }
  }

  for (const task of tasks) {
    if (!subjectIds.has(String(task.subjectId))) return { ok: false, error: 'tasks に存在しないsubjectIdがあります' };
    if ((task.status === 'planned' || task.status === 'doing')
      && task.materialId !== null && task.materialId !== undefined && !materialIds.has(String(task.materialId))) {
      return { ok: false, error: '未完了tasks に存在しないmaterialIdがあります' };
    }
    if (!nonEmptyString(task.title) || !validISODate(task.scheduledDate)) return { ok: false, error: 'tasks の基本項目が不正です' };
    if (!finiteNumber(task.estimatedMinutes) || task.estimatedMinutes <= 0) return { ok: false, error: 'tasks のestimatedMinutesが不正です' };
    if (task.amount !== undefined && (!finiteNumber(task.amount) || task.amount < 0)) return { ok: false, error: 'tasks のamountが不正です' };
    const hasStart = task.scheduledStart !== null && task.scheduledStart !== undefined;
    const hasEnd = task.scheduledEnd !== null && task.scheduledEnd !== undefined;
    if (hasStart !== hasEnd || (hasStart && (!validTime(task.scheduledStart) || !validTime(task.scheduledEnd) || task.scheduledStart >= task.scheduledEnd))) {
      return { ok: false, error: 'tasks の予定時刻が不正です' };
    }
  }

  for (const session of sessions) {
    if (!subjectIds.has(String(session.subjectId))) return { ok: false, error: 'sessions に存在しないsubjectIdがあります' };
    if (!validISODate(session.date) || !finiteNumber(session.minutes) || session.minutes <= 0) {
      return { ok: false, error: 'sessions の日付またはminutesが不正です' };
    }
    if (!finiteNumber(session.amountDone) || session.amountDone < 0) return { ok: false, error: 'sessions のamountDoneが不正です' };
  }

  if (Array.isArray(value.planHistory)) {
    for (const entry of value.planHistory) {
      const capturedAt = typeof entry.capturedAt === 'string' ? Date.parse(entry.capturedAt) : Number.NaN;
      const hasRangeStart = entry.rangeStart !== null && entry.rangeStart !== undefined;
      const hasRangeEnd = entry.rangeEnd !== null && entry.rangeEnd !== undefined;
      if (!isRecord(entry)
        || !nonEmptyString(entry.taskId)
        || !nonEmptyString(entry.title)
        || !subjectIds.has(String(entry.subjectId))
        || !validISODate(entry.scheduledDate)
        || !finiteNumber(entry.estimatedMinutes)
        || entry.estimatedMinutes <= 0
        || !finiteNumber(entry.amount)
        || entry.amount < 0
        || !Number.isFinite(capturedAt)
        || hasRangeStart !== hasRangeEnd
        || (hasRangeStart && (!finiteNumber(entry.rangeStart) || !finiteNumber(entry.rangeEnd) || entry.rangeStart < 1 || entry.rangeEnd < entry.rangeStart))
        || entry.outcome !== 'missed') {
        return { ok: false, error: 'planHistory に不正な項目があります' };
      }
      if (entry.materialRange !== undefined) {
        if (!isRecord(entry.materialRange)
          || !Number.isInteger(entry.materialRange.start)
          || !Number.isInteger(entry.materialRange.end)
          || (entry.materialRange.start as number) < 1
          || (entry.materialRange.end as number) < (entry.materialRange.start as number)) {
          return { ok: false, error: 'planHistory のmaterialRangeが不正です' };
        }
        const material = materials.find((candidate) => candidate.id === entry.materialId);
        if (material && (entry.materialRange.end as number) > (material.totalAmount as number)) {
          return { ok: false, error: 'planHistory のmaterialRangeが教材総量外です' };
        }
      }
    }
  }

  if (value.availability !== undefined) {
    if (!Array.isArray(value.availability)) return { ok: false, error: 'availability が不正です' };
    const weekdays = new Set<number>();
    for (const slot of value.availability) {
      if (!isRecord(slot) || !Number.isInteger(slot.weekday) || (slot.weekday as number) < 0 || (slot.weekday as number) > 6) {
        return { ok: false, error: 'availability の曜日が不正です' };
      }
      if (weekdays.has(slot.weekday as number)) return { ok: false, error: 'availability の曜日が重複しています' };
      weekdays.add(slot.weekday as number);
      if (!finiteNumber(slot.minutes) || slot.minutes < 0 || !Array.isArray(slot.windows) || !slot.windows.every(validTimeRange)) {
        return { ok: false, error: 'availability の時間帯が不正です' };
      }
    }
  }

  if (value.dayPlans !== undefined) {
    if (!Array.isArray(value.dayPlans)) return { ok: false, error: 'dayPlans が不正です' };
    const dates = new Set<string>();
    for (const plan of value.dayPlans) {
      if (!isRecord(plan) || !validISODate(plan.date)) return { ok: false, error: 'dayPlans の日付が不正です' };
      if (dates.has(plan.date)) return { ok: false, error: 'dayPlans の日付が重複しています' };
      dates.add(plan.date);
      if (plan.availabilityWindows !== null && plan.availabilityWindows !== undefined
        && (!Array.isArray(plan.availabilityWindows) || !plan.availabilityWindows.every(validTimeRange))) {
        return { ok: false, error: 'dayPlans の時間帯が不正です' };
      }
    }
  }

  if (value.fixedEvents !== undefined) {
    if (!Array.isArray(value.fixedEvents)) return { ok: false, error: 'fixedEvents が不正です' };
    const idError = uniqueIds('fixedEvents', value.fixedEvents);
    if (idError) return { ok: false, error: idError };
    for (const event of value.fixedEvents) {
      if (!isRecord(event) || !nonEmptyString(event.title) || !validTimeRange({ start: event.start, end: event.end })) {
        return { ok: false, error: 'fixedEvents の時間帯が不正です' };
      }
      const hasDate = event.date !== null && event.date !== undefined;
      const hasWeekday = event.weekday !== null && event.weekday !== undefined;
      const hasStartDate = event.startDate !== null && event.startDate !== undefined;
      const hasEndDate = event.endDate !== null && event.endDate !== undefined;
      if (hasDate && !validISODate(event.date)) return { ok: false, error: 'fixedEvents の日付が不正です' };
      if (hasWeekday && (!Number.isInteger(event.weekday) || (event.weekday as number) < 0 || (event.weekday as number) > 6)) {
        return { ok: false, error: 'fixedEvents の曜日が不正です' };
      }
      if (hasStartDate !== hasEndDate
        || (hasStartDate && (!validISODate(event.startDate) || !validISODate(event.endDate) || event.startDate > event.endDate))) {
        return { ok: false, error: 'fixedEvents の有効期間が不正です' };
      }
      if (!hasDate && !hasWeekday && !hasStartDate) return { ok: false, error: 'fixedEvents に対象日がありません' };
      if (hasDate && (hasWeekday || hasStartDate)) return { ok: false, error: 'fixedEvents の対象日指定が競合しています' };
    }
  }

  const settings = value.settings;
  if (settings.maxDailyMinutes !== undefined && (!finiteNumber(settings.maxDailyMinutes) || settings.maxDailyMinutes < 0)) {
    return { ok: false, error: 'settings.maxDailyMinutes が不正です' };
  }
  if (settings.sessionMinMinutes !== undefined && (!finiteNumber(settings.sessionMinMinutes) || settings.sessionMinMinutes < 5)) {
    return { ok: false, error: 'settings.sessionMinMinutes が不正です' };
  }
  if (settings.sessionMaxMinutes !== undefined && (!finiteNumber(settings.sessionMaxMinutes) || settings.sessionMaxMinutes < 5)) {
    return { ok: false, error: 'settings.sessionMaxMinutes が不正です' };
  }
  if (finiteNumber(settings.sessionMinMinutes) && finiteNumber(settings.sessionMaxMinutes)
    && settings.sessionMaxMinutes < settings.sessionMinMinutes) {
    return { ok: false, error: 'settings のセッション時間上限が下限未満です' };
  }
  if (settings.taskGenerationHorizonDays !== undefined
    && (!finiteNumber(settings.taskGenerationHorizonDays) || settings.taskGenerationHorizonDays < 1)) {
    return { ok: false, error: 'settings.taskGenerationHorizonDays が不正です' };
  }

  if (value.version !== undefined && (!Number.isInteger(value.version) || (value.version as number) < 1)) return { ok: false, error: 'version が不正です' };
  if (value.schemaVersion !== undefined && (!Number.isInteger(value.schemaVersion) || (value.schemaVersion as number) < 1)) return { ok: false, error: 'schemaVersion が不正です' };
  return { ok: true };
}
