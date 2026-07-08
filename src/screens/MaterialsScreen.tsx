import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { Material } from '../types';
import { addDays, formatDateShort, genId, today } from '../lib/date';
import { computeMaterialForecast, todayQuotaFor } from '../lib/analytics';
import { ProgressBar, EmptyState, Rating } from '../components/ui/bits';
import { Sheet } from '../components/ui/Sheet';
import { useToast } from '../components/ui/Toast';
import { UNIT_OPTIONS } from '../data/defaults';

const FORECAST_UI = {
  ahead: { label: '余裕', cls: 'status-ok' },
  onTrack: { label: '順調', cls: 'status-ok' },
  behind: { label: '遅れ', cls: 'status-warn' },
  risk: { label: '危険', cls: 'status-danger' },
} as const;

export function MaterialsScreen() {
  const { state } = useApp();
  const t = today();
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const materials = useMemo(
    () =>
      [...state.materials]
        .filter((m) => !m.archived)
        .sort((a, b) => {
          const fa = computeMaterialForecast(state, a.id, t);
          const fb = computeMaterialForecast(state, b.id, t);
          const order = { risk: 0, behind: 1, onTrack: 2, ahead: 3 };
          return order[fa?.status ?? 'onTrack'] - order[fb?.status ?? 'onTrack'];
        }),
    [state, t],
  );

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">教材</div>
          <div className="screen-sub">{materials.length}冊を管理中</div>
        </div>
        <button className="icon-btn" aria-label="教材を追加" onClick={() => setAddOpen(true)}>
          ＋
        </button>
      </div>

      {materials.length === 0 ? (
        <EmptyState icon="📚" title="教材がまだありません">
          「＋」から教材を追加すると、試験日までの計画を自動で作ります。
        </EmptyState>
      ) : (
        materials.map((m) => {
          const subject = state.subjects.find((s) => s.id === m.subjectId);
          const forecast = computeMaterialForecast(state, m.id, t);
          const rate = m.totalAmount > 0 ? m.doneAmount / m.totalAmount : 0;
          const quota = todayQuotaFor(state, m.id, t);
          const fu = FORECAST_UI[forecast?.status ?? 'onTrack'];
          const done = m.doneAmount >= m.totalAmount;
          return (
            <div className="card" key={m.id}>
              <div className="row spread">
                <div className="task-meta-row" style={{ marginBottom: 0 }}>
                  <span className="subject-chip" style={{ background: `${subject?.color}26`, color: subject?.color }}>
                    {subject?.name}
                  </span>
                  {done ? (
                    <span className="status-badge status-ok">🏆 完了</span>
                  ) : (
                    <span className={`status-badge ${fu.cls}`}>{fu.label}</span>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditTarget(m)} aria-label={`${m.name}の詳細を開く`}>
                  詳細
                </button>
              </div>

              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{m.name}</div>
              <div className="row mt-8" style={{ gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <ProgressBar value={rate} color={subject?.color} />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{Math.round(rate * 100)}%</span>
              </div>
              <div className="row spread mt-8">
                <span className="muted">
                  残り {Math.max(0, m.totalAmount - m.doneAmount)}
                  {m.unit}
                  {!done && quota > 0 && ` ・ 今日の目安 ${quota}${m.unit}`}
                </span>
                <span className="faint">目標 {formatDateShort(m.targetDate)}</span>
              </div>
              {forecast && forecast.status !== 'ahead' && forecast.status !== 'onTrack' && forecast.projectedFinishDate && (
                <div className="faint mt-8">
                  現在ペースの完了見込み {formatDateShort(forecast.projectedFinishDate)}({forecast.delayDays > 0 ? `${forecast.delayDays}日遅れ` : '前倒し'})
                </div>
              )}
            </div>
          );
        })
      )}

      {(addOpen || editTarget) && (
        <MaterialFormSheet material={editTarget} onClose={() => (editTarget ? setEditTarget(null) : setAddOpen(false))} />
      )}
    </div>
  );
}

// ============================================================
// 教材追加・編集フォーム
// ============================================================

export function MaterialFormSheet({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const t = today();
  const isEdit = material !== null;

  const [name, setName] = useState(material?.name ?? '');
  const [subjectId, setSubjectId] = useState(material?.subjectId ?? state.subjects[0]?.id ?? '');
  const [unit, setUnit] = useState<Material['unit']>(material?.unit ?? '問題');
  const [totalAmount, setTotalAmount] = useState(material?.totalAmount ?? 100);
  const [doneAmount, setDoneAmount] = useState(material?.doneAmount ?? 0);
  const [targetDate, setTargetDate] = useState(material?.targetDate ?? (state.goal ? state.goal.examDate : addDays(t, 60)));
  const [minutesPerUnit, setMinutesPerUnit] = useState(material?.minutesPerUnit ?? 10);
  const [priority, setPriority] = useState<Material['priority']>(material?.priority ?? 3);
  const [difficulty, setDifficulty] = useState<Material['difficulty']>(material?.difficulty ?? 3);
  const [round, setRound] = useState(material?.round ?? 1);

  const save = () => {
    if (!name.trim() || !subjectId || totalAmount <= 0) {
      toast('教材名・科目・総量を入力してください');
      return;
    }
    const payload: Material = {
      id: material?.id ?? genId('mat'),
      subjectId,
      name: name.trim(),
      unit,
      totalAmount,
      doneAmount: Math.min(doneAmount, totalAmount),
      targetDate,
      priority,
      difficulty,
      minutesPerUnit: Math.max(0.1, minutesPerUnit),
      round,
      lastStudiedAt: material?.lastStudiedAt ?? null,
      nextReviewAt: material?.nextReviewAt ?? null,
      archived: false,
      createdAt: material?.createdAt ?? new Date().toISOString(),
    };
    dispatch({ type: isEdit ? 'UPDATE_MATERIAL' : 'ADD_MATERIAL', material: payload });
    toast(isEdit ? '教材を更新して計画を再計算しました' : '教材を追加して計画を再計算しました');
    onClose();
  };

  const remove = () => {
    if (!material) return;
    if (!window.confirm(`「${material.name}」を削除しますか?関連する未完了タスクも消えます。`)) return;
    dispatch({ type: 'DELETE_MATERIAL', materialId: material.id });
    toast('教材を削除しました');
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={isEdit ? '教材を編集' : '教材を追加'}>
      <div className="field">
        <label htmlFor="mf-name">教材名</label>
        <input id="mf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 青チャート 例題" />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mf-subject">科目</label>
          <select id="mf-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {state.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mf-unit">単位</label>
          <select id="mf-unit" value={unit} onChange={(e) => setUnit(e.target.value as Material['unit'])}>
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mf-total">総量({unit})</label>
          <input
            id="mf-total"
            type="number"
            inputMode="numeric"
            value={totalAmount}
            min={1}
            onChange={(e) => setTotalAmount(Math.max(0, Number(e.target.value)))}
          />
        </div>
        <div className="field">
          <label htmlFor="mf-done">終わった量</label>
          <input
            id="mf-done"
            type="number"
            inputMode="numeric"
            value={doneAmount}
            min={0}
            onChange={(e) => setDoneAmount(Math.max(0, Number(e.target.value)))}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mf-target">目標完了日</label>
          <input id="mf-target" type="date" value={targetDate} min={t} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mf-mpu">1{unit}あたりの分数</label>
          <input
            id="mf-mpu"
            type="number"
            inputMode="decimal"
            step="0.5"
            value={minutesPerUnit}
            min={0.1}
            onChange={(e) => setMinutesPerUnit(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="field">
        <label>優先度</label>
        <Rating value={priority} onChange={(v) => setPriority(v)} icon="⚑" label="優先度" />
      </div>
      <div className="field">
        <label>難易度(高いほど復習を増やします)</label>
        <Rating value={difficulty} onChange={(v) => setDifficulty(v)} icon="💪" label="難易度" />
      </div>
      <div className="field">
        <label>周回</label>
        <div className="segmented" role="radiogroup" aria-label="周回">
          {[1, 2, 3].map((r) => (
            <button key={r} type="button" role="radio" aria-checked={round === r} className={round === r ? 'active' : ''} onClick={() => setRound(r)}>
              {r}周目
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-primary btn-block" onClick={save}>
        {isEdit ? '保存して再計算' : '追加して計画に反映'}
      </button>
      {isEdit && (
        <button className="btn btn-danger btn-block mt-8" onClick={remove}>
          この教材を削除
        </button>
      )}
    </Sheet>
  );
}
