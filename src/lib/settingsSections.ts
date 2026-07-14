import type { AppSettings, TimerSettings } from '../types';

export type StudySettingsDraft = Pick<AppSettings, 'maxDailyMinutes' | 'sessionMinMinutes' | 'sessionMaxMinutes' | 'taskGenerationHorizonDays'>;

export function studySettingsDraft(settings: AppSettings): StudySettingsDraft {
  return {
    maxDailyMinutes: settings.maxDailyMinutes,
    sessionMinMinutes: settings.sessionMinMinutes,
    sessionMaxMinutes: settings.sessionMaxMinutes,
    taskGenerationHorizonDays: settings.taskGenerationHorizonDays,
  };
}

export function mergeStudySettings(latest: AppSettings, draft: StudySettingsDraft): AppSettings {
  return { ...latest, ...draft };
}

export function mergeTimerSettings(latest: AppSettings, timer: TimerSettings): AppSettings {
  return { ...latest, timer };
}

export function mergeWeeklyTarget(latest: AppSettings, weeklyTargetMinutes: number): AppSettings {
  return { ...latest, weeklyTargetMinutes };
}

/** 未編集なら外部値へ追従し、編集中ならdraftと競合通知を保持する。 */
export function reconcileSectionDraft<T>(draft: T, latest: T, dirty: boolean): { draft: T; externalUpdate: boolean } {
  return dirty ? { draft, externalUpdate: JSON.stringify(draft) !== JSON.stringify(latest) } : { draft: latest, externalUpdate: false };
}
