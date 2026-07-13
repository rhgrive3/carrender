import { useMemo, useState } from 'react';
import { Plus, Timer } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { NumericInput, Rating, Segmented, Stepper } from '../ui/bits';
import { resolveSessionProgress, useApp } from '../../state/AppContext';
import { useToast } from '../ui/Toast';
import { todayQuotaFor } from '../../lib/analytics';
import { minutesToHM, today } from '../../lib/date';
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
  const [startTime, setStartTime] = useState(() => session
    ? new Date(session.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : minutesToHM(new Date().getHours() * 60 + new Date().getMinutes()));

  const materials = useMemo(
    () => state.materials.filter((m) => (!m.archived || m.id === session?.materialId) && m.subjectId === subjectId),
    [session?.materialId, state.materials, subjectId],
  );
  const selectedMaterialId = preset && !session ? preset.materialId : (materialId || null);
  const material = state.materials.find((m) => m.id === selectedMaterialId);
  const quota = material ? todayQuotaFor(state, material.id, today()) : 0;
  const remainingAmount = useMemo(() => {
    if (!material) return task?.amount ?? 9999;
    const remaining = resolveSessionProgress(state, {
      taskId: preset?.taskId ?? null,
      subjectId,
      materialId: material.id,
      minutes,
      amountDone: Number.MAX_SAFE_INTEGER,
      focus: null,
      memo: '',
      source: preset?.source ?? 'manual',
      rangeLabel: preset?.rangeLabel ?? '',
      completedTask: false,
    }).amountDone;
    // 編集対象自身が加えた範囲は保存時に一度取り消されるため、現在の残量だけで
    // maxを決めると同じ値すら再入力できない。旧形式も現在量までは失わない。
    return session?.materialId === material.id ? Math.max(remaining, session.amountDone) : remaining;
  }, [material, minutes, preset?.rangeLabel, preset?.source, preset?.taskId, session, state, subjectId, task?.amount]);

  const save = () => {
    if (!subjectId) {
      toast('科目を選択してください');
      return;
    }
    if ((!preset || session) && recordDate > today()) {
      toast('未来日の記録は追加できません');
      return;
    }
    const preservesTask = !session || (session.subjectId === subjectId && session.materialId === selectedMaterialId);
    const input = {
        taskId: preservesTask ? session?.taskId ?? preset?.taskId ?? null : null,
        subjectId,
        materialId: selectedMaterialId,
        minutes: Math.max(1, minutes),
        amountDone,
        focus,
        memo,
        source: session?.source ?? preset?.source ?? 'manual',
        rangeLabel: session?.rangeLabel ?? preset?.rangeLabel ?? material?.name ?? '',
        completedTask: Boolean(preservesTask && (session?.taskId ?? preset?.taskId) && completed),
        taskLocator: preset?.taskLocator,
        date: preset && !session ? undefined : recordDate,
        startTime: preset && !session ? undefined : startTime,
    };
    const result = session
      ? execute({ type: 'UPDATE_SESSION', sessionId: session.id, input })
      : execute({ type: 'RECORD_SESSION', input });
    if (!result.changed) { toast(result.message ?? '記録を保存できませんでした'); return; }
    toast(result.message ?? (session ? '記録を更新しました' : '記録を保存しました 🎉'));
    onDone?.();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={session ? '学習記録を編集' : preset?.source === 'timer' ? 'おつかれさま!記録しよう' : '勉強を記録'}>
      {/* タイマー経由でない場合のみ科目・教材・時間を聞く */}
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
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rec-material">教材(任意)</label>
            <select id="rec-material" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">教材なし</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
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

      {(material || task) && (
        <div className="field">
          <label>
            どこまで進んだ?{material ? `(${material.unit}数)` : ''}
            {quota > 0 && <span style={{ fontWeight: 500 }}> ・今日の目安 {quota}{material?.unit}</span>}
          </label>
          <NumericInput
            value={amountDone}
            min={0}
            max={remainingAmount}
            placeholder={`例: ${quota || task?.amount || 10}`}
            onChange={setAmountDone}
            ariaLabel="完了量"
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
