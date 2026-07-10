import { useMemo, useState } from 'react';
import { Plus, Timer } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { NumericInput, Rating, Segmented, Stepper } from '../ui/bits';
import { resolveSessionProgress, useApp } from '../../state/AppContext';
import { useToast } from '../ui/Toast';
import { todayQuotaFor } from '../../lib/analytics';
import { today } from '../../lib/date';

export interface RecordPreset {
  taskId: string | null;
  subjectId: string;
  materialId: string | null;
  minutes: number;
  rangeLabel: string;
  source: 'timer' | 'manual';
}

interface RecordSheetProps {
  open: boolean;
  onClose: () => void;
  preset?: RecordPreset;
  onDone?: () => void;
}

/**
 * 勉強記録シート。タイマー終了直後は最小限の入力(進んだ量・集中度)で保存できる。
 */
export function RecordSheet({ open, onClose, preset, onDone }: RecordSheetProps) {
  const { state, dispatch } = useApp();
  const toast = useToast();

  const [subjectId, setSubjectId] = useState(preset?.subjectId ?? state.subjects[0]?.id ?? '');
  const [materialId, setMaterialId] = useState<string>(preset?.materialId ?? '');
  const [minutes, setMinutes] = useState(preset?.minutes ?? 30);
  const task = preset?.taskId ? state.tasks.find((t) => t.id === preset.taskId) : undefined;
  const [amountDone, setAmountDone] = useState(() => task?.amount ?? 0);
  const [completed, setCompleted] = useState(true);
  const [focus, setFocus] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [memo, setMemo] = useState('');
  const [showMemo, setShowMemo] = useState(false);

  const materials = useMemo(
    () => state.materials.filter((m) => !m.archived && m.subjectId === subjectId),
    [state.materials, subjectId],
  );
  const material = state.materials.find((m) => m.id === (preset?.materialId ?? materialId));
  const quota = material ? todayQuotaFor(state, material.id, today()) : 0;
  const remainingAmount = useMemo(() => {
    if (!material) return task?.amount ?? 9999;
    return resolveSessionProgress(state, {
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
  }, [material, minutes, preset?.rangeLabel, preset?.source, preset?.taskId, state, subjectId, task?.amount]);

  const save = () => {
    if (!subjectId) {
      toast('科目を選択してください');
      return;
    }
    dispatch({
      type: 'RECORD_SESSION',
      input: {
        taskId: preset?.taskId ?? null,
        subjectId,
        materialId: preset?.materialId ?? (materialId || null),
        minutes: Math.max(1, minutes),
        amountDone,
        focus,
        memo,
        source: preset?.source ?? 'manual',
        rangeLabel: preset?.rangeLabel ?? material?.name ?? '',
        completedTask: !!preset?.taskId && completed,
      },
    });
    toast('記録を保存しました 🎉');
    onDone?.();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={preset?.source === 'timer' ? 'おつかれさま!記録しよう' : '勉強を記録'}>
      {/* タイマー経由でない場合のみ科目・教材・時間を聞く */}
      {!preset && (
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

      {preset?.taskId && (
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
        保存する
      </button>
    </Sheet>
  );
}
