import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlarmClock,
  BookOpen,
  CalendarCog,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FileDown,
  Palette,
  Pin,
  Plus,
  Repeat,
  SlidersHorizontal,
  Target,
  Timer,
  Trophy,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { prepareImportedState } from '../state/AppContextBase';
import { useAuth } from '../state/AuthContext';
import { Sheet } from '../components/ui/Sheet';
import { Segmented, Rating, NumericInput, Disclosure } from '../components/ui/bits';
import { useToast } from '../components/ui/Toast';
import { exportJSON, exportSessionsCSV, importJSON, saveStateNow } from '../lib/storage';
import { notificationSupported, requestNotificationPermission } from '../lib/notify';
import { formatDateShort, genId, hmToMinutes, minutesToHM, today, WEEKDAY_LABELS } from '../lib/date';
import type { DayLoad, DayPlanOverride, FixedEvent, Subject, TimeRange, TimerSettings, Weekday } from '../types';
import { mergeStudySettings, mergeTimerSettings, mergeWeeklyTarget, studySettingsDraft, type StudySettingsDraft } from '../lib/settingsSections';

const SYNC_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  syncing: { label: '同期中…', cls: 'status-accent' },
  synced: { label: 'クラウドに保存済み', cls: 'status-ok' },
  offline: { label: 'オフライン(端末に一時保存中)', cls: 'status-warn' },
  conflict: { label: '端末版とクラウド版が競合しています', cls: 'status-danger' },
  error: { label: '同期エラー(端末には保存済み)', cls: 'status-danger' },
};

type SettingsPage = 'home' | 'goals' | 'schedule' | 'timer' | 'subjects' | 'appearance' | 'data';

const SETTINGS_PAGES = new Set<SettingsPage>(['home', 'goals', 'schedule', 'timer', 'subjects', 'appearance', 'data']);

const readSettingsPage = (value: unknown): SettingsPage =>
  typeof value === 'string' && SETTINGS_PAGES.has(value as SettingsPage) ? value as SettingsPage : 'home';

type NewEventDraft = {
  title: string;
  mode: 'weekly' | 'date' | 'range';
  weekday: Weekday;
  date: string;
  startDate: string;
  endDate: string;
  start: string;
  end: string;
};

type DayExceptionDraft = {
  date: string;
  load: DayLoad;
  memo: string;
  useWindow: boolean;
  start: string;
  end: string;
};

const createNewEventDraft = (): NewEventDraft => ({
  title: '',
  mode: 'weekly',
  weekday: 1,
  date: today(),
  startDate: '',
  endDate: '',
  start: '08:00',
  end: '16:00',
});

const createDayExceptionDraft = (): DayExceptionDraft => ({
  date: today(),
  load: 'normal',
  memo: '',
  useWindow: false,
  start: '18:00',
  end: '20:00',
});

const SETTINGS_PAGE_COPY: Record<Exclude<SettingsPage, 'home'>, { title: string; subtitle: string }> = {
  goals: { title: '目標と学習方針', subtitle: 'ゴールと継続ペースを調整' },
  schedule: { title: '時間とスケジュール', subtitle: '勉強できる時間を計画へ反映' },
  timer: { title: 'タイマー', subtitle: '集中時間と通知をカスタマイズ' },
  subjects: { title: '科目', subtitle: '科目名・色・優先度を管理' },
  appearance: { title: '表示', subtitle: '端末に合わせてテーマを選択' },
  data: { title: 'アカウントとデータ', subtitle: '同期・バックアップ・ログアウト' },
};

