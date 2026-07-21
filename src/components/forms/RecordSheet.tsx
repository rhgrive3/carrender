import { useEffect, useMemo, useRef, useState } from 'react';
import { PenLine, Plus, Timer } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Disclosure, NumericInput, Rating, Segmented, Stepper } from '../ui/bits';
import { useApp } from '../../state/AppContext';
import { useToast } from '../ui/Toast';
import { todayQuotaFor } from '../../lib/analytics';
import { APP_TIME_ZONE, localDateTimeToISOString, minutesInTimeZone, minutesToHM, today } from '../../lib/date';
import { missingRecordMaterialOption, missingRecordSubjectOption } from '../../lib/recordReferences';
import { applyRecordSessionTransaction } from '../../lib/recordSessionTransaction';
import { recordAmountInputLimit, recordTaskCompletionAmount } from '../../lib/recordEditCapacity';
import type { StudySession, StudyTask } from '../../types';
import { useTimer } from '../timer/TimerContext';

export interface RecordPreset {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  minutes: number;
  rangeLabel: string;
  source: 'timer' | 'manual';
  taskLocator?: { sourceId?: string; range?: { start: number; end: number }; type?: 'new' | 'review' | 'mockReview' | 'pastExam' };
}

interface RecordSheetProps {
  open: boolean;
  onClose: () => void;
  preset?: RecordPreset;
  onDone?: () => void;
  session?: StudySession;
}

function datePartOf(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}

function timePartOf(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
}

function sessionStartTime(session?: StudySession, presetStartedAt?: string | null) {
  return timePartOf(session?.startedAt ?? presetStartedAt)
    ?? minutesToHM(minutesInTimeZone(new Date()));
}

function sessionDate(session?: StudySession, presetStartedAt?: string | null) {
  return session?.date ?? datePartOf(presetStartedAt) ?? today();
}

function matchesPresetLocator(task: StudyTask, preset?: RecordPreset): boolean {
  const locator = preset?.taskLocator;
  if (!locator?.sourceId || task.status === 'done' || task.sourceId !== locator.sourceId || task.materialId !== preset?.materialId) return false;
  if (locator.type && task.type !== locator.type) return false;
  if (!locator.range) return true;
  const range = task.materialRange
    ?? (Number.isFinite(task.rangeStart) && Number.isFinite(task.rangeEnd)
      ? { start: task.rangeStart!, end: task.rangeEnd! }
      : undefined);
  return range?.start === locator.range.start && range.end === locator.range.end;
}

