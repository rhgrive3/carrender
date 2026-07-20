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

function sessionStartTime(session?: StudySession) {
  return session
    ? new Date(session.startedAt).toLocaleTimeString('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
    : minutesToHM(minutesInTimeZone(new Date()));
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

/**
 * 勉強記録シート。予定からの完了記録は既定値をまとめ、必要な時だけ詳細を開く。
 */
export function RecordSheet({ open, onClose, preset, onDone, session }: RecordSheetProps) {
  const { state, execute } = useApp();
  const toast = useToast();

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
  const [recordDate, setRecordDate] = useState(session?.date ?? today());
  const [startTime, setStartTime] = useState(() => sessionStartTime(session));
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
        ? `preset:${preset.taskId ?? ''}:${preset.subjectId}:${preset.materialId ?? ''}:${preset.minutes}:${preset.rangeLabel}:${preset.source}`
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
    setRecordDate(session?.date ?? today());
    setStartTime(sessionStartTime(session));
  }, [open, preset, session, state.subjects, task?.amount]);

  const materials = useMemo(
    () => state.materials.filter((m) => (!m.archived || m.id === session?.materialId) && m.subjectId === subjectId),
    [session?.materialId, state.materials, subjectId],
  );
  const recentTargets = useMemo(() => {
    const seen = new Set<string>();
    const targets: Array<{
      key: string;
      subjectId: string;
      materialId: string;
      label: string;
      subjectName: string;
      minutes: number;
    }> = [];
    for (const item of [...state.sessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt))) {
      const key = `${item.subjectId}:${item.materialId ?? ''}`;
      if (seen.has(key)) continue;
      const recentSubject = state.subjects.find((subject) => subject.id === item.subjectId);
      if (!recentSubject) continue;
      const recentMaterial = item.materialId ? state.materials.find((material) => material.id === item.materialId && !material.archived) : undefined;
      if (item.materialId && !recentMaterial) continue;
      seen.add(key);
      targets.push({
        key,
        subjectId: item.subjectId,
        materialId: recentMaterial?.id ?? '',
        label: recentMaterial?.name ?? '教材なし',
        subjectName: recentSubject.name,
        minutes: item.minutes,
      });
      if (targets.length >= 3) break;
    }
    return targets;
  }, [state.materials, state.sessions, state.subjects]);
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
  const remainingAmount = useMemo(() => {
    if (!material) return task?.amount ?? 9999;
    const keepsEditedReference = Boolean(session && session.subjectId === subjectId && session.materialId === material.id);
    const allowsTaskOverrun = Boolean(session || preset?.source === 'timer');
    return recordAmountInputLimit(
      state,
      material.id,
      keepsEditedReference ? session : undefined,
      // タイマー終了と既存ログ編集は実績訂正なので教材全体の未完了量まで許可する。
      // タスク一覧からの通常完了だけは、誤入力防止のため予定範囲を上限にする。
      allowsTaskOverrun ? undefined : task,
    );
  }, [material, preset?.source, session, state, subjectId, task]);

  useEffect(() => {
    if (!open) return;
    // 教材・科目の変更で上限が下がった場合、表示値と保存時の実量を一致させる。
    // NumericInputのmaxは次の入力だけを制限するため、親stateもここで補正する必要がある。
    setAmountDone((current) => Math.min(remainingAmount, Math.max(0, current)));
  }, [open, remainingAmount, selectedMaterialId]);

  const updateAmountDone = (nextAmount: number) => {
    setAmountDone(nextAmount);
    // 完了判定の基準は入力可能上限ではなく、元タスクの予定量。
    // 予定量未満へ減らした時だけ「途中まで」へ切り替える。
    if (referenceTaskId && taskCompletionAmount > 0 && nextAmount < taskCompletionAmount) setCompleted(false);
  };

  const updateCompleted = (nextCompleted: boolean) => {
    setCompleted(nextCompleted);
    // 「完了した」を選ぶ場合は元タスクの予定量まで補う。教材の残量全体へは増やさない。
    if (nextCompleted && referenceTaskId && taskCompletionAmount > 0) {
      setAmountDone((current) => Math.max(current, taskCompletionAmount));
    }
  };

  const save = () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    const release = () => {
      actionInFlightRef.current = false;
    };

    if (!subjectId) {
      release();
      toast('科目を選択してください');
      return;
    }
    let resolvedStartedAt: string | null = null;
    if (!preset || session) {
      try {
        resolvedStartedAt = localDateTimeToISOString(recordDate, startTime);
      } catch {
        release();
        toast('学習日と開始時刻を正しく入力してください');
        return;
      }
      if (recordDate > today()) {
        release();
        toast('未来日の記録は追加できません');
        return;
      }
      // 今日の手入力・編集で未来時刻を許すと、学習ログが未来の記録として並び時系列が壊れる。
      if (recordDate === today() && resolvedStartedAt > new Date().toISOString()) {
        release();
        toast('未来の開始時刻は指定できません');
        return;
      }
    }
    const preservesReference = !session || (session.subjectId === subjectId && session.materialId === selectedMaterialId);
    const preservesTaskReference = preservesReference;
    const input = {
      taskId: preservesTaskReference ? referenceTaskId : null,
      subjectId,
      materialId: selectedMaterialId,
      minutes: Math.min(600, Math.max(1, minutes)),
      amountDone,
      focus,
      memo,
      source: session?.source ?? preset?.source ?? 'manual',
      // 教材・科目を変更した編集では旧タスク表示を残さず、教材実績として再計画する。
      rangeLabel: preservesTaskReference
        ? session?.rangeLabel ?? preset?.rangeLabel ?? material?.name ?? ''
        : material?.name ?? '',
      completedTask: Boolean(
        preservesTaskReference
        && referenceTaskId
        && completed
        && (taskCompletionAmount <= 0 || amountDone >= taskCompletionAmount),
      ),
      taskLocator: preset?.taskLocator,
      date: preset && !session ? undefined : recordDate,
      startTime: preset && !session ? undefined : startTime,
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
    // 自由記録と予定量超過は、記録後の教材残量から今日以降を再計画する。
    // 予定量超過では元タスクを完了履歴へ残したまま、超過分だけを同じ記録へ追加する。
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

  const hasTaskTarget = Boolean(referenceTaskId || preset?.taskLocator?.sourceId);
  const keepsSameTaskTarget = session
    ? session.subjectId === subjectId && session.materialId === selectedMaterialId
    : preset?.subjectId === subjectId && preset.materialId === selectedMaterialId;
  const exceedsOriginalTaskAmount = Boolean(
    hasTaskTarget
    && taskCompletionAmount > 0
    && amountDone > taskCompletionAmount
    && keepsSameTaskTarget
  );
  const compactPreset = Boolean(preset && !session && hasTaskTarget);
  const detailSummary = [
    completed ? '完了' : '途中',
    (material || task) ? `${amountDone}${material?.unit ?? ''}` : null,
    focus ? `集中度${focus}` : null,
    memo.trim() ? 'メモあり' : null,
  ].filter(Boolean).join('・');

  const recordDetails = (
    <>
      {hasTaskTarget && (
        <div className="field">
          <label>このタスクは終わった?</label>
          <Segmented
            ariaLabel="タスク完了"
            options={[
              { value: 'yes', label: '✓ 完了した' },
              { value: 'no', label: '途中まで' },
            ]}
            value={completed ? 'yes' : 'no'}
            onChange={(v) => updateCompleted(v === 'yes')}
          />
        </div>
      )}

      {(material || task || session?.materialId) && (
        <div className="field">
          <label>
            {material ? `今回やった${material.unit}数` : '今回やった量'}
            {quota > 0 && <span style={{ fontWeight: 500 }}> ・今日の目安 {quota}{material?.unit}</span>}
          </label>
          <NumericInput
            value={amountDone}
            min={0}
            max={remainingAmount}
            placeholder={`例: ${quota || task?.amount || 10}`}
            onChange={updateAmountDone}
            ariaLabel="今回やった量"
          />
          {exceedsOriginalTaskAmount && (
            <div className="field-hint">予定の{taskCompletionAmount}{material?.unit ?? ''}を超えた分もこの完了記録へ反映し、残り予定を再計算します。</div>
          )}
        </div>
      )}

      <div className="field">
        <label>集中度</label>
        <Rating value={focus} onChange={setFocus} icon="🔥" label="集中度" />
      </div>

      {showMemo ? (
        <div className="field">
          <label htmlFor="rec-memo">メモ</label>
          <textarea id="rec-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="気づいたこと、ミスの原因など" />
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMemo(true)}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> メモを追加
        </button>
      )}
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={session ? '学習記録を編集' : preset?.source === 'timer' ? 'おつかれさま!記録しよう' : '勉強を記録'}>
      {(!preset || session) && (
        <>
          {!session && recentTargets.length > 0 && (
            <div className="field">
              <label>最近使った教材</label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {recentTargets.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ minWidth: 0, maxWidth: '100%' }}
                    onClick={() => {
                      setSubjectId(target.subjectId);
                      setMaterialId(target.materialId);
                      setMinutes(target.minutes);
                      setAmountDone(0);
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.label}</span>
                    <span className="faint">{target.subjectName}・{target.minutes}分</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="rec-subject">科目</label>
            <select
              id="rec-subject"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setMaterialId('');
                setAmountDone(0);
              }}
            >
              {missingSubject && <option value={missingSubject.id}>{missingSubject.label}</option>}
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rec-material">教材(任意)</label>
            <select id="rec-material" value={materialId} onChange={(e) => { setMaterialId(e.target.value); setAmountDone(0); }}>
              <option value="">教材なし</option>
              {missingMaterial && <option value={missingMaterial.id}>{missingMaterial.label}</option>}
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>学習時間(分)</label>
            <Stepper value={minutes} onChange={setMinutes} step={5} min={5} max={600} suffix="分" label="学習時間" />
          </div>
          <div className="field-row">
            <div className="field"><label htmlFor="rec-date">学習日</label><input id="rec-date" type="date" value={recordDate} max={today()} onChange={(e) => setRecordDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="rec-start">開始時刻</label><input id="rec-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          </div>
        </>
      )}

      {preset && (
        <div className="card" style={{ marginBottom: 16, padding: 13 }}>
          <div className="row spread">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{preset.rangeLabel || material?.name || '学習'}</div>
              <div className="faint mt-8" aria-live="polite" aria-atomic="true">記録時間 {minutes}分</div>
            </div>
            <span className="status-badge status-accent iflex" style={{ gap: 4 }}>
              {preset.source === 'timer'
                ? <><Timer size={12} strokeWidth={2.4} aria-hidden="true" /> タイマー</>
                : <><PenLine size={12} strokeWidth={2.4} aria-hidden="true" /> 予定から記録</>}
            </span>
          </div>
          {preset.source === 'timer' && !session && (
            <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
              <label htmlFor="rec-timer-minutes">記録する学習時間</label>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label="記録する学習時間を5分減らす"
                  disabled={minutes <= 1}
                  onClick={() => setMinutes(Math.max(1, minutes - 5))}
                >
                  −5分
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <NumericInput
                    id="rec-timer-minutes"
                    value={minutes}
                    min={1}
                    max={600}
                    onChange={setMinutes}
                    ariaLabel="記録する学習時間（分）"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label="記録する学習時間を5分増やす"
                  disabled={minutes >= 600}
                  onClick={() => setMinutes(Math.min(600, minutes + 5))}
                >
                  ＋5分
                </button>
              </div>
              <div className="field-hint">計測時間 {preset.minutes}分。実際の学習時間に合わせて1〜600分で変更できます。</div>
              {minutes !== preset.minutes && (
                <button type="button" className="btn btn-ghost btn-sm mt-8" onClick={() => setMinutes(preset.minutes)}>
                  計測値に戻す
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {compactPreset ? (
        <Disclosure title="必要なら内容を変更" summary={detailSummary}>
          {recordDetails}
        </Disclosure>
      ) : recordDetails}

      <button type="button" className="btn btn-primary btn-block mt-16" onClick={save}>
        {session ? 'この記録を更新' : compactPreset ? 'この内容で保存' : '保存する'}
      </button>
      {session && (
        <button type="button" className="btn btn-danger btn-block mt-12" onClick={remove}>この記録を削除</button>
      )}
    </Sheet>
  );
}
