import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Segmented } from '../ui/bits';
import { useApp } from '../../state/AppContext';
import { useTimer } from './TimerContext';
import { useToast } from '../ui/Toast';
import type { TimerMode } from '../../types';

/**
 * タスクに紐づかないフリータイマー(YPT式)。
 * 科目を選ぶだけですぐ計測を始められ、終了後は通常の記録フローに乗る。
 */
export function QuickStartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useApp();
  const timer = useTimer();
  const toast = useToast();
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? '');
  const [materialId, setMaterialId] = useState('');
  const [mode, setMode] = useState<TimerMode>(state.settings.timer.defaultMode);

  const materials = useMemo(
    () => state.materials.filter((m) => !m.archived && !m.paused && m.subjectId === subjectId),
    [state.materials, subjectId],
  );
  const subject = state.subjects.find((s) => s.id === subjectId);
  // 選択中の科目で表示可能な教材だけを開始対象にする。
  // 教材の科目変更・休止・アーカイブが別画面で行われても、古いIDを記録へ持ち込まない。
  const material = materials.find((m) => m.id === materialId);

  useEffect(() => {
    if (!open) return;
    setSubjectId((current) => state.subjects.some((item) => item.id === current) ? current : state.subjects[0]?.id ?? '');
    setMode(state.settings.timer.defaultMode);
  }, [open, state.settings.timer.defaultMode, state.subjects]);

  useEffect(() => {
    if (!open) return;
    setMaterialId((current) => materials.some((item) => item.id === current) ? current : '');
  }, [materials, open]);

  const start = () => {
    if (!subject) return;
    const started = timer.start(
      {
        taskId: null,
        subjectId: subject.id,
        materialId: material?.id ?? null,
        title: material ? material.name : `${subject.name}の学習`,
        rangeLabel: material ? 'フリー学習' : '自由に学習',
      },
      mode,
    );
    if (!started) {
      toast(`「${timer.target?.title ?? '学習'}」を計測中です。画面下のタイマーから再開できます`);
      return;
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="今すぐ勉強" subtitle="計画にない学習も、そのまま記録できます">
      <p className="quick-start-lead">
        科目を選ぶだけですぐ計測を始めます。教材は必要な時だけ選択してください。
      </p>

      <div className="field">
        <label>科目</label>
        <div className="quick-subject-grid" role="radiogroup" aria-label="科目">
          {state.subjects.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={subjectId === s.id}
              className={`quick-subject-chip ${subjectId === s.id ? 'active' : ''}`}
              style={subjectId === s.id ? { background: `${s.color}20`, borderColor: s.color } : undefined}
              onClick={() => {
                setSubjectId(s.id);
                setMaterialId('');
              }}
            >
              <span className="quick-subject-dot" style={{ background: s.color }} aria-hidden="true" />
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {materials.length > 0 && (
        <div className="field">
          <label htmlFor="qs-material">教材(任意)</label>
          <select id="qs-material" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">教材なし</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>計測方法</label>
        <Segmented
          ariaLabel="タイマーの種類"
          options={[
            { value: 'stopwatch', label: 'ストップウォッチ' },
            { value: 'pomodoro', label: '🍅 ポモドーロ' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      <button className="btn btn-primary btn-block mt-8" disabled={!subject} onClick={start}>
        <Play size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" />
        {mode === 'pomodoro' ? `${state.settings.timer.pomodoro.workMinutes}分の集中を始める` : '計測を始める'}
      </button>
    </Sheet>
  );
}
