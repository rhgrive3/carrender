import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { Material } from '../types';
import { addDays, diffDays, formatDateShort, genId, today } from '../lib/date';
import { computeMaterialForecast, todayQuotaFor } from '../lib/analytics';
import { ProgressBar, EmptyState, Rating, NumericInput, Segmented } from '../components/ui/bits';
import { Sheet } from '../components/ui/Sheet';
import { useToast } from '../components/ui/Toast';
import { UNIT_OPTIONS } from '../data/defaults';

const FORECAST_UI = {
  ahead: { label: '余裕', cls: 'status-ok' },
  onTrack: { label: '順調', cls: 'status-ok' },
  behind: { label: '遅れ', cls: 'status-warn' },
  risk: { label: '危険', cls: 'status-danger' },
} as const;

const DEADLINE_LABEL: Record<Material['deadlinePolicy'], string> = {
  strict: '期限厳守',
  normal: 'できれば',
  flexible: '余裕があれば',
};

const PHASE_LABEL: Record<Material['phase'], string> = {
  first: '1周目',
  second: '2周目',
  correction: '間違い直し',
  review: '復習',
};

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
        <div className="materials-grid">
        {materials.map((m) => {
          const subject = state.subjects.find((s) => s.id === m.subjectId);
          const forecast = computeMaterialForecast(state, m.id, t);
          const rate = m.totalAmount > 0 ? m.doneAmount / m.totalAmount : 0;
          const quota = todayQuotaFor(state, m.id, t);
          const fu = FORECAST_UI[forecast?.status ?? 'onTrack'];
          const done = m.doneAmount >= m.totalAmount;
          const daysLeft = diffDays(t, m.targetDate);
          const requiredWeekly = forecast ? Math.ceil(forecast.requiredPacePerDay * 7) : 0;
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
                  {m.paused && <span className="status-badge status-warn">一時停止</span>}
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
              <div className="material-metrics mt-8">
                <span>期限まで {daysLeft < 0 ? `${Math.abs(daysLeft)}日超過` : `${daysLeft}日`}</span>
                <span>{forecast ? `必要 ${forecast.requiredPacePerDay}${m.unit}/日` : '必要量計算中'}</span>
                <span>{requiredWeekly > 0 ? `${requiredWeekly}${m.unit}/週` : '週目標なし'}</span>
                <span>{DEADLINE_LABEL[m.deadlinePolicy]}</span>
              </div>
              {forecast && forecast.status !== 'ahead' && forecast.status !== 'onTrack' && forecast.projectedFinishDate && (
                <div className="faint mt-8">
                  現在ペースの完了見込み {formatDateShort(forecast.projectedFinishDate)}({forecast.delayDays > 0 ? `${forecast.delayDays}日遅れ` : '前倒し'})
                </div>
              )}
            </div>
          );
        })}
        </div>
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
  const [startDate, setStartDate] = useState(material?.startDate ?? t);
  const [targetDate, setTargetDate] = useState(material?.targetDate ?? (state.goal ? state.goal.examDate : addDays(t, 60)));
  const [minutesPerUnit, setMinutesPerUnit] = useState(material?.minutesPerUnit ?? 10);
  const [priority, setPriority] = useState<Material['priority']>(material?.priority ?? 3);
  const [difficulty, setDifficulty] = useState<Material['difficulty']>(material?.difficulty ?? 3);
  const [dailyTarget, setDailyTarget] = useState(material?.dailyTarget ?? 0);
  const [weeklyTarget, setWeeklyTarget] = useState(material?.weeklyTarget ?? 0);
  const [phase, setPhase] = useState<Material['phase']>(material?.phase ?? 'first');
  const [deadlinePolicy, setDeadlinePolicy] = useState<Material['deadlinePolicy']>(material?.deadlinePolicy ?? 'normal');
  const [examRelevance, setExamRelevance] = useState<Material['examRelevance']>(material?.examRelevance ?? 3);
  const [reviewEnabled, setReviewEnabled] = useState(material?.reviewEnabled ?? true);
  const [reviewIntervalsText, setReviewIntervalsText] = useState((material?.reviewIntervals ?? state.settings.reviewRule.intervals).join(', '));
  const [paused, setPaused] = useState(material?.paused ?? false);
  const [archived, setArchived] = useState(material?.archived ?? false);
  const [round, setRound] = useState(material?.round ?? 1);

  const save = () => {
    if (!name.trim() || !subjectId || totalAmount <= 0) {
      toast('教材名・科目・総量を入力してください');
      return;
    }
    const reviewIntervals = reviewIntervalsText
      .split(',')
      .map((x) => Math.max(1, Number.parseInt(x.trim(), 10)))
      .filter((x) => Number.isFinite(x));
    const payload: Material = {
      id: material?.id ?? genId('mat'),
      subjectId,
      name: name.trim(),
      unit,
      totalAmount,
      doneAmount: Math.min(doneAmount, totalAmount),
      startDate,
      targetDate,
      priority,
      difficulty,
      minutesPerUnit: Math.max(0.1, minutesPerUnit),
      dailyTarget: dailyTarget > 0 ? dailyTarget : null,
      weeklyTarget: weeklyTarget > 0 ? weeklyTarget : null,
      phase,
      deadlinePolicy,
      examRelevance,
      reviewEnabled,
      reviewIntervals: reviewIntervals.length > 0 ? reviewIntervals : state.settings.reviewRule.intervals,
      paused,
      round: phase === 'second' ? 2 : phase === 'first' ? 1 : round,
      lastStudiedAt: material?.lastStudiedAt ?? null,
      nextReviewAt: material?.nextReviewAt ?? null,
      archived,
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
          <NumericInput
            id="mf-total"
            value={totalAmount}
            min={1}
            placeholder="例: 300"
            onChange={(v) => setTotalAmount(Math.max(0, v))}
          />
        </div>
        <div className="field">
          <label htmlFor="mf-done">終わった量</label>
          <NumericInput
            id="mf-done"
            value={doneAmount}
            min={0}
            placeholder="例: 40"
            onChange={(v) => setDoneAmount(Math.max(0, v))}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mf-start">開始日</label>
          <input id="mf-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mf-target">目標完了日</label>
          <input id="mf-target" type="date" value={targetDate} min={t} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mf-mpu">1{unit}あたりの分数</label>
          <NumericInput
            id="mf-mpu"
            decimal
            step={0.5}
            value={minutesPerUnit}
            min={0.1}
            placeholder="例: 12"
            onChange={(v) => setMinutesPerUnit(v)}
          />
        </div>
        <div className="field">
          <label htmlFor="mf-daily">1日の目標量</label>
          <NumericInput
            id="mf-daily"
            decimal
            value={dailyTarget}
            min={0}
            placeholder="例: 5"
            onChange={(v) => setDailyTarget(v)}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mf-weekly">1週間の目標量</label>
          <NumericInput
            id="mf-weekly"
            decimal
            value={weeklyTarget}
            min={0}
            placeholder="例: 35"
            onChange={(v) => setWeeklyTarget(v)}
          />
        </div>
        <div className="field">
          <label htmlFor="mf-deadline">期限ポリシー</label>
          <select id="mf-deadline" value={deadlinePolicy} onChange={(e) => setDeadlinePolicy(e.target.value as Material['deadlinePolicy'])}>
            <option value="strict">期限厳守</option>
            <option value="normal">できれば</option>
            <option value="flexible">余裕があれば</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>フェーズ</label>
        <Segmented
          ariaLabel="教材フェーズ"
          options={[
            { value: 'first', label: PHASE_LABEL.first },
            { value: 'second', label: PHASE_LABEL.second },
            { value: 'correction', label: PHASE_LABEL.correction },
            { value: 'review', label: PHASE_LABEL.review },
          ]}
          value={phase}
          onChange={setPhase}
        />
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
        <label>試験重要度</label>
        <Rating value={examRelevance} onChange={(v) => setExamRelevance(v)} icon="◆" label="試験重要度" />
      </div>
      <div className="field">
        <label className="check-row">
          <input type="checkbox" checked={reviewEnabled} onChange={(e) => setReviewEnabled(e.target.checked)} />
          復習タスクを自動生成する
        </label>
      </div>
      {reviewEnabled && (
        <div className="field">
          <label htmlFor="mf-review-intervals">復習間隔(日・カンマ区切り)</label>
          <input id="mf-review-intervals" value={reviewIntervalsText} onChange={(e) => setReviewIntervalsText(e.target.value)} placeholder="例: 1, 3, 7, 14, 30" />
        </div>
      )}
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
      <div className="field-row">
        <label className="check-row">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          一時停止
        </label>
        <label className="check-row">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          完了/非表示
        </label>
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