export function RecordSheet({ open, onClose, preset, onDone, session }: RecordSheetProps) {
  const { state, execute } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const timerStartedAt = preset?.source === 'timer' ? timer.startedAt : null;

  const [subjectId, setSubjectId] = useState(session?.subjectId ?? preset?.subjectId ?? state.subjects[0]?.id ?? '');
  const [materialId, setMaterialId] = useState<string>(session?.materialId ?? preset?.materialId ?? '');
  const [minutes, setMinutes] = useState(session?.minutes ?? preset?.minutes ?? 30);
  const originalTaskId = session?.taskId ?? preset?.taskId;
  const exactTask = originalTaskId ? state.tasks.find((item) => item.id === originalTaskId) : undefined;
  const locatedTask = !exactTask && preset ? state.tasks.find((item) => matchesPresetLocator(item, preset)) : undefined;
  const task = exactTask ?? locatedTask ?? session?.taskSnapshotBefore;
  const referenceTaskId = session?.taskId ?? task?.id ?? preset?.taskId ?? null;
  const taskCompletionAmount = recordTaskCompletionAmount(task, session);
  const [amountDone, setAmountDone] = useState(() => session?.amountDone ?? task?.amount ?? 0);
  const [completed, setCompleted] = useState(session ? (session.completedTask ?? Boolean(session.taskId && !session.replacementTaskIds?.length)) : true);
  const [focus, setFocus] = useState<1 | 2 | 3 | 4 | 5 | null>(session?.focus ?? null);
  const [memo, setMemo] = useState(session?.memo ?? '');
  const [showMemo, setShowMemo] = useState(Boolean(session?.memo));
  const [recordDate, setRecordDate] = useState(sessionDate(session, timerStartedAt));
  const [startTime, setStartTime] = useState(() => sessionStartTime(session, timerStartedAt));
  const initializedTargetRef = useRef<string | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedTargetRef.current = null;
      actionInFlightRef.current = false;
      return;
    }
    const targetKey = session
      ? `session:${session.id}`
      : preset
        ? `preset:${preset.taskId ?? ''}:${preset.subjectId}:${preset.materialId ?? ''}:${preset.minutes}:${preset.rangeLabel}:${preset.source}:${timerStartedAt ?? ''}`
        : 'manual';
    if (initializedTargetRef.current === targetKey) return;
    initializedTargetRef.current = targetKey;

    setSubjectId(session?.subjectId ?? preset?.subjectId ?? state.subjects[0]?.id ?? '');
    setMaterialId(session?.materialId ?? preset?.materialId ?? '');
    setMinutes(session?.minutes ?? preset?.minutes ?? 30);
    setAmountDone(session?.amountDone ?? task?.amount ?? 0);
    setCompleted(session ? (session.completedTask ?? Boolean(session.taskId && !session.replacementTaskIds?.length)) : true);
    setFocus(session?.focus ?? null);
    setMemo(session?.memo ?? '');
    setShowMemo(Boolean(session?.memo));
    setRecordDate(sessionDate(session, timerStartedAt));
    setStartTime(sessionStartTime(session, timerStartedAt));
  }, [open, preset, session, state.subjects, task?.amount, timerStartedAt]);

  const materials = useMemo(
    () => state.materials.filter((m) => (!m.archived || m.id === session?.materialId) && m.subjectId === subjectId),
    [session?.materialId, state.materials, subjectId],
  );
  const missingSubject = useMemo(
    () => missingRecordSubjectOption(state.subjects, subjectId),
    [state.subjects, subjectId],
  );
  const missingMaterial = useMemo(
    () => missingRecordMaterialOption(materials, materialId || null, session?.rangeLabel ?? ''),
    [materialId, materials, session?.rangeLabel],
  );
  const selectedMaterialId = preset && !session ? preset.materialId : (materialId || null);
  const material = state.materials.find((m) => m.id === selectedMaterialId);
  const quota = material ? todayQuotaFor(state, material.id, today()) : 0;
  const hasTaskTarget = Boolean(referenceTaskId || preset?.taskLocator?.sourceId);
  const keepsSameTaskTarget = session
    ? session.subjectId === subjectId && session.materialId === selectedMaterialId
    : preset?.subjectId === subjectId && preset.materialId === selectedMaterialId;
  const activeTaskTarget = hasTaskTarget && keepsSameTaskTarget;

  const remainingAmount = useMemo(() => {
    if (!material) return activeTaskTarget ? task?.amount ?? 9999 : 9999;
    const keepsEditedReference = Boolean(session && session.subjectId === subjectId && session.materialId === material.id);
    const allowsTaskOverrun = Boolean(session || preset?.source === 'timer');
    return recordAmountInputLimit(
      state,
      material.id,
      keepsEditedReference ? session : undefined,
      allowsTaskOverrun ? undefined : activeTaskTarget ? task : undefined,
    );
  }, [activeTaskTarget, material, preset?.source, session, state, subjectId, task]);

  useEffect(() => {
    if (!open) return;
    setAmountDone((current) => Math.min(remainingAmount, Math.max(0, current)));
  }, [open, remainingAmount, selectedMaterialId]);

  const updateAmountDone = (nextAmount: number) => {
    setAmountDone(nextAmount);
    if (activeTaskTarget && taskCompletionAmount > 0 && nextAmount < taskCompletionAmount) setCompleted(false);
  };

  const updateCompleted = (nextCompleted: boolean) => {
    setCompleted(nextCompleted);
    if (nextCompleted && activeTaskTarget && taskCompletionAmount > 0) {
      setAmountDone((current) => Math.max(current, taskCompletionAmount));
    }
  };

  const save = () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    const release = () => { actionInFlightRef.current = false; };

    if (!subjectId) {
      release();
      toast('科目を選択してください');
      return;
    }
    const usesExplicitStart = !preset || Boolean(session) || Boolean(timerStartedAt);
    if (usesExplicitStart) {
      try {
        const resolvedStartedAt = localDateTimeToISOString(recordDate, startTime);
        if (recordDate > today()) throw new Error('future-date');
        if (recordDate === today() && resolvedStartedAt > new Date().toISOString()) throw new Error('future-time');
      } catch (caught) {
        release();
        if (caught instanceof Error && caught.message === 'future-date') toast('未来日の記録は追加できません');
        else if (caught instanceof Error && caught.message === 'future-time') toast('未来の開始時刻は指定できません');
        else toast('学習日と開始時刻を正しく入力してください');
        return;
      }
    }

    const preservesTaskReference = !session || keepsSameTaskTarget;
    if (session && hasTaskTarget && !preservesTaskReference && !window.confirm(
      '科目または教材を変更すると、元のタスクは未完了へ戻り、この記録はタスクなしの自由記録になります。\n復習タスクと残り計画も再計算します。続けますか？',
    )) {
      release();
      return;
    }

    const input = {
      taskId: preservesTaskReference ? referenceTaskId : null,
      subjectId,
      materialId: selectedMaterialId,
      minutes: Math.min(600, Math.max(1, minutes)),
      amountDone,
      focus,
      memo,
      source: session?.source ?? preset?.source ?? 'manual',
      rangeLabel: preservesTaskReference
        ? session?.rangeLabel ?? preset?.rangeLabel ?? material?.name ?? ''
        : material?.name ?? '',
      completedTask: Boolean(
        preservesTaskReference
        && referenceTaskId
        && completed
        && (taskCompletionAmount <= 0 || amountDone >= taskCompletionAmount),
      ),
      taskLocator: preservesTaskReference ? preset?.taskLocator : undefined,
      date: usesExplicitStart ? recordDate : undefined,
      startTime: usesExplicitStart ? startTime : undefined,
    };
    const action = session
      ? ({ type: 'UPDATE_SESSION' as const, sessionId: session.id, input })
      : ({ type: 'RECORD_SESSION' as const, input });
    const tasklessMaterialRecord = Boolean(input.materialId && !input.taskId && !input.taskLocator?.sourceId);
    const taskOverrunRecord = Boolean(
      input.materialId
      && (input.taskId || input.taskLocator?.sourceId)
      && input.completedTask
      && taskCompletionAmount > 0
      && input.amountDone > taskCompletionAmount,
    );
    const result = tasklessMaterialRecord || taskOverrunRecord
      ? execute({ type: 'REPLACE_STATE', state: applyRecordSessionTransaction(state, action, today()) })
      : execute(action);
    if (!result.changed) {
      release();
      toast(result.message ?? '記録を保存できませんでした');
      return;
    }
    toast(result.message ?? (session ? '記録を更新しました' : '記録を保存しました 🎉'));
    onDone?.();
    onClose();
  };

  const remove = () => {
    if (!session || actionInFlightRef.current) return;
    if (!window.confirm('この学習記録を削除しますか？教材進捗と復習タスクも再計算されます。')) return;
    actionInFlightRef.current = true;
    const result = execute({ type: 'DELETE_SESSION', sessionId: session.id });
    if (!result.changed) {
      actionInFlightRef.current = false;
      toast(result.message ?? '記録を削除できませんでした');
      return;
    }
    toast(result.message ?? '記録を削除して進捗を再計算しました');
    onClose();
  };

  const exceedsOriginalTaskAmount = Boolean(
    activeTaskTarget
    && taskCompletionAmount > 0
    && amountDone > taskCompletionAmount,
  );
  const compactPreset = Boolean(preset && !session && activeTaskTarget);
  const detailSummary = [
    activeTaskTarget ? (completed ? '完了' : '途中') : null,
    (material || task) ? `${amountDone}${material?.unit ?? ''}` : null,
    focus ? `集中度${focus}` : null,
    memo.trim() ? 'メモあり' : null,
  ].filter(Boolean).join('・');

  const recordDetails = (
    <>
      {activeTaskTarget && (
        <div className="field">
          <label>このタスクは終わった?</label>
          <Segmented ariaLabel="タスク完了" options={[{ value: 'yes', label: '✓ 完了した' }, { value: 'no', label: '途中まで' }]} value={completed ? 'yes' : 'no'} onChange={(v) => updateCompleted(v === 'yes')} />
        </div>
      )}

      {session && hasTaskTarget && !keepsSameTaskTarget && (
        <div className="card" role="alert" style={{ marginBottom: 14, padding: 12 }}>
          <strong>元のタスクとの紐付けを解除します</strong>
          <p className="field-hint" style={{ marginBottom: 0 }}>保存すると元のタスクは未完了へ戻り、この記録は選び直した科目・教材の自由記録になります。</p>
        </div>
      )}

      {(material || (activeTaskTarget && task) || session?.materialId) && (
        <div className="field">
          <label>{material ? `今回やった${material.unit}数` : '今回やった量'}{quota > 0 && <span style={{ fontWeight: 500 }}> ・今日の目安 {quota}{material?.unit}</span>}</label>
          <NumericInput value={amountDone} min={0} max={remainingAmount} placeholder={`例: ${quota || (activeTaskTarget ? task?.amount : 10) || 10}`} onChange={updateAmountDone} ariaLabel="今回やった量" />
          {exceedsOriginalTaskAmount && <div className="field-hint">予定の{taskCompletionAmount}{material?.unit ?? ''}を超えた分もこの完了記録へ反映し、残り予定を再計算します。</div>}
        </div>
      )}

      <div className="field"><label>集中度</label><Rating value={focus} onChange={setFocus} icon="🔥" label="集中度" /></div>
      {showMemo ? <div className="field"><label htmlFor="rec-memo">メモ</label><textarea id="rec-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="気づいたこと、ミスの原因など" /></div> : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMemo(true)}><Plus size={14} strokeWidth={2.6} aria-hidden="true" /> メモを追加</button>}
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={session ? '学習記録を編集' : preset?.source === 'timer' ? 'おつかれさま!記録しよう' : '勉強を記録'}>
      {(!preset || session) && (
        <>
          <div className="field"><label htmlFor="rec-subject">科目</label><select id="rec-subject" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setMaterialId(''); setAmountDone(0); }}>{missingSubject && <option value={missingSubject.id}>{missingSubject.label}</option>}{state.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="rec-material">教材(任意)</label><select id="rec-material" value={materialId} onChange={(e) => { setMaterialId(e.target.value); setAmountDone(0); }}><option value="">教材なし</option>{missingMaterial && <option value={missingMaterial.id}>{missingMaterial.label}</option>}{materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div className="field"><label>学習時間(分)</label><Stepper value={minutes} onChange={setMinutes} step={5} min={5} max={600} suffix="分" label="学習時間" /></div>
          <div className="field-row"><div className="field"><label htmlFor="rec-date">学習日</label><input id="rec-date" type="date" value={recordDate} max={today()} onChange={(e) => setRecordDate(e.target.value)} /></div><div className="field"><label htmlFor="rec-start">開始時刻</label><input id="rec-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div></div>
        </>
      )}

      {preset && (
        <div className="card" style={{ marginBottom: 16, padding: 13 }}>
          <div className="row spread"><div><div style={{ fontWeight: 700, fontSize: 14.5 }}>{preset.rangeLabel || material?.name || '学習'}</div><div className="faint mt-8" aria-live="polite" aria-atomic="true">記録時間 {minutes}分{timerStartedAt ? ` ・ ${recordDate} ${startTime}開始` : ''}</div></div><span className="status-badge status-accent iflex" style={{ gap: 4 }}>{preset.source === 'timer' ? <><Timer size={12} strokeWidth={2.4} aria-hidden="true" /> タイマー</> : <><PenLine size={12} strokeWidth={2.4} aria-hidden="true" /> 予定から記録</>}</span></div>
          {preset.source === 'timer' && !session && <div className="field" style={{ marginTop: 14, marginBottom: 0 }}><label htmlFor="rec-timer-minutes">記録する学習時間</label><div className="row"><button type="button" className="btn btn-secondary btn-sm" aria-label="記録する学習時間を5分減らす" disabled={minutes <= 1} onClick={() => setMinutes(Math.max(1, minutes - 5))}>−5分</button><div style={{ flex: 1, minWidth: 0 }}><NumericInput id="rec-timer-minutes" value={minutes} min={1} max={600} onChange={setMinutes} ariaLabel="記録する学習時間（分）" /></div><button type="button" className="btn btn-secondary btn-sm" aria-label="記録する学習時間を5分増やす" disabled={minutes >= 600} onClick={() => setMinutes(Math.min(600, minutes + 5))}>＋5分</button></div><div className="field-hint">計測時間 {preset.minutes}分。実際の学習時間に合わせて1〜600分で変更できます。</div>{minutes !== preset.minutes && <button type="button" className="btn btn-ghost btn-sm mt-8" onClick={() => setMinutes(preset.minutes)}>計測値に戻す</button>}</div>}
        </div>
      )}

      {compactPreset ? <Disclosure title="必要なら内容を変更" summary={detailSummary}>{recordDetails}</Disclosure> : recordDetails}
      <button type="button" className="btn btn-primary btn-block mt-16" onClick={save}>{session ? 'この記録を更新' : compactPreset ? 'この内容で保存' : '保存する'}</button>
      {session && <button type="button" className="btn btn-danger btn-block mt-12" onClick={remove}>この記録を削除</button>}
    </Sheet>
  );
}