export function SettingsSheet({ open, onClose, onDirtyChange }: { open: boolean; onClose: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { state, dispatch, execute, syncStatus, syncConflict, hasUnsyncedChanges, resolveSyncConflict, retrySync, syncErrorMessage } = useApp();
  const { user, logout, busy: authBusy } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const importReaderRef = useRef<FileReader | null>(null);
  const importGenerationRef = useRef(0);
  const importOwnerRef = useRef(user?.id ?? null);
  const importOpenRef = useRef(open);
  const [importBusy, setImportBusy] = useState(false);
  const ownerId = user?.id ?? null;
  importOwnerRef.current = ownerId;
  importOpenRef.current = open;
  const syncInfo = SYNC_STATUS_LABEL[syncStatus] ?? SYNC_STATUS_LABEL.synced;
  const [page, setPage] = useState<SettingsPage>('home');

  const [goalName, setGoalName] = useState(state.goal?.name ?? '');
  const [examDate, setExamDate] = useState(state.goal?.examDate ?? '');
  const [availability, setAvailability] = useState(state.availability);
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday>(1);
  const [events, setEvents] = useState(state.fixedEvents);
  const [studyDraft, setStudyDraft] = useState<StudySettingsDraft>(() => studySettingsDraft(state.settings));
  const [timerDraft, setTimerDraft] = useState<TimerSettings>(state.settings.timer);
  const [weeklyTargetDraft, setWeeklyTargetDraft] = useState(state.settings.weeklyTargetMinutes);
  const [dirtySections, setDirtySections] = useState<Set<'study' | 'timer' | 'weekly'>>(new Set());
  const [externalSections, setExternalSections] = useState<Set<'study' | 'timer' | 'weekly'>>(new Set());
  const [goalDirty, setGoalDirty] = useState(false);
  const [availabilityDirty, setAvailabilityDirty] = useState(false);
  const [newEventDirty, setNewEventDirty] = useState(false);
  const [dayExceptionDirty, setDayExceptionDirty] = useState(false);
  const [subjectDraftDirty, setSubjectDraftDirty] = useState(false);
  const [otherExternalUpdate, setOtherExternalUpdate] = useState(false);
  const wasOpen = useRef(false);
  const remoteSnapshot = useRef({ study: '', timer: '', weekly: '', goal: '', availability: '', events: '' });
  const [newEvent, setNewEvent] = useState<NewEventDraft>(createNewEventDraft);
  const [dayException, setDayException] = useState<DayExceptionDraft>(createDayExceptionDraft);

  useEffect(() => {
    importGenerationRef.current += 1;
    importReaderRef.current?.abort();
    importReaderRef.current = null;
    setImportBusy(false);
    return () => {
      importGenerationRef.current += 1;
      importReaderRef.current?.abort();
      importReaderRef.current = null;
    };
  }, [open, ownerId]);

  useEffect(() => {
    const signatures = {
      study: JSON.stringify(studySettingsDraft(state.settings)),
      timer: JSON.stringify(state.settings.timer),
      weekly: String(state.settings.weeklyTargetMinutes),
      goal: JSON.stringify(state.goal),
      availability: JSON.stringify(state.availability),
      events: JSON.stringify(state.fixedEvents),
    };
    if (open && !wasOpen.current) {
      setPage(readSettingsPage(window.history.state?.settingsPage));
      setGoalName(state.goal?.name ?? '');
      setExamDate(state.goal?.examDate ?? '');
      setAvailability(state.availability);
      setEvents(state.fixedEvents);
      setStudyDraft(studySettingsDraft(state.settings));
      setTimerDraft(state.settings.timer);
      setWeeklyTargetDraft(state.settings.weeklyTargetMinutes);
      setDirtySections(new Set());
      setExternalSections(new Set());
      setGoalDirty(false);
      setAvailabilityDirty(false);
      setNewEvent(createNewEventDraft());
      setDayException(createDayExceptionDraft());
      setNewEventDirty(false);
      setDayExceptionDirty(false);
      setSubjectDraftDirty(false);
      setOtherExternalUpdate(false);
    } else if (open) {
      const changed = (section: 'study' | 'timer' | 'weekly') => remoteSnapshot.current[section] && remoteSnapshot.current[section] !== signatures[section];
      if (changed('study')) dirtySections.has('study') ? setExternalSections((current) => new Set(current).add('study')) : setStudyDraft(studySettingsDraft(state.settings));
      if (changed('timer')) dirtySections.has('timer') ? setExternalSections((current) => new Set(current).add('timer')) : setTimerDraft(state.settings.timer);
      if (changed('weekly')) dirtySections.has('weekly') ? setExternalSections((current) => new Set(current).add('weekly')) : setWeeklyTargetDraft(state.settings.weeklyTargetMinutes);
      if (remoteSnapshot.current.goal && remoteSnapshot.current.goal !== signatures.goal) goalDirty ? setOtherExternalUpdate(true) : (setGoalName(state.goal?.name ?? ''), setExamDate(state.goal?.examDate ?? ''));
      if (remoteSnapshot.current.availability && remoteSnapshot.current.availability !== signatures.availability) availabilityDirty ? setOtherExternalUpdate(true) : setAvailability(state.availability);
      if (remoteSnapshot.current.events && remoteSnapshot.current.events !== signatures.events) setEvents(state.fixedEvents);
    }
    remoteSnapshot.current = signatures;
    wasOpen.current = open;
  }, [availabilityDirty, dirtySections, goalDirty, open, state.availability, state.fixedEvents, state.goal, state.settings]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const sheet = pageRef.current?.closest<HTMLElement>('.sheet');
      sheet?.scrollTo({ top: 0, behavior: 'auto' });
      if (page !== 'home') sheet?.querySelector<HTMLButtonElement>('.sheet-back')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, page]);

  useEffect(() => {
    if (!open) return;
    const onPopState = (event: PopStateEvent) => {
      if (event.state?.overlay !== 'settings') return;
      const nextPage = readSettingsPage(event.state?.settingsPage);
      if (page === 'subjects' && nextPage !== 'subjects' && subjectDraftDirty
        && !window.confirm('保存されていない科目の変更があります。変更を破棄して設定一覧へ戻りますか？')) {
        window.history.pushState(
          { ...(event.state ?? {}), overlay: 'settings', settingsPage: 'subjects', settingsDepth: 2 },
          '',
          window.location.href,
        );
        return;
      }
      setPage(nextPage);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [open, page, subjectDraftDirty]);

  const markDirty = (section: 'study' | 'timer' | 'weekly') => setDirtySections((current) => new Set(current).add(section));
  const updateNewEvent = (patch: Partial<NewEventDraft>) => {
    setNewEvent((current) => ({ ...current, ...patch }));
    setNewEventDirty(true);
  };
  const updateDayException = (patch: Partial<DayExceptionDraft>) => {
    setDayException((current) => ({ ...current, ...patch }));
    setDayExceptionDirty(true);
  };
  const loadDayException = (plan: DayPlanOverride) => {
    if (dayExceptionDirty && !window.confirm('保存されていない日別例外の変更があります。変更を破棄して別の日を編集しますか？')) return;
    const availabilityWindow = plan.availabilityWindows?.[0];
    setDayException({
      date: plan.date,
      load: plan.load,
      memo: plan.memo,
      useWindow: Boolean(plan.availabilityWindows),
      start: availabilityWindow?.start ?? '18:00',
      end: availabilityWindow?.end ?? '20:00',
    });
    setDayExceptionDirty(false);
  };
  const navigateToPage = (nextPage: SettingsPage) => {
    if (nextPage === page) return;
    window.history.pushState(
      { ...(window.history.state ?? {}), overlay: 'settings', settingsPage: nextPage, settingsDepth: 2 },
      '',
      window.location.href,
    );
    setPage(nextPage);
  };
  const clearSection = (section: 'study' | 'timer' | 'weekly') => {
    setDirtySections((current) => { const next = new Set(current); next.delete(section); return next; });
    setExternalSections((current) => { const next = new Set(current); next.delete(section); return next; });
  };

  const setTheme = (theme: 'auto' | 'dark' | 'light') => {
    execute({ type: 'UPDATE_SETTINGS', settings: { ...state.settings, theme } });
  };

  const saveGoal = () => {
    if (!state.goal || !goalName.trim() || !examDate) return;
    if (examDate < today()) {
      toast('試験日は今日以降を指定してください');
      return;
    }
    const outsideGoal = state.materials.filter((material) => !material.archived && material.targetDate > examDate);
    if (outsideGoal.length > 0) {
      const first = outsideGoal[0];
      toast(`「${first.name}」など${outsideGoal.length}件の目標完了日が試験日より後です。先に教材期限を修正してください`);
      return;
    }
    const result = execute({ type: 'UPDATE_GOAL', goal: { ...state.goal, name: goalName.trim(), examDate } });
    toast(result.message ?? '目標を更新しました');
    if (result.changed) { setGoalDirty(false); setOtherExternalUpdate(false); }
  };

  const saveAvailability = () => {
    const invalid = availability.some((slot) => slot.windows.some((window) => !window.start || !window.end || window.start >= window.end));
    if (invalid) {
      toast('開始時刻より後の終了時刻を指定してください');
      return;
    }
    const result = execute({ type: 'UPDATE_AVAILABILITY', availability });
    toast(result.message ?? '勉強可能時間を更新しました');
    if (result.changed) { setAvailabilityDirty(false); setOtherExternalUpdate(false); }
  };

  const saveStudySettings = () => {
    const result = execute({ type: 'UPDATE_SETTINGS', settings: mergeStudySettings(state.settings, studyDraft) });
    toast(result.message ?? '学習時間と計画設定を保存しました');
    if (result.changed) clearSection('study');
  };

  const saveTimerSettings = () => {
    const result = execute({ type: 'UPDATE_SETTINGS', settings: mergeTimerSettings(state.settings, timerDraft) });
    toast(result.message ?? 'タイマー設定を保存しました');
    if (result.changed) clearSection('timer');
  };

  const setTimerFlag = async (key: 'sound' | 'vibration' | 'notification' | 'keepScreenOn', value: boolean) => {
    if (key === 'notification' && value) {
      const ok = await requestNotificationPermission();
      if (!ok) {
        toast('通知が許可されていません。端末の設定を確認してください');
        return;
      }
    }
    const timer = { ...state.settings.timer, [key]: value };
    setTimerDraft((current) => ({ ...current, [key]: value }));
    execute({ type: 'UPDATE_SETTINGS', settings: { ...state.settings, timer } });
  };

  const setReviewAutoEnabled = (enabled: boolean) => {
    execute({ type: 'UPDATE_SETTINGS', settings: { ...state.settings, reviewRule: { ...state.settings.reviewRule, enabled } } });
    toast(enabled ? '復習の自動生成をオンにしました' : '復習の自動生成をオフにし、生成済みの復習タスクを計画から外しました');
  };

  const saveWeeklyGoal = () => {
    const result = execute({ type: 'UPDATE_SETTINGS', settings: mergeWeeklyTarget(state.settings, weeklyTargetDraft) });
    toast(result.message ?? (weeklyTargetDraft > 0 ? '週間目標を保存しました' : '週間目標を解除しました'));
    if (result.changed) clearSection('weekly');
  };

  const exportSyncConflict = () => {
    if (!syncConflict) return;
    const bundle = {
      exportedAt: new Date().toISOString(),
      localBaseUpdatedAt: syncConflict.localBaseUpdatedAt,
      cloudUpdatedAt: syncConflict.remoteUpdatedAt,
      localState: state,
      cloudState: syncConflict.remoteState,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `studycommander-sync-conflict-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('端末版とクラウド版を1つのJSONに保存しました');
  };

  const chooseSyncVersion = async (choice: 'local' | 'cloud') => {
    const label = choice === 'local' ? 'この端末版をクラウドへ保存' : 'クラウド版をこの端末へ読み込み';
    if (!window.confirm(`${label}しますか？ 反対側の版は復旧用バックアップへ退避します。`)) return;
    try {
      await resolveSyncConflict(choice);
      toast(choice === 'local' ? 'この端末版をクラウドへ保存しました' : 'クラウド版を読み込みました');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '競合を解決できませんでした');
    }
  };

  const doExportCSV = () => {
    const blob = new Blob([exportSessionsCSV(state)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studycommander-log-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('学習ログをCSVでエクスポートしました');
  };

  const addEvent = () => {
    if (!newEvent.title.trim() || newEvent.start >= newEvent.end) {
      toast('予定名と正しい時間帯を入力してください');
      return;
    }
    if (newEvent.mode === 'weekly' && newEvent.startDate && newEvent.endDate && newEvent.startDate > newEvent.endDate) {
      toast('固定予定の有効期間を正しく入力してください');
      return;
    }
    if (newEvent.mode === 'date' && !newEvent.date) {
      toast('固定予定の日付を指定してください');
      return;
    }
    if (newEvent.mode === 'range' && (!newEvent.startDate || !newEvent.endDate || newEvent.startDate > newEvent.endDate)) {
      toast('期間指定の開始日と終了日を正しく入力してください');
      return;
    }
    const ev: FixedEvent = {
      id: genId('ev'),
      title: newEvent.title.trim(),
      weekday: newEvent.mode === 'weekly' ? newEvent.weekday : null,
      date: newEvent.mode === 'date' ? newEvent.date : null,
      startDate: newEvent.mode === 'weekly' || newEvent.mode === 'range' ? newEvent.startDate || null : null,
      endDate: newEvent.mode === 'weekly' || newEvent.mode === 'range' ? newEvent.endDate || null : null,
      start: newEvent.start,
      end: newEvent.end,
    };
    const next = [...events, ev];
    setEvents(next);
    const result = execute({ type: 'UPDATE_FIXED_EVENTS', fixedEvents: next });
    setNewEvent({ ...newEvent, title: '' });
    setNewEventDirty(false);
    toast(result.message ?? '固定予定を追加しました');
  };

  const saveDayException = () => {
    if (dayException.useWindow && dayException.start >= dayException.end) {
      toast('例外時間帯を正しく入力してください');
      return;
    }
    const dayPlan: DayPlanOverride = {
      date: dayException.date,
      load: dayException.load,
      memo: dayException.memo,
      availabilityWindows: dayException.useWindow ? [{ start: dayException.start, end: dayException.end }] : null,
    };
    const result = execute({ type: 'UPDATE_DAY_PLAN', dayPlan });
    setDayExceptionDirty(false);
    toast(result.message ?? '日別例外を保存しました');
  };

  const updateAvailabilityWindows = (weekday: Weekday, windows: TimeRange[]) => {
    setAvailabilityDirty(true);
    const minutes = windows.reduce((sum, window) =>
      sum + (window.start && window.end && window.start < window.end ? hmToMinutes(window.end) - hmToMinutes(window.start) : 0), 0);
    // 入力途中の start >= end でも行自体を消さない。保存時にまとめて検証する。
    setAvailability((prev) => prev.map((slot) => (slot.weekday === weekday ? { ...slot, windows, minutes } : slot)));
  };

  const copyAvailabilityWindows = (sourceWeekday: Weekday, targets: readonly Weekday[]) => {
    const source = availability.find((slot) => slot.weekday === sourceWeekday);
    if (!source) return;
    setAvailabilityDirty(true);
    setAvailability((current) => current.map((slot) => targets.includes(slot.weekday)
      ? { ...slot, windows: source.windows.map((window) => ({ ...window })), minutes: source.minutes }
      : slot));
    toast(`${targets.length === 5 ? '平日' : '土日'}へ同じ時間帯をコピーしました。保存すると計画へ反映されます`);
  };

  const removeEvent = (id: string) => {
    const next = events.filter((e) => e.id !== id);
    setEvents(next);
    const result = execute({ type: 'UPDATE_FIXED_EVENTS', fixedEvents: next });
    toast(result.message ?? '固定予定を削除しました');
  };

  const eventLabel = (ev: FixedEvent) => {
    if (ev.weekday !== null) {
      const period =
        ev.startDate || ev.endDate
          ? ` (${ev.startDate ? formatDateShort(ev.startDate) : '開始未定'}〜${ev.endDate ? formatDateShort(ev.endDate) : '終了未定'})`
          : '';
      return `毎週${WEEKDAY_LABELS[ev.weekday]}${period}`;
    }
    if (ev.date) return formatDateShort(ev.date);
    if (ev.startDate || ev.endDate) {
      const start = ev.startDate ? formatDateShort(ev.startDate) : '開始未定';
      const end = ev.endDate ? formatDateShort(ev.endDate) : '終了未定';
      return `${start}〜${end}`;
    }
    return '';
  };

  const doExport = () => {
    const blob = new Blob([exportJSON(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studycommander-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('計画の変更履歴を除外したバックアップを書き出しました');
  };

  const doImport = (file: File) => {
    importReaderRef.current?.abort();
    const generation = importGenerationRef.current + 1;
    importGenerationRef.current = generation;
    const capturedOwnerId = ownerId;
    const reader = new FileReader();
    importReaderRef.current = reader;
    setImportBusy(true);

    const isCurrentImport = () => importGenerationRef.current === generation
      && importOwnerRef.current === capturedOwnerId
      && importOpenRef.current;
    const finishCurrentImport = () => {
      if (!isCurrentImport()) return;
      importReaderRef.current = null;
      setImportBusy(false);
    };

    reader.onload = () => {
      if (!isCurrentImport()) return;
      try {
        const imported = importJSON(String(reader.result));
        const appliedState = prepareImportedState(imported);
        if (!isCurrentImport()) return;
        dispatch({ type: 'REPLACE_STATE', state: appliedState });
        saveStateNow(appliedState);
        finishCurrentImport();
        toast('データをインポートしました');
        onClose();
      } catch {
        if (!isCurrentImport()) return;
        finishCurrentImport();
        toast('インポートに失敗しました。ファイルを確認してください');
      }
    };
    reader.onerror = () => {
      if (!isCurrentImport()) return;
      finishCurrentImport();
      toast('インポートに失敗しました。ファイルを読み込めませんでした');
    };
    reader.onabort = () => finishCurrentImport();
    reader.readAsText(file);
  };

  const doReset = () => {
    if (!window.confirm('学習計画・教材・学習記録を初期状態に戻しますか？暗記カードと暗記履歴は削除されません。この操作は取り消せません。')) return;
    dispatch({ type: 'RESET_ALL' });
    onClose();
  };

  const weekdaySummary = (() => {
    const fmt = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${min}分`);
    const weekday = availability.find((s) => s.weekday === 1)?.minutes ?? 0;
    const weekend = availability.find((s) => s.weekday === 0)?.minutes ?? 0;
    return `平日${fmt(weekday)} ・ 日曜${fmt(weekend)}`;
  })();

  const pageCopy = page === 'home' ? { title: '設定', subtitle: '学習環境を自分に合わせる' } : SETTINGS_PAGE_COPY[page];
  const selectedAvailability = availability.find((slot) => slot.weekday === selectedWeekday) ?? availability[0];
  const weeklySummary = state.settings.weeklyTargetMinutes > 0
    ? `週${Math.round((state.settings.weeklyTargetMinutes / 60) * 10) / 10}時間`
    : '目標時間なし';
  const hasUnsavedDraft = goalDirty || availabilityDirty || newEventDirty || dayExceptionDirty || subjectDraftDirty || dirtySections.size > 0;

  useEffect(() => {
    onDirtyChange?.(open && hasUnsavedDraft);
  }, [hasUnsavedDraft, onDirtyChange, open]);

  useEffect(() => {
    if (!open || !hasUnsavedDraft) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedDraft, open]);

  const returnToSettingsHome = () => {
    if (window.history.state?.overlay === 'settings' && Number(window.history.state?.settingsDepth) === 2) {
      window.history.back();
      return;
    }
    setPage('home');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onBack={page === 'home' ? undefined : returnToSettingsHome}
      backLabel="設定の一覧へ戻る"
      title={pageCopy.title}
      subtitle={pageCopy.subtitle}
      className="settings-sheet"
    >
      <div className="settings-page" data-settings-page={page} ref={pageRef}>
      {page === 'home' && (
        <>
          <button type="button" className="settings-account-summary" onClick={() => navigateToPage('data')}>
            <span className="settings-avatar" aria-hidden="true"><UserRound size={20} strokeWidth={2.1} /></span>
            <span className="settings-account-copy">
              <strong>{user?.username ?? '-'}</strong>
              <span className={`settings-sync-state ${syncInfo.cls}`}>
                <Cloud size={13} strokeWidth={2.2} aria-hidden="true" /> {syncInfo.label}
              </span>
            </span>
            <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>

          {(syncStatus === 'offline' || syncStatus === 'error' || syncConflict) && (
            <button type="button" className="settings-attention" onClick={() => navigateToPage('data')}>
              <span>{syncConflict ? '同期するデータを選ぶ必要があります' : '同期状態を確認してください'}</span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}

          {hasUnsavedDraft && (
            <button
              type="button"
              className="settings-unsaved-note"
              onClick={() => navigateToPage(subjectDraftDirty ? 'subjects' : availabilityDirty || newEventDirty || dayExceptionDirty || dirtySections.has('study') ? 'schedule' : dirtySections.has('timer') ? 'timer' : 'goals')}
            >
              <span><strong>未保存の変更があります</strong><small>編集した項目を確認して保存してください</small></span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}

          {state.isDemo && (
            <div className="settings-demo-note">
              <strong>デモデータを表示中</strong>
              <span>本番利用を始める時は「アカウントとデータ」から初期化できます。</span>
            </div>
          )}

          <section className="settings-group" aria-labelledby="settings-group-study">
            <h3 id="settings-group-study">学習設定</h3>
            <div className="settings-destination-list">
              <SettingsDestination
                icon={<Target size={18} />}
                iconColor="var(--danger)"
                title="目標と学習方針"
                description="試験日・週間目標・復習"
                value={weeklySummary}
                onClick={() => navigateToPage('goals')}
              />
              <SettingsDestination
                icon={<AlarmClock size={18} />}
                iconColor="var(--accent)"
                title="時間とスケジュール"
                description="曜日・固定予定・日別の例外"
                value={weekdaySummary}
                onClick={() => navigateToPage('schedule')}
              />
              <SettingsDestination
                icon={<Timer size={18} />}
                iconColor="var(--accent-2)"
                title="タイマー"
                description="ポモドーロ・通知・消灯防止"
                value={state.settings.timer.defaultMode === 'pomodoro' ? `${state.settings.timer.pomodoro.workMinutes}分集中` : 'ストップウォッチ'}
                onClick={() => navigateToPage('timer')}
              />
              <SettingsDestination
                icon={<BookOpen size={18} />}
                iconColor="var(--ok)"
                title="科目"
                description="名前・色・優先度を編集"
                value={`${state.subjects.length}科目`}
                onClick={() => navigateToPage('subjects')}
              />
            </div>
          </section>

          <section className="settings-group" aria-labelledby="settings-group-app">
            <h3 id="settings-group-app">アプリ</h3>
            <div className="settings-destination-list">
              <SettingsDestination
                icon={<Palette size={18} />}
                iconColor="var(--warn)"
                title="表示"
                description="ライト・ダーク・端末に合わせる"
                value={state.settings.theme === 'auto' ? '自動' : state.settings.theme === 'dark' ? 'ダーク' : 'ライト'}
                onClick={() => navigateToPage('appearance')}
              />
              <SettingsDestination
                icon={<Database size={18} />}
                iconColor="var(--text-sub)"
                title="アカウントとデータ"
                description="同期・バックアップ・ログアウト"
                value={syncStatus === 'synced' ? '保存済み' : '確認が必要'}
                onClick={() => navigateToPage('data')}
              />
            </div>
          </section>

          <p className="settings-version">StudyCommander v1.0</p>
        </>
      )}

      {page === 'data' && (
      <>
      {/* アカウント */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row spread">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{user?.username ?? '-'}</div>
            <span className={`status-badge ${syncInfo.cls}`} style={{ marginTop: 6 }}>
              {syncInfo.label}
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={authBusy}
            onClick={() => {
              if (hasUnsyncedChanges && !window.confirm('未同期の端末データがあります。ログアウトすると端末キャッシュは消えます。JSONを書き出すか同期してからのログアウトを推奨します。続けますか？')) return;
              void logout();
              onClose();
            }}
          >
            ログアウト
          </button>
        </div>
        {(syncStatus === 'offline' || syncStatus === 'error') && !syncConflict && (
          <>
            {syncErrorMessage && <p className="muted mt-8" role="alert">{syncErrorMessage}</p>}
            <button type="button" className="btn btn-ghost btn-sm mt-8" onClick={retrySync}>同期を再試行</button>
          </>
        )}
        {syncConflict && (
          <div className="card status-danger mt-12" role="alert" style={{ padding: 12 }}>
            <b>両方に未統合の変更があります</b>
            <p className="muted mt-8" style={{ lineHeight: 1.6 }}>自動では上書きしません。まず両方をJSONで保存し、残す版を選んでください。</p>
            <button type="button" className="btn btn-secondary btn-sm btn-block mt-8" onClick={exportSyncConflict}>
              <Download size={14} aria-hidden="true" /> 両方をJSONで保存
            </button>
            <div className="row mt-8" style={{ alignItems: 'stretch' }}>
              <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => void chooseSyncVersion('local')}>この端末版を残す</button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => void chooseSyncVersion('cloud')}>クラウド版を残す</button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {page !== 'home' && (externalSections.size > 0 || otherExternalUpdate) && (
        <div className="card status-warn" role="status" style={{ padding: 12, marginBottom: 14 }}>
          別の更新があります。編集中の入力は保持しています。保存すると、このセクションの入力項目だけを最新設定へ反映します。
        </div>
      )}

      {/* テーマ */}
      {page === 'appearance' && (
      <section className="settings-form-card" aria-labelledby="appearance-title">
        <div className="settings-form-heading">
          <span className="settings-form-icon" style={{ color: 'var(--warn)' }} aria-hidden="true"><Palette size={18} /></span>
          <div><h3 id="appearance-title">カラーテーマ</h3><p>端末の外観設定に合わせることもできます。</p></div>
        </div>
      <div className="field">
        <label>テーマ</label>
        <Segmented
          ariaLabel="テーマ"
          options={[
            { value: 'auto', label: '自動' },
            { value: 'dark', label: 'ダーク' },
            { value: 'light', label: 'ライト' },
          ]}
          value={state.settings.theme}
          onChange={setTheme}
        />
      </div>
      </section>
      )}

      {/* 目標 */}
      {page === 'goals' && state.goal && (
        <Disclosure defaultOpen title="目標と試験日" icon={<Target size={16} strokeWidth={2.2} />} iconColor="var(--danger)" summary={`${state.goal.name} ・ ${formatDateShort(state.goal.examDate)}`}>
          <div className="field">
            <label htmlFor="st-goal">目標名</label>
            <input id="st-goal" value={goalName} onChange={(e) => { setGoalDirty(true); setGoalName(e.target.value); }} />
          </div>
          <div className="field">
            <label htmlFor="st-exam">試験日</label>
            <input id="st-exam" type="date" value={examDate} onChange={(e) => { setGoalDirty(true); setExamDate(e.target.value); }} />
          </div>
          <button className="btn btn-secondary btn-sm btn-block" onClick={saveGoal}>
            目標を保存して再計算
          </button>
        </Disclosure>
      )}

      {/* 勉強できる時間 */}
      {page === 'schedule' && (
      <Disclosure defaultOpen title="勉強できる時間" icon={<AlarmClock size={16} strokeWidth={2.2} />} iconColor="var(--accent)" summary={weekdaySummary}>
      <div className="availability-week-strip" role="radiogroup" aria-label="編集する曜日">
        {availability.map((slot) => (
          <button
            key={slot.weekday}
            type="button"
            role="radio"
            aria-checked={selectedWeekday === slot.weekday}
            className={selectedWeekday === slot.weekday ? 'active' : ''}
            onClick={() => setSelectedWeekday(slot.weekday)}
          >
            <span>{WEEKDAY_LABELS[slot.weekday]}</span>
            <small>{slot.minutes > 0 ? `${Math.round((slot.minutes / 60) * 10) / 10}h` : '休'}</small>
          </button>
        ))}
      </div>
      {selectedAvailability && (
        <div className="card availability-card availability-editor">
          <div className="row spread">
            <span style={{ fontWeight: 800, fontSize: 14 }}>{WEEKDAY_LABELS[selectedAvailability.weekday]}曜日</span>
            <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {selectedAvailability.minutes > 0 ? `${Math.floor(selectedAvailability.minutes / 60)}h${selectedAvailability.minutes % 60 > 0 ? `${selectedAvailability.minutes % 60}m` : ''}` : '休み'}
            </span>
          </div>
          {selectedAvailability.windows.map((window, idx) => (
            <div key={`${selectedAvailability.weekday}-${idx}`} className="row mt-8" style={{ gap: 6 }}>
              <input
                aria-label={`${WEEKDAY_LABELS[selectedAvailability.weekday]}曜日 ${idx + 1}枠目の開始`}
                type="time"
                value={window.start}
                onChange={(e) => {
                  const windows = selectedAvailability.windows.map((w, i) => (i === idx ? { ...w, start: e.target.value } : w));
                  updateAvailabilityWindows(selectedAvailability.weekday, windows);
                }}
                style={inputStyle}
              />
              <span className="faint">〜</span>
              <input
                aria-label={`${WEEKDAY_LABELS[selectedAvailability.weekday]}曜日 ${idx + 1}枠目の終了`}
                type="time"
                value={window.end}
                onChange={(e) => {
                  const windows = selectedAvailability.windows.map((w, i) => (i === idx ? { ...w, end: e.target.value } : w));
                  updateAvailabilityWindows(selectedAvailability.weekday, windows);
                }}
                style={inputStyle}
              />
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 8px', minHeight: 44, fontSize: 17, flexShrink: 0 }}
                aria-label={`${WEEKDAY_LABELS[selectedAvailability.weekday]}曜日 ${idx + 1}枠目を削除`}
                onClick={() => updateAvailabilityWindows(selectedAvailability.weekday, selectedAvailability.windows.filter((_, i) => i !== idx))}
              >
                <X size={16} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="row mt-8">
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() => {
                const last = selectedAvailability.windows.length > 0 ? selectedAvailability.windows[selectedAvailability.windows.length - 1] : null;
                const start = last?.end ?? (selectedAvailability.weekday === 0 || selectedAvailability.weekday === 6 ? '09:00' : '18:00');
                updateAvailabilityWindows(selectedAvailability.weekday, [...selectedAvailability.windows, { start, end: minutesToHM(hmToMinutes(start) + 120) }]);
              }}
            >
              時間帯を追加
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => updateAvailabilityWindows(selectedAvailability.weekday, [])}>
              休みにする
            </button>
          </div>
          <div className="availability-copy-actions" aria-label="時間帯を他の曜日へコピー">
            <button type="button" onClick={() => copyAvailabilityWindows(selectedAvailability.weekday, [1, 2, 3, 4, 5])}>平日にコピー</button>
            <button type="button" onClick={() => copyAvailabilityWindows(selectedAvailability.weekday, [0, 6])}>土日にコピー</button>
          </div>
        </div>
      )}
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveAvailability}>
        曜日ごとの時間を保存して再計算
      </button>

      <Disclosure title="計画の詳細設定" icon={<SlidersHorizontal size={16} strokeWidth={2.2} />} iconColor="var(--text-sub)" summary={`${studyDraft.sessionMinMinutes}〜${studyDraft.sessionMaxMinutes}分 / コマ`}>
      <div className="section-label compact">1日・1コマの上限</div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="st-max-daily">1日の最大(分)</label>
          <NumericInput
            id="st-max-daily"
            value={studyDraft.maxDailyMinutes}
            min={0}
            max={1200}
            placeholder="例: 360"
            onChange={(v) => { markDirty('study'); setStudyDraft((prev) => ({ ...prev, maxDailyMinutes: v })); }}
          />
        </div>
        <div className="field">
          <label htmlFor="st-session-max">1コマの最大(分)</label>
          <NumericInput
            id="st-session-max"
            value={studyDraft.sessionMaxMinutes}
            min={15}
            max={240}
            placeholder="例: 90"
            onChange={(v) => { markDirty('study'); setStudyDraft((prev) => ({ ...prev, sessionMaxMinutes: v })); }}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="st-session-min">1コマの最小(分)</label>
        <NumericInput
          id="st-session-min"
          value={studyDraft.sessionMinMinutes}
          min={5}
          max={120}
          placeholder="例: 25"
          onChange={(v) => { markDirty('study'); setStudyDraft((prev) => ({ ...prev, sessionMinMinutes: v })); }}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="st-horizon">具体計画の最低日数</label>
          <NumericInput id="st-horizon" value={studyDraft.taskGenerationHorizonDays ?? 42} min={7} max={90} onChange={(v) => { markDirty('study'); setStudyDraft((prev) => ({ ...prev, taskGenerationHorizonDays: Math.max(7, Math.min(90, v)) })); }} />
          <small className="faint">目標日がこれより先なら、目標日まで自動で延長します。</small>
        </div>
      </div>
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveStudySettings}>
        上限を保存して再計算
      </button>
      </Disclosure>
      </Disclosure>
      )}

      {/* 復習の自動生成 */}
      {page === 'goals' && (
      <Disclosure
        title="復習の自動生成"
        icon={<Repeat size={16} strokeWidth={2.2} />}
        iconColor="var(--ok)"
        summary={state.settings.reviewRule.enabled ? 'オン(教材ごとに設定)' : 'オフ'}
      >
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.settings.reviewRule.enabled}
            onChange={(e) => setReviewAutoEnabled(e.target.checked)}
          />
          完了した範囲の復習タスク(1・3・7日後など)を自動で作る
        </label>
        <p className="field-hint">
          オフにすると、教材の設定に関わらず復習タスクは自動生成されず、生成済みの未着手の復習タスクも計画から外れます。復習したい範囲は手動タスクで自由に追加できます
        </p>
      </Disclosure>
      )}

      {/* 週間目標 */}
      {page === 'goals' && (
      <Disclosure
        title="週間目標"
        icon={<Trophy size={16} strokeWidth={2.2} />}
        iconColor="var(--warn)"
        summary={state.settings.weeklyTargetMinutes > 0 ? `週${Math.round((state.settings.weeklyTargetMinutes / 60) * 10) / 10}時間` : '未設定'}
      >
        <div className="field">
          <label htmlFor="st-weekly-goal">1週間の目標学習時間(時間)</label>
          <NumericInput
            id="st-weekly-goal"
            value={weeklyTargetDraft > 0 ? Math.round((weeklyTargetDraft / 60) * 10) / 10 : null}
            emptyValue={0}
            min={0}
            max={100}
            decimal
            placeholder="例: 20(0で解除)"
            onChange={(v) => { markDirty('weekly'); setWeeklyTargetDraft(Math.round(v * 60)); }}
          />
        </div>
        <p className="field-hint" style={{ marginBottom: 10 }}>記録画面(週表示)に進捗バーが表示され、達成でバッジを獲得できます</p>
        <button className="btn btn-secondary btn-sm btn-block" onClick={saveWeeklyGoal}>
          週間目標を保存
        </button>
      </Disclosure>
      )}

      {/* タイマーと通知 */}
      {page === 'timer' && (
      <section className="settings-form-card" aria-labelledby="timer-settings-title">
        <div className="settings-form-heading">
          <span className="settings-form-icon" style={{ color: 'var(--accent-2)' }} aria-hidden="true"><Timer size={18} /></span>
          <div><h3 id="timer-settings-title">集中セッション</h3><p>開始時の既定値と、フェーズが変わる時の動作を設定します。</p></div>
        </div>
        <div className="field">
          <label>標準のタイマー</label>
          <Segmented
            ariaLabel="標準のタイマー"
            options={[
              { value: 'stopwatch', label: 'ストップウォッチ' },
              { value: 'pomodoro', label: '🍅 ポモドーロ' },
            ]}
            value={timerDraft.defaultMode}
            onChange={(defaultMode) => {
              markDirty('timer'); setTimerDraft((current) => ({ ...current, defaultMode }));
            }}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="st-pomo-work">集中(分)</label>
            <NumericInput
              id="st-pomo-work"
              value={timerDraft.pomodoro.workMinutes}
              min={5}
              max={120}
              placeholder="25"
              onChange={(v) => { markDirty('timer'); setTimerDraft((p) => ({ ...p, pomodoro: { ...p.pomodoro, workMinutes: Math.max(5, v) } })); }}
            />
          </div>
          <div className="field">
            <label htmlFor="st-pomo-break">休憩(分)</label>
            <NumericInput
              id="st-pomo-break"
              value={timerDraft.pomodoro.breakMinutes}
              min={1}
              max={60}
              placeholder="5"
              onChange={(v) => { markDirty('timer'); setTimerDraft((p) => ({ ...p, pomodoro: { ...p.pomodoro, breakMinutes: Math.max(1, v) } })); }}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="st-pomo-long">長い休憩(分)</label>
            <NumericInput
              id="st-pomo-long"
              value={timerDraft.pomodoro.longBreakMinutes}
              min={5}
              max={90}
              placeholder="15"
              onChange={(v) => { markDirty('timer'); setTimerDraft((p) => ({ ...p, pomodoro: { ...p.pomodoro, longBreakMinutes: Math.max(5, v) } })); }}
            />
          </div>
          <div className="field">
            <label htmlFor="st-pomo-cycles">長い休憩までの回数</label>
            <NumericInput
              id="st-pomo-cycles"
              value={timerDraft.pomodoro.cyclesUntilLongBreak}
              min={2}
              max={8}
              placeholder="4"
              onChange={(v) => { markDirty('timer'); setTimerDraft((p) => ({ ...p, pomodoro: { ...p.pomodoro, cyclesUntilLongBreak: Math.min(8, Math.max(2, v)) } })); }}
            />
          </div>
        </div>
        <button className="btn btn-secondary btn-sm btn-block" style={{ marginBottom: 12 }} onClick={saveTimerSettings}>
          ポモドーロ設定を保存
        </button>
        <label className="check-row">
          <input type="checkbox" checked={state.settings.timer.sound} onChange={(e) => setTimerFlag('sound', e.target.checked)} />
          フェーズ切替時にチャイムを鳴らす
        </label>
        <label className="check-row">
          <input type="checkbox" checked={state.settings.timer.vibration} onChange={(e) => setTimerFlag('vibration', e.target.checked)} />
          バイブレーション(対応端末のみ)
        </label>
        {notificationSupported() && (
          <label className="check-row">
            <input type="checkbox" checked={state.settings.timer.notification} onChange={(e) => setTimerFlag('notification', e.target.checked)} />
            集中・休憩の切り替えを通知する
          </label>
        )}
        <label className="check-row">
          <input type="checkbox" checked={state.settings.timer.keepScreenOn} onChange={(e) => setTimerFlag('keepScreenOn', e.target.checked)} />
          タイマー中は画面を消灯しない
        </label>
      </section>
      )}

      {/* 固定予定 */}
      {page === 'schedule' && (
      <Disclosure title="固定予定" icon={<Pin size={16} strokeWidth={2.2} />} iconColor="var(--warn)" summary={events.length > 0 ? `${events.length}件` : '学校・塾など'}>
      {events.map((ev) => (
        <div key={ev.id} className="row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {eventLabel(ev)} {ev.title}
          </span>
          <span className="faint">
            {ev.start}〜{ev.end}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} aria-label={`${ev.title}を削除`} onClick={() => removeEvent(ev.id)}>
            削除
          </button>
        </div>
      ))}
      <div className="field">
        <Segmented
          ariaLabel="予定種別"
          options={[
            { value: 'weekly', label: '毎週' },
            { value: 'date', label: '1日だけ' },
            { value: 'range', label: '期間' },
          ]}
          value={newEvent.mode}
          onChange={(mode) => updateNewEvent({ mode })}
        />
      </div>
      <div className="field-row">
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            aria-label="予定名"
            value={newEvent.title}
            onChange={(e) => updateNewEvent({ title: e.target.value })}
            placeholder="予定名(例: 部活)"
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          {newEvent.mode === 'weekly' ? (
            <select
              aria-label="曜日"
              value={newEvent.weekday}
              onChange={(e) => updateNewEvent({ weekday: Number(e.target.value) as Weekday })}
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={label} value={i}>
                  毎週{label}曜日
                </option>
              ))}
            </select>
          ) : newEvent.mode === 'date' ? (
            <input aria-label="日付" type="date" value={newEvent.date} onChange={(e) => updateNewEvent({ date: e.target.value })} />
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <input
                aria-label="期間開始日"
                type="date"
                value={newEvent.startDate}
                onChange={(e) => updateNewEvent({ startDate: e.target.value })}
              />
              <span className="faint">〜</span>
              <input
                aria-label="期間終了日"
                type="date"
                value={newEvent.endDate}
                min={newEvent.startDate || undefined}
                onChange={(e) => updateNewEvent({ endDate: e.target.value })}
              />
            </div>
          )}
        </div>
      </div>
      {newEvent.mode === 'weekly' && (
        <div className="field-row">
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="fixed-start-date">有効開始日(任意)</label>
            <input
              id="fixed-start-date"
              type="date"
              value={newEvent.startDate}
              onChange={(e) => updateNewEvent({ startDate: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="fixed-end-date">有効終了日(任意)</label>
            <input
              id="fixed-end-date"
              type="date"
              value={newEvent.endDate}
              min={newEvent.startDate || undefined}
              onChange={(e) => updateNewEvent({ endDate: e.target.value })}
            />
          </div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 8 }}>
        <input aria-label="開始時刻" type="time" value={newEvent.start} onChange={(e) => updateNewEvent({ start: e.target.value })} style={inputStyle} />
        <span className="faint">〜</span>
        <input aria-label="終了時刻" type="time" value={newEvent.end} onChange={(e) => updateNewEvent({ end: e.target.value })} style={inputStyle} />
        <button className="btn btn-secondary btn-sm" onClick={addEvent}>
          追加
        </button>
      </div>
      </Disclosure>
      )}

      {/* 日別例外 */}
      {page === 'schedule' && (
      <Disclosure title="日別の例外" icon={<CalendarCog size={16} strokeWidth={2.2} />} iconColor="var(--accent)" summary={state.dayPlans.length > 0 ? `${state.dayPlans.length}件` : '模試・休養日など'}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="st-ex-date">日付</label>
          <input id="st-ex-date" type="date" value={dayException.date} onChange={(e) => updateDayException({ date: e.target.value })} />
        </div>
        <div className="field">
          <label>負荷</label>
          <Segmented
            ariaLabel="日別負荷"
            options={[
              { value: 'normal', label: '通常' },
              { value: 'light', label: '軽め' },
              { value: 'heavy', label: '重め' },
              { value: 'rest', label: '休養' },
            ]}
            value={dayException.load}
            onChange={(load) => updateDayException({ load })}
          />
        </div>
      </div>
      <label className="check-row" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={dayException.useWindow} onChange={(e) => updateDayException({ useWindow: e.target.checked })} />
        この日だけ勉強可能時間を上書きする
      </label>
      {dayException.useWindow && (
        <div className="row" style={{ marginBottom: 8 }}>
          <input aria-label="例外開始時刻" type="time" value={dayException.start} onChange={(e) => updateDayException({ start: e.target.value })} style={inputStyle} />
          <span className="faint">〜</span>
          <input aria-label="例外終了時刻" type="time" value={dayException.end} onChange={(e) => updateDayException({ end: e.target.value })} style={inputStyle} />
        </div>
      )}
      <div className="field">
        <label htmlFor="st-ex-memo">メモ</label>
        <input id="st-ex-memo" value={dayException.memo} onChange={(e) => updateDayException({ memo: e.target.value })} placeholder="例: 模試、復習日、明日は2時間だけ" />
      </div>
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveDayException}>
        例外を保存して再計算
      </button>
      {state.dayPlans.length > 0 && (
        <div className="mt-12">
          {(['future', 'past'] as const).map((group) => {
            const plans = state.dayPlans.filter((plan) => group === 'future' ? plan.date >= today() : plan.date < today());
            if (plans.length === 0) return null;
            return <div key={group}><div className="faint mt-8">{group === 'future' ? '今後の例外' : '過去の例外'}</div>{plans.map((plan) => (
              <div key={plan.date} className="mini-block">
                <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'flex-start', minWidth: 0 }} onClick={() => loadDayException(plan)}><span style={{ fontWeight: 800 }}>{formatDateShort(plan.date)}</span><span className="faint">{plan.load === 'rest' ? '休養' : plan.load === 'light' ? '軽め' : plan.load === 'heavy' ? '重め' : '通常'}</span>{plan.memo && <span className="muted text-ellipsis">{plan.memo}</span>}</button>
                <button type="button" className="icon-btn danger" aria-label={`${formatDateShort(plan.date)}の例外を削除`} onClick={() => {
                  if (!window.confirm('この日別例外を削除し、曜日テンプレートへ戻しますか？')) return;
                  execute({ type: 'DELETE_DAY_PLAN', date: plan.date }); toast('日別例外を削除して再計算しました');
                }}><X size={16} /></button>
              </div>
            ))}</div>;
          })}
        </div>
      )}
      </Disclosure>
      )}

      {page === 'subjects' && <SubjectManager onDirtyChange={setSubjectDraftDirty} />}

      {/* データ管理 */}
      {page === 'data' && (
      <Disclosure defaultOpen title="データ管理" icon={<Database size={16} strokeWidth={2.2} />} iconColor="var(--text-sub)" summary="バックアップ（変更履歴は除外）">
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
        教材・現在の予定・学習記録・未達履歴・設定を保存します。容量を抑えるため、復元に不要な「計画の変更履歴」はバックアップに含めません。
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={doExport}>
          <Download size={14} strokeWidth={2.4} aria-hidden="true" /> バックアップを書き出す
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ flex: 1 }}
          onClick={() => fileRef.current?.click()}
          disabled={importBusy}
          aria-describedby="main-import-status"
        >
          <Upload size={14} strokeWidth={2.4} aria-hidden="true" /> {importBusy ? '読み込み中…' : 'インポート'}
        </button>
      </div>
      <button className="btn btn-secondary btn-sm btn-block mt-8" onClick={doExportCSV}>
        <FileDown size={14} strokeWidth={2.4} aria-hidden="true" /> 学習ログをCSVで書き出す
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        disabled={importBusy}
        aria-label="バックアップJSONを選択"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doImport(f);
          e.target.value = '';
        }}
      />
      <p id="main-import-status" role="status" aria-live="polite" className="faint mt-8">
        {importBusy ? 'バックアップJSONを読み込んでいます。画面を閉じずにお待ちください。' : ''}
      </p>
      <button className="btn btn-danger btn-block mt-8" onClick={doReset} disabled={importBusy}>
        学習計画・記録を初期化
      </button>
      <p className="field-hint mt-8">暗記カードと暗記履歴はこの操作では削除されません。</p>
      </Disclosure>
      )}

      {page === 'data' && <p className="faint" style={{ textAlign: 'center', marginTop: 18 }}>
        StudyCommander v1.0 ・ データはアカウントに紐づけてクラウドに保存されます
      </p>}
      </div>
    </Sheet>
  );
}

