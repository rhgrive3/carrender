import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Timer } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { NumericInput, Rating, Segmented, Stepper } from '../ui/bits';
import { useApp } from '../../state/AppContext';
import { useToast } from '../ui/Toast';
import { todayQuotaFor } from '../../lib/analytics';
import { APP_TIME_ZONE, localDateTimeToISOString, minutesInTimeZone, minutesToHM, today } from '../../lib/date';
import { missingRecordMaterialOption, missingRecordSubjectOption } from '../../lib/recordReferences';
import { applyRecordSessionTransaction } from '../../lib/recordSessionTransaction';
import { recordAmountInputLimit } from '../../lib/recordEditCapacity';
import type { StudySession } from '../../types';

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

/**
 * 勉強記録シート。タイマー終了直後は最小限の入力(進んだ量・集中度)で保存できる。
 */
export function RecordSheet({ open, onClose, preset, onDone, session }: RecordSheetProps) {
  const { state, execute } = useApp();
  const toast = useToast();

  const [subjectId, setSubjectId] = useState(session?.subjectId ?? preset?.subjectId ?? state.subjects[0]?.id ?? '');
  const [materialId, setMaterialId] = useState<string>(session?.materialId ?? preset?.materialId ?? '');
  const [minutes, setMinutes] = useState(session?.minutes ?? preset?.minutes ?? 30);
  const taskId = session?.taskId ?? preset?.taskId;
  const task = taskId ? state.tasks.find((t) => t.id === taskId) ?? session?.taskSnapshotBefore : undefined;
  const [amountDone, setAmountDone] = useState(() => session?.amountDone ?? task?.amount ?? 0);
  const [completed, setCompleted] = useState(session ? (session.completedTask ?? Boolean(session.taskId && !session.replacementTaskIds?.length)) : true);
  const [focus, setFocus] = useState<1 | 2 | 3 | 4 | 5 | null>(session?.focus ?? null);
  const [memo, setMemo] = useState(session?.memo ?? '');
  const [showMemo, setShowMemo] = useState(Boolean(session?.memo));
  const [recordDate, setRecordDate] = useState(session?.date ?? today());
  const [startTime, setStartTime] = useState(() => sessionStartTime(session));
  const initializedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedTargetRef.current = null;
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
    return recordAmountInputLimit(
      state,
      material.id,
      keepsEditedReference ? session : undefined,
      session && !keepsEditedReference ? undefined : task,
    );
  }, [material, session, state, subjectId, task]);

  useEffect(() => {
    if (!open) return;
    // 教材・科目の変更で上限が下がった場合、表示値と保存時の実量を一致させる。
    // NumericInputのmaxは次の入力だけを制限するため、親stateもここで補正する必要がある。
    setAmountDone((current) => Math.min(remainingAmount, Math.max(0, current)));
  }, [open, remainingAmount, selectedMaterialId]);

  const save = () => {
    if (!subjectId) {
      toast('科目を選択してください');
      return;
    }
    let resolvedStartedAt: string | null = null;
    if (!preset || session) {
      try {
        resolvedStartedAt = localDateTimeToISOString(recordDate, startTime);
      } catch {
        toast('学習日と開始時刻を正しく入力してください');
        return;
      }
      if (recordDate > today()) {
        toast('未来日の記録は追加できません');
        return;
      }
      // 今日の手入力・編集で未来時刻を許すと、学習ログが未来の記録として並び時系列が壊れる。
      if (recordDate === today() && resolvedStartedAt > new Date().toISOString()) {
        toast('未来の開始時刻は指定できません');
        return;
      }
    }
    const preservesReference = !session || (session.subjectId === subjectId && session.materialId === selectedMaterialId);
    const input = {
      taskId: preservesReference ? session?.taskId ?? preset?.taskId ?? null : null,
      subjectId,
      materialId: selectedMaterialId,
      minutes: Math.max(1, minutes),
      amountDone,
      focus,
      memo,
      source: session?.source ?? preset?.source ?? 'manual',
      // 教材・科目を変更した編集では旧教材の表示名を残さず、検索・履歴表示も新しい参照へ同期する。
      rangeLabel: preservesReference
        ? session?.rangeLabel ?? preset?.rangeLabel ?? material?.name ?? ''
        : material?.name ?? '',
      completedTask: Boolean(preservesReference && (session?.taskId ?? preset?.taskId) && completed),
      taskLocator: preset?.taskLocator,
      date: preset && !session ? undefined : recordDate,
      startTime: preset && !session ? undefined : startTime,
    };
    const action = session
      ? ({ type: 'UPDATE_SESSION' as const, sessionId: session.id, input })
      : ({ type: 'RECORD_SESSION' as const, input });
    const tasklessMaterialRecord = Boolean(input.materialId && !input.taskId && !input.taskLocator?.sourceId);
    // 自由記録は今回分の個数として加算する。当日の古い自動タスクを保護したままにせず、
    // 記録反映後の残量から今日以降を再計画して「完了済み範囲と重複」を発生させない。
    const result = tasklessMaterialRecord
      ? execute({ type: 'REPLACE_STATE', state: applyRecordSessionTransaction(state, action, today()) })
      : execute(action);
    if (!result.changed) { toast(result.message ?? '記録を保存できませんでした'); return; }
    toast(result.message ?? (session ? '記録を更新しました' : '記録を保存しました 🎉'));
    onDone?.();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={session ? '学習記録を編集' : preset?.source === 'timer' ? 'おつかれさま!記録しよう' : '勉強を記録'}>
      {(!preset || session) && (
        <>
          <div className="field">
            <label htmlFor="rec-subject">科目</label>
            <select
              id="rec-subject"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setMaterialId('');
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
            <select id="rec-material" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">教材なし</option>
              {missingMaterial && <option value={missingMaterial.id}>{missingMaterial.label}</option>}
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>学習時間(分)</label>
            <Stepper value={minutes} onChange={setMinutes} step={5} min={5} max={600} suffix="分" />
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
              <div className="faint mt-8">学習時間 {preset.minutes}分</div>
            </div>
            <span className="status-badge status-accent iflex" style={{ gap: 4 }}>
              <Timer size={12} strokeWidth={2.4} aria-hidden="true" /> タイマー
            </span>
          </div>
        </div>
      )}

      {(preset?.taskId || session?.taskId) && (
        <div className="field">
          <label>このタスクは終わった?</label>
          <Segmented
            ariaLabel="タスク完了"
            options={[
              { value: 'yes', label: '✓ 完了した' },
              { value: 'no', label: '途中まで' },
            ]}
            value={completed ? 'yes' : 'no'}
            onChange={(v) => setCompleted(v === 'yes')}
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
            onChange={setAmountDone}
            ariaLabel="今回やった量"
          />
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
        <button className="btn btn-ghost btn-sm" onClick={() => setShowMemo(true)}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> メモを追加
        </button>
      )}

      <button className="btn btn-primary btn-block mt-16" onClick={save}>
        {session ? 'この記録を更新' : '保存する'}
      </button>
      {session && (
        <button className="btn btn-danger btn-block mt-12" onClick={() => {
          if (!window.confirm('この学習記録を削除しますか？教材進捗と復習タスクも再計算されます。')) return;
          const result = execute({ type: 'DELETE_SESSION', sessionId: session.id });
          if (!result.changed) { toast(result.message ?? '記録を削除できませんでした'); return; }
          toast(result.message ?? '記録を削除して進捗を再計算しました');
          onClose();
        }}>この記録を削除</button>
      )}
    </Sheet>
  );
}
