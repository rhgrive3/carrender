import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Segmented } from '../ui/bits';
import { useApp } from '../../state/AppContext';
import { useTimer } from './TimerContext';
import type { TimerMode } from '../../types';

/**
 * タスクに紐づかないフリータイマー(YPT式)。
 * 科目を選ぶだけですぐ計測を始められ、終了後は通常の記録フローに乗る。
 */
export function QuickStartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useApp();
  const timer = useTimer();
  const [subjectId, setSubjectId] = useState(state.subjects[0]?.id ?? '');
  const [materialId, setMaterialId] = useState('');
  const [mode, setMode] = useState<TimerMode>(state.settings.timer.defaultMode);

  const materials = useMemo(
    () => state.materials.filter((m) => !m.archived && !m.paused && m.subjectId === subjectId),
    [state.materials, subjectId],
  );
  const subject = state.subjects.find((s) => s.id === subjectId);
  const material = state.materials.find((m) => m.id === materialId);

  const start = () => {
    if (!subject) return;
    timer.start(
      {
        taskId: null,
        subjectId: subject.id,
        materialId: materialId || null,
        title: material ? material.name : `${subject.name}の学習`,
        rangeLabel: material ? 'フリー学習' : '自由に学習',
      },
      mode,
    );
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="フリータイマー">
      <p className="muted" style={{ marginBottom: 14, lineHeight: 1.6 }}>
        計画にないことを勉強する時はここから。科目を選んですぐ開始できます。
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
              style={subjectId === s.id ? { background: `${s.color}26`, color: s.color, borderColor: s.color } : undefined}
              onClick={() => {
                setSubjectId(s.id);
                setMaterialId('');
              }}
            >
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
        <label>タイマー</label>
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
        <Play size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> 開始する
      </button>
    </Sheet>
  );
}