function SettingsDestination({
  icon,
  iconColor,
  title,
  description,
  value,
  onClick,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  description: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-destination" onClick={onClick}>
      <span className="settings-destination-icon" style={{ color: iconColor }} aria-hidden="true">{icon}</span>
      <span className="settings-destination-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="settings-destination-value">{value}</span>
      <ChevronRight className="settings-destination-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

function SubjectManager({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { state, execute } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Subject | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const persistedSubject = editing ? state.subjects.find((subject) => subject.id === editing.id) : undefined;
  const editingDirty = Boolean(editing && (persistedSubject
    ? JSON.stringify(editing) !== JSON.stringify(persistedSubject)
    : editing.name.trim() || editing.color !== '#6366f1' || editing.importance !== 3 || editing.weakness !== 3));
  const switchEditingTarget = (next: Subject) => {
    if (editing?.id === next.id) return;
    if (editingDirty && !window.confirm('保存されていない科目の変更があります。変更を破棄して別の科目を編集しますか？')) return;
    setEditing(next);
    setMergeTarget('');
  };
  const startAdd = () => switchEditingTarget({ id: genId('subj'), name: '', color: '#6366f1', importance: 3, weakness: 3 });

  useEffect(() => {
    onDirtyChange(editingDirty);
  }, [editingDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const referenced = editing ? state.materials.some((item) => item.subjectId === editing.id)
    || state.tasks.some((item) => item.subjectId === editing.id)
    || state.sessions.some((item) => item.subjectId === editing.id) : false;
  const content = (
    <>
      {state.subjects.map((subject) => (
        <button type="button" className="btn btn-secondary btn-block mt-8" key={subject.id} onClick={() => switchEditingTarget({ ...subject })}>
          <span className="subject-chip" style={{ background: `${subject.color}26`, color: subject.color }}>{subject.name}</span>
          <span className="faint">重要度{subject.importance}・苦手度{subject.weakness}</span>
        </button>
      ))}
      <button type="button" className="btn btn-ghost btn-block mt-8" onClick={startAdd}><Plus size={16} />科目を追加</button>
      {editing && (
        <div className="card mt-12" style={{ padding: 12 }}>
          <div className="field"><label htmlFor="subject-name">科目名</label><input id="subject-name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
          <div className="field"><label htmlFor="subject-color">色</label><input id="subject-color" type="color" value={editing.color.startsWith('#') ? editing.color : '#6366f1'} onChange={(event) => setEditing({ ...editing, color: event.target.value })} /></div>
          <div className="field"><label>重要度</label><Rating value={editing.importance} onChange={(importance) => setEditing({ ...editing, importance })} label="重要度" /></div>
          <div className="field"><label>苦手度</label><Rating value={editing.weakness} onChange={(weakness) => setEditing({ ...editing, weakness })} label="苦手度" /></div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => {
            if (!editing.name.trim()) { toast('科目名を入力してください'); return; }
            const exists = state.subjects.some((subject) => subject.id === editing.id);
            execute({ type: exists ? 'UPDATE_SUBJECT' : 'ADD_SUBJECT', subject: { ...editing, name: editing.name.trim() } });
            toast(exists ? '科目を更新しました' : '科目を追加しました'); setEditing(null);
          }}>科目情報を保存</button>
          {state.subjects.some((subject) => subject.id === editing.id) && state.subjects.length > 1 && (
            <>
              {referenced && <div className="field mt-12"><label htmlFor="merge-subject">関連データの移動先</label><select id="merge-subject" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">選択してください</option>{state.subjects.filter((subject) => subject.id !== editing.id).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div>}
              <button type="button" className="btn btn-danger btn-block mt-12" onClick={() => {
                if (referenced && !mergeTarget) { toast('関連データの移動先を選択してください'); return; }
                if (!window.confirm(referenced ? 'この科目を選択した科目へ統合しますか？' : 'この科目を削除しますか？')) return;
                execute(referenced ? { type: 'MERGE_SUBJECT', sourceId: editing.id, targetId: mergeTarget } : { type: 'DELETE_SUBJECT', subjectId: editing.id });
                toast(referenced ? '科目と関連データを統合しました' : '科目を削除しました'); setEditing(null);
              }}>{referenced ? '選択した科目へ統合' : 'この科目を削除'}</button>
            </>
          )}
          {state.subjects.length <= 1 && <p className="field-hint">最後の1科目は削除できません。</p>}
        </div>
      )}
    </>
  );
  return (
    <section className="settings-form-card" aria-labelledby="subject-manager-title">
      <div className="settings-form-heading">
        <span className="settings-form-icon" style={{ color: 'var(--accent)' }} aria-hidden="true"><BookOpen size={18} /></span>
        <div><h3 id="subject-manager-title">登録済みの科目</h3><p>教材・タスク・記録に使う表示をまとめて変更できます。</p></div>
      </div>
      {content}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 44,
  background: 'var(--bg-elev2)',
  border: '1.5px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 16,
  padding: '8px 6px',
  textAlign: 'center',
};
