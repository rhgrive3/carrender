import type { AppSettings, AvailabilitySlot, TimeRange, Weekday } from '../types';

export function defaultSettings(): AppSettings {
  return {
    theme: 'auto',
    maxDailyMinutes: 360,
    sessionMinMinutes: 25,
    sessionMaxMinutes: 90,
    reviewRule: {
      intervals: [1, 3, 7, 14, 30],
      lowAccuracyThreshold: 60,
      highAccuracyThreshold: 90,
      correctionThreshold: 60,
    },
  };
}

/** 平日2.5h、土日5h のデフォルト */
export function defaultAvailability(): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  for (let wd = 0 as Weekday; wd <= 6; wd = (wd + 1) as Weekday) {
    const isWeekend = wd === 0 || wd === 6;
    const windows: TimeRange[] = isWeekend
      ? [
          { start: '09:00', end: '12:00' },
          { start: '14:00', end: '16:00' },
        ]
      : [{ start: '18:00', end: '20:30' }];
    slots.push({ weekday: wd, minutes: isWeekend ? 300 : 150, windows });
  }
  return slots;
}

export const SUBJECT_COLOR_PALETTE = [
  '#4f7cff',
  '#00b894',
  '#9a5cff',
  '#ff7043',
  '#e84393',
  '#00a8cc',
  '#fbc531',
  '#6c5ce7',
  '#26de81',
  '#fd79a8',
];

export const SUBJECT_PRESETS = ['数学', '英語', '国語', '物理', '化学', '生物', '地学', '日本史', '世界史', '地理', '公民', '情報', 'その他'];

export const UNIT_OPTIONS = ['ページ', '問題', '講義', '単語', '年度', 'セクション', 'テーマ', '題'] as const;
