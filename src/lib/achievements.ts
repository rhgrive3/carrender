import type { AppState, ISODate } from '../types';
import { diffDays, startOfWeek } from './date';

/**
 * 実績バッジ。すべて保存済みの実データから毎回計算する(獲得状態を別途保存しない)ため、
 * インポート/同期しても矛盾が起きない。
 */
export interface Achievement {
  id: string;
  icon: string;
  title: string;
  desc: string;
  unlocked: boolean;
  /** 未獲得バッジの進捗 0-1 */
  progress: number;
  progressLabel: string;
}

const HOUR_TIERS: { hours: number; icon: string; title: string }[] = [
  { hours: 10, icon: '⏱️', title: '累計10時間' },
  { hours: 50, icon: '📚', title: '累計50時間' },
  { hours: 100, icon: '🎓', title: '累計100時間' },
  { hours: 300, icon: '🏔️', title: '累計300時間' },
  { hours: 500, icon: '👑', title: '累計500時間' },
];

const STREAK_TIERS: { days: number; icon: string; title: string }[] = [
  { days: 3, icon: '🔥', title: '3日連続' },
  { days: 7, icon: '⚡', title: '1週間連続' },
  { days: 14, icon: '🌟', title: '2週間連続' },
  { days: 30, icon: '💎', title: '30日連続' },
  { days: 100, icon: '🏆', title: '100日連続' },
];

function jstHourOf(isoDatetime: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      hour12: false,
    }).format(new Date(isoDatetime));
    return Number(h) % 24;
  } catch {
    return 12;
  }
}

export function computeAchievements(state: AppState, ref: ISODate): Achievement[] {
  const sessions = state.sessions;

  const minutesByDate = new Map<ISODate, number>();
  for (const s of sessions) minutesByDate.set(s.date, (minutesByDate.get(s.date) ?? 0) + s.minutes);

  const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const totalHours = totalMinutes / 60;

  // 最長ストリーク
  let bestStreak = 0;
  {
    const dates = [...minutesByDate.keys()].sort();
    let cur = 0;
    let prev: ISODate | null = null;
    for (const d of dates) {
      if ((minutesByDate.get(d) ?? 0) <= 0) continue;
      cur = prev !== null && diffDays(prev, d) === 1 ? cur + 1 : 1;
      bestStreak = Math.max(bestStreak, cur);
      prev = d;
    }
  }

  const maxDayMinutes = Math.max(0, ...minutesByDate.values());
  const earlySessions = sessions.filter((s) => jstHourOf(s.startedAt) < 6).length;
  const timerSessions = sessions.filter((s) => s.source === 'timer').length;
  const reviewsDone = state.tasks.filter(
    (t) => (t.type === 'review' || t.type === 'correction') && t.status === 'done',
  ).length;
  const completedMaterials = state.materials.filter((m) => m.totalAmount > 0 && m.doneAmount >= m.totalAmount).length;

  // 週間目標をどこかの週(日〜土)で達成したか
  let weeklyGoalHit = false;
  if (state.settings.weeklyTargetMinutes > 0) {
    const byWeek = new Map<ISODate, number>();
    for (const [d, m] of minutesByDate) {
      const w = startOfWeek(d);
      byWeek.set(w, (byWeek.get(w) ?? 0) + m);
    }
    weeklyGoalHit = [...byWeek.values()].some((m) => m >= state.settings.weeklyTargetMinutes);
  }

  const pct = (v: number, goal: number) => Math.max(0, Math.min(1, goal > 0 ? v / goal : 0));

  const list: Achievement[] = [
    {
      id: 'first-session',
      icon: '🚀',
      title: 'はじめの一歩',
      desc: '最初の学習を記録する',
      unlocked: sessions.length >= 1,
      progress: pct(sessions.length, 1),
      progressLabel: `${Math.min(sessions.length, 1)}/1回`,
    },
    ...HOUR_TIERS.map((tier) => ({
      id: `hours-${tier.hours}`,
      icon: tier.icon,
      title: tier.title,
      desc: `合計${tier.hours}時間勉強する`,
      unlocked: totalHours >= tier.hours,
      progress: pct(totalHours, tier.hours),
      progressLabel: `${Math.floor(totalHours)}/${tier.hours}h`,
    })),
    ...STREAK_TIERS.map((tier) => ({
      id: `streak-${tier.days}`,
      icon: tier.icon,
      title: tier.title,
      desc: `${tier.days}日連続で勉強する`,
      unlocked: bestStreak >= tier.days,
      progress: pct(bestStreak, tier.days),
      progressLabel: `${Math.min(bestStreak, tier.days)}/${tier.days}日`,
    })),
    {
      id: 'day-5h',
      icon: '🦾',
      title: '鬼集中',
      desc: '1日に5時間勉強する',
      unlocked: maxDayMinutes >= 300,
      progress: pct(maxDayMinutes, 300),
      progressLabel: `最高${Math.floor(maxDayMinutes / 60)}h${maxDayMinutes % 60 > 0 ? String(maxDayMinutes % 60).padStart(2, '0') + 'm' : ''}/5h`,
    },
    {
      id: 'early-bird',
      icon: '🌅',
      title: '朝型エリート',
      desc: '朝6時前に勉強を始める',
      unlocked: earlySessions >= 1,
      progress: pct(earlySessions, 1),
      progressLabel: `${Math.min(earlySessions, 1)}/1回`,
    },
    {
      id: 'timer-50',
      icon: '🍅',
      title: 'タイマーの鬼',
      desc: 'タイマーで50回記録する',
      unlocked: timerSessions >= 50,
      progress: pct(timerSessions, 50),
      progressLabel: `${Math.min(timerSessions, 50)}/50回`,
    },
    {
      id: 'review-30',
      icon: '♻️',
      title: '忘却曲線ハンター',
      desc: '復習タスクを30件完了する',
      unlocked: reviewsDone >= 30,
      progress: pct(reviewsDone, 30),
      progressLabel: `${Math.min(reviewsDone, 30)}/30件`,
    },
    {
      id: 'material-1',
      icon: '📕',
      title: '1冊完走',
      desc: '教材を最後までやり切る',
      unlocked: completedMaterials >= 1,
      progress: pct(completedMaterials, 1),
      progressLabel: `${Math.min(completedMaterials, 1)}/1冊`,
    },
    {
      id: 'weekly-goal',
      icon: '🎯',
      title: '有言実行',
      desc: '週間目標時間を達成する(設定から目標を決めよう)',
      unlocked: weeklyGoalHit,
      progress: weeklyGoalHit ? 1 : 0,
      progressLabel: state.settings.weeklyTargetMinutes > 0 ? '挑戦中' : '目標未設定',
    },
  ];

  // refは将来「今日獲得したバッジ」演出に使う余地を残す(現状は未使用)
  void ref;
  return list;
}

export function unlockedCount(achievements: Achievement[]): number {
  return achievements.filter((a) => a.unlocked).length;
}
