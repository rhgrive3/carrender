import { lazy, Suspense, useMemo, useState } from 'react';
import { ArchiveRestore, ChevronRight, Dumbbell, Flag, Pencil, Plus, Sparkles, Star } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { Material } from '../types';
import { addDays, diffDays, formatDateShort, formatMinutes, genId, today } from '../lib/date';
import { computeMaterialForecast, todayQuotaFor } from '../lib/analytics';
import { ProgressBar, EmptyState, Rating, NumericInput, Disclosure, Segmented } from '../components/ui/bits';
import { Sheet } from '../components/ui/Sheet';
import { useToast } from '../components/ui/Toast';
import { UNIT_OPTIONS } from '../data/defaults';
import { validateMaterialDates } from '../lib/materialValidation';

const MemoryFeature = lazy(async () => {
  const module = await import('../features/memory/ui/MemoryFeature');
  return { default: module.MemoryFeature };
});

const FORECAST_UI = {
  ahead: { label: '余裕', cls: 'status-ok' },
  onTrack: { label: '順調', cls: 'status-ok' },
  behind: { label: '遅れ', cls: 'status-warn' },
  risk: { label: '危険', cls: 'status-danger' },
} as const;

export type MaterialsPane = 'materials' | 'memory';

export function MaterialsScreen({
  pane = 'materials',
  onPaneChange,
}: {
  pane?: MaterialsPane;
  onPaneChange?: (pane: MaterialsPane) => void;
}) {
  const { state, execute } = useApp();
  const t = today();
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [archiveTab, setArchiveTab] = useState<'active' | 'archived'>('active');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  const materials = useMemo(() => {
    const order = { risk: 0, behind: 1, onTrack: 2, ahead: 3 };
    const rank = new Map(
      state.materials.map((m) => [m.id, order[computeMaterialForecast(state, m.id, t)?.status ?? 'onTrack']]),
    );
    return state.materials
      .filter((m) => archiveTab === 'archived' ? m.archived : !m.archived)
      .sort((a, b) => (rank.get(a.id) ?? 2) - (rank.get(b.id) ?? 2));
  }, [archiveTab, state, t]);
  const selectedMaterial = materials.find((material) => material.id === selectedMaterialId) ?? materials[0] ?? null;

  if (pane === 'memory') {
    return (
      <div className="screen memory-screen">
        <div className="screen-header memory-entry-header">
          <div><div className="screen-title">教材</div><div className="screen-sub">教材と暗記カードを管理</div></div>
        </div>
        <Segmented
          options={[{ value: 'materials', label: '教材' }, { value: 'memory', label: '暗記カード' }]}
          value={pane}
          onChange={(value) => onPaneChange?.(value)}
          ariaLabel="教材画面の切替"
        />
        <Suspense fallback={<div className="card memory-loading">暗記機能を準備しています…</div>}>
          <MemoryFeature />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">教材</div>
          <div className="screen-sub">{materials.length}冊を管理中</div>
        </div>
        <button className="icon-btn" aria-label="教材を追加" onClick={() => setAddOpen(true)}>
          <Plus size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <Segmented
        options={[{ value: 'materials', label: '教材' }, { value: 'memory', label: '暗記カード' }]}
        value={pane}
        onChange={(value) => onPaneChange?.(value)}
        ariaLabel="教材画面の切替"
      />

      <Segmented
        options={[{ value: 'active', label: '使用中' }, { value: 'archived', label: 'アーカイブ' }]}
        value={archiveTab}
        onChange={setArchiveTab}
        ariaLabel="教材の状態"
      />

      {materials.length === 0 ? (
        <EmptyState icon="📚" title="教材がまだありません">
          「＋」から教材を追加すると、試験日までの計画を自動で作ります。
        </EmptyState>
      ) : (
        <div className="materials-master-detail">
          <div className="material-list-panel" aria-label="教材一覧">
            {materials.map((material) => {
              const subject = state.subjects.find((item) => item.id === material.subjectId);
              const forecast = computeMaterialForecast(state, material.id, t);
              const rate = material.totalAmount > 0 ? material.doneAmount / material.totalAmount : 0;
              const status = material.doneAmount >= material.totalAmount ? '完了' : FORECAST_UI[forecast?.status ?? 'onTrack'].label;
              return (
                <div className={`material-list-item ${selectedMaterial?.id === material.id ? 'selected' : ''}`} key={material.id}>
                  <button type="button" onClick={() => setSelectedMaterialId(material.id)} aria-pressed={selectedMaterial?.id === material.id}>
                    <span className="subject-dot" style={{ background: subject?.color ?? 'var(--accent)' }} aria-hidden="true" />
                    <span className="material-list-copy">
                      <strong>{material.name}</strong>
                      <small>{subject?.name} · 残り{Math.max(0, material.totalAmount - material.doneAmount)}{material.unit} · 目標{formatDateShort(material.targetDate)}</small>
                      <span className="material-list-progress"><i style={{ width: `${Math.round(rate * 100)}%`, background: subject?.color }} /></span>
                    </span>
                    <span className={`material-list-state ${forecast?.status === 'risk' ? 'critical' : forecast?.status === 'behind' ? 'warning' : ''}`}>{status}</span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                  {material.archived && (
                    <button className="material-restore" aria-label={`${material.name}を復元`} onClick={() => execute({ type: 'UPDATE_MATERIAL', material: { ...material, archived: false } })}>
                      <ArchiveRestore size={17} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {selectedMaterial && <MaterialDetail material={selectedMaterial} onEdit={() => setEditTarget(selectedMaterial)} />}
        </div>
      )}

      {(addOpen || editTarget) && (
        <MaterialFormSheet material={editTarget} onClose={() => (editTarget ? setEditTarget(null) : setAddOpen(false))} />
      )}
    </div>
  );
}

function MaterialDetail({ material, onEdit }: { material: Material; onEdit: () => void }) {
  const { state } = useApp();
  const t = today();
  const subject = state.subjects.find((item) => item.id === material.subjectId);
  const forecast = computeMaterialForecast(state, material.id, t);
  const rate = material.totalAmount > 0 ? material.doneAmount / material.totalAmount : 0;
  const quota = todayQuotaFor(state, material.id, t);
  const daysLeft = diffDays(t, material.targetDate);
  const progressDeficit = state.lastScheduleResult?.progressDeficits.find((item) => item.materialId === material.id);
  const done = material.doneAmount >= material.totalAmount;

  return (
    <aside className="material-detail-panel" aria-label={`${material.name}の詳細`}>
      <div className="material-detail-head">
        <div>
          <span className="subject-chip" style={{ background: `${subject?.color}20`, color: subject?.color }}>{subject?.name}</span>
          <h2>{material.name}</h2>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onEdit}><Pencil size={14} aria-hidden="true" />編集</button>
      </div>
      <div className="material-progress-display">
        <strong>{Math.round(rate * 100)}%</strong>
        <span>{material.doneAmount} / {material.totalAmount}{material.unit}</span>
        <ProgressBar value={rate} color={subject?.color} />
      </div>
      <dl className="material-detail-metrics">
        <div><dt>期限まで</dt><dd className={daysLeft < 0 ? 'critical' : ''}>{done ? '完了' : daysLeft < 0 ? `${Math.abs(daysLeft)}日超過` : `${daysLeft}日`}</dd></div>
        <div><dt>今日の目安</dt><dd>{done ? 'なし' : quota > 0 ? `${quota}${material.unit}` : '調整中'}</dd></div>
        <div><dt>必要ペース</dt><dd>{forecast ? `${forecast.requiredPacePerDay}${material.unit}/日` : '計算中'}</dd></div>
      </dl>
      {progressDeficit && progressDeficit.units > 0 && (
        <div className="status-banner warning">
          <Flag size={18} aria-hidden="true" />
          <div className="status-banner-copy"><strong>期限に間に合わせるには、あと{progressDeficit.units}{material.unit}必要です</strong><span>学習時間の目安は{formatMinutes(progressDeficit.minutes)}です。</span></div>
        </div>
      )}
      {forecast?.projectedFinishDate && !done && (
        <div className="material-forecast-line">
          <span>現在ペースの完了見込み</span>
          <strong className={forecast.status === 'risk' ? 'critical' : forecast.status === 'behind' ? 'warning' : ''}>{formatDateShort(forecast.projectedFinishDate)}</strong>
        </div>
      )}
      {material.estimatedMinutesPerUnit && material.estimateMode !== 'fixed' && (
        <p className="material-estimate-note">実績から、1{material.unit}あたり約{material.estimatedMinutesPerUnit.toFixed(1)}分と推定しています。</p>
      )}
    </aside>
  );
}


// ============================================================
// 教材追加・編集フォーム
// ============================================================

function MaterialFormSheet({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const { state, execute } = useApp();
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
  const [preferredFinishDate, setPreferredFinishDate] = useState(material?.preferredFinishDate ?? '');
  const [minutesPerUnit, setMinutesPerUnit] = useState(material?.minutesPerUnit ?? 10);
  const [unitStep, setUnitStep] = useState(material?.unitStep ?? 1);
  const [splittable, setSplittable] = useState(material?.splittable ?? true);
  const [minimumChunkUnits, setMinimumChunkUnits] = useState(material?.minimumChunkUnits ?? 1);
  const [maximumChunkUnits, setMaximumChunkUnits] = useState(material?.maximumChunkUnits ?? 0);
  const [maxUnitsPerDay, setMaxUnitsPerDay] = useState(material?.maxUnitsPerDay ?? 0);
  const [cadence, setCadence] = useState<'auto' | 'daily' | 'timesPerWeek'>(material?.preferredCadence?.type ?? 'auto');
  const [cadenceCount, setCadenceCount] = useState(material?.preferredCadence?.type === 'timesPerWeek' ? material.preferredCadence.count : 3);
  const [estimateMode, setEstimateMode] = useState(material?.estimateMode ?? 'suggest');
  const [priority, setPriority] = useState<Material['priority']>(material?.priority ?? 3);
  const [difficulty, setDifficulty] = useState<Material['difficulty']>(material?.difficulty ?? 3);
  const [dailyTarget, setDailyTarget] = useState(material?.dailyTarget ?? 0);
  const [weeklyTarget, setWeeklyTarget] = useState(material?.weeklyTarget ?? 0);
  const [deadlinePolicy, setDeadlinePolicy] = useState<Material['deadlinePolicy']>(material?.deadlinePolicy ?? 'normal');
  const [examRelevance, setExamRelevance] = useState<Material['examRelevance']>(material?.examRelevance ?? 3);
  const [reviewEnabled, setReviewEnabled] = useState(material?.reviewEnabled ?? false);
  const [reviewIntervalsText, setReviewIntervalsText] = useState((material?.reviewIntervals ?? state.settings.reviewRule.intervals).join(', '));
  const [paused, setPaused] = useState(material?.paused ?? false);
  const [archived, setArchived] = useState(material?.archived ?? false);
  const [round, setRound] = useState(material?.round ?? 1);

  const save = () => {
    if (!name.trim() || !subjectId || totalAmount <= 0) {
      toast('教材名・科目・総量を入力してください');
      return;
    }
    const dateError = validateMaterialDates(startDate, targetDate, preferredFinishDate, state.goal?.examDate);
    if (dateError) { toast(dateError); return; }
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
      totalUnits: totalAmount,
      completedRanges: material?.completedRanges
        ?? (doneAmount > 0 ? [{ start: 1, end: Math.min(doneAmount, totalAmount) }] : []),
      startDate,
      targetDate,
      preferredFinishDate: preferredFinishDate || undefined,
      priority,
      difficulty,
      minutesPerUnit: Math.max(0.1, minutesPerUnit),
      unitStep: Math.max(1, unitStep),
      splittable,
      minimumChunkUnits: Math.max(1, minimumChunkUnits),
      maximumChunkUnits: maximumChunkUnits > 0 ? Math.max(minimumChunkUnits, maximumChunkUnits) : undefined,
      maxUnitsPerDay: maxUnitsPerDay > 0 ? maxUnitsPerDay : undefined,
      preferredCadence: cadence === 'timesPerWeek' ? { type: 'timesPerWeek', count: Math.max(1, cadenceCount) } : { type: cadence },
      estimateMode,
      dailyTarget: dailyTarget > 0 ? dailyTarget : null,
      weeklyTarget: weeklyTarget > 0 ? weeklyTarget : null,
      deadlinePolicy,
      examRelevance,
      reviewEnabled,
      reviewIntervals: reviewIntervals.length > 0 ? reviewIntervals : state.settings.reviewRule.intervals,
      paused,
      round,
      archived,
      createdAt: material?.createdAt ?? new Date().toISOString(),
    };
    const result = execute({ type: isEdit ? 'UPDATE_MATERIAL' : 'ADD_MATERIAL', material: payload });
    if (result.scheduleStatus === 'invalidInput') { toast(result.message ?? '入力内容を確認してください'); return; }
    toast(result.message ?? (isEdit ? '教材を更新しました' : '教材を追加しました'));
    onClose();
  };

  const remove = (deleteSessions = false) => {
    if (!material) return;
    const description = deleteSessions
      ? '教材・関連タスク・この教材の学習記録を完全に削除します。分析の集計も減り、取り消せるのは15秒間です。'
      : '教材と未完了タスクを削除します。完了済みタスクと過去の学習記録は集計のため保持します。';
    if (!window.confirm(`「${material.name}」を削除しますか？\n\n${description}`)) return;
    const result = execute({ type: 'DELETE_MATERIAL', materialId: material.id, deleteSessions });
    if (!result.changed) { toast(result.message ?? '教材を削除できませんでした'); return; }
    toast(result.message ?? (deleteSessions ? '教材と関連記録を完全削除しました' : '教材を削除しました（記録は保持）'));
    onClose();
  };

  const daysToFinish = Math.max(1, diffDays(t, targetDate) + 1);
  const suggestedDaily = Math.max(1, Math.ceil(Math.max(0, totalAmount - doneAmount) / daysToFinish));
  const suggestedSession = Math.max(1, Math.round(45 / Math.max(0.1, minutesPerUnit)));

  return (
    <Sheet open onClose={onClose} title={isEdit ? '教材を編集' : '教材を追加'}>
      <div className="field">
        <label htmlFor="mf-name">教材名</label>
        <input id="mf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 青チャート 例題" />
      </div>
      <div className="field">
        <label htmlFor="mf-subject">科目</label>
        <select id="mf-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {state.subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="mf-total">総量（{unit}）</label>
        <NumericInput id="mf-total" value={totalAmount} min={1} placeholder="例: 300" onChange={(v) => setTotalAmount(Math.max(0, v))} />
      </div>
      {isEdit && (
        <div className="field">
          <label htmlFor="mf-done">終わった量</label>
          <NumericInput id="mf-done" value={doneAmount} min={0} placeholder="例: 40" onChange={(v) => setDoneAmount(Math.max(0, v))} />
        </div>
      )}
      <div className="field">
        <label htmlFor="mf-target">終わらせたい日</label>
        <input id="mf-target" type="date" value={targetDate} min={isEdit ? undefined : t} max={state.goal?.examDate} onChange={(e) => setTargetDate(e.target.value)} />
      </div>

      <div className="material-form-suggestion" role="note">
        <Sparkles size={20} aria-hidden="true" />
        <div>
          <strong>おすすめ設定を用意しました</strong>
          <p>1{unit}約{minutesPerUnit}分、1回{suggestedSession}{unit}を目安にします。期限までの平均は1日{suggestedDaily}{unit}です。</p>
          <small>最初の3回の実績から、所要時間をより正確に提案します。</small>
        </div>
      </div>

      <Disclosure title="おすすめ設定を変更" summary={`1${unit} ${minutesPerUnit}分・頻度は自動`}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mf-unit">学習量の単位</label>
            <select id="mf-unit" value={unit} onChange={(e) => setUnit(e.target.value as Material['unit'])}>
              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          {!isEdit && (
            <div className="field">
              <label htmlFor="mf-done">すでに終わった量</label>
              <NumericInput id="mf-done" value={doneAmount} min={0} placeholder="0" onChange={(v) => setDoneAmount(Math.max(0, v))} />
            </div>
          )}
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mf-start">開始日</label>
            <input id="mf-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mf-mpu">1{unit}あたりの分数</label>
            <NumericInput
              id="mf-mpu"
              decimal
              value={minutesPerUnit}
              min={0.1}
              placeholder="例: 12"
              onChange={(v) => setMinutesPerUnit(v)}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mf-preferred">推奨完了日</label>
            <input id="mf-preferred" type="date" value={preferredFinishDate} min={startDate} max={targetDate} onChange={(e) => setPreferredFinishDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mf-estimate-mode">見積時間の補正</label>
            <select id="mf-estimate-mode" value={estimateMode} onChange={(e) => setEstimateMode(e.target.value as 'auto' | 'suggest' | 'fixed')}>
              <option value="auto">自動補正</option>
              <option value="suggest">提案のみ</option>
              <option value="fixed">固定値</option>
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mf-step">単位刻み</label>
            <NumericInput id="mf-step" value={unitStep} min={1} onChange={(v) => setUnitStep(Math.max(1, v))} />
          </div>
          <div className="field">
            <label htmlFor="mf-day-cap">1日上限({unit})</label>
            <NumericInput id="mf-day-cap" value={maxUnitsPerDay > 0 ? maxUnitsPerDay : null} emptyValue={0} min={0} placeholder="上限なし" onChange={(v) => setMaxUnitsPerDay(Math.max(0, v))} />
          </div>
        </div>
        <div className="field">
          <label className="check-row">
            <input type="checkbox" checked={splittable} onChange={(e) => setSplittable(e.target.checked)} />
            タスクを分割可能にする
          </label>
        </div>
        {splittable && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="mf-min-chunk">最小チャンク({unit})</label>
              <NumericInput id="mf-min-chunk" value={minimumChunkUnits} min={1} onChange={(v) => setMinimumChunkUnits(Math.max(1, v))} />
            </div>
            <div className="field">
              <label htmlFor="mf-max-chunk">最大チャンク({unit})</label>
              <NumericInput id="mf-max-chunk" value={maximumChunkUnits > 0 ? maximumChunkUnits : null} emptyValue={0} min={0} placeholder="自動" onChange={(v) => setMaximumChunkUnits(Math.max(0, v))} />
            </div>
          </div>
        )}
        <div className="field-row">
          <div className="field">
            <label htmlFor="mf-cadence">学習頻度</label>
            <select id="mf-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
              <option value="auto">自動</option>
              <option value="daily">毎日</option>
              <option value="timesPerWeek">週の回数</option>
            </select>
          </div>
          {cadence === 'timesPerWeek' && (
            <div className="field">
              <label htmlFor="mf-cadence-count">週あたり回数</label>
              <NumericInput id="mf-cadence-count" value={cadenceCount} min={1} onChange={(v) => setCadenceCount(Math.max(1, v))} />
            </div>
          )}
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mf-daily">1日の目標量(任意)</label>
            <NumericInput
              id="mf-daily"
              decimal
              value={dailyTarget > 0 ? dailyTarget : null}
              emptyValue={0}
              min={0}
              placeholder="自動計算"
              onChange={(v) => setDailyTarget(v)}
            />
          </div>
          <div className="field">
            <label htmlFor="mf-weekly">1週間の目標量(任意)</label>
            <NumericInput
              id="mf-weekly"
              decimal
              value={weeklyTarget > 0 ? weeklyTarget : null}
              emptyValue={0}
              min={0}
              placeholder="自動計算"
              onChange={(v) => setWeeklyTarget(v)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="mf-deadline">期限の扱い</label>
          <select id="mf-deadline" value={deadlinePolicy} onChange={(e) => setDeadlinePolicy(e.target.value as Material['deadlinePolicy'])}>
            <option value="strict">期限厳守(最優先で配置)</option>
            <option value="normal">できれば守りたい</option>
            <option value="flexible">余裕があれば</option>
          </select>
        </div>
        <div className="field">
          <label>優先度(高いほど先に配置)</label>
          <Rating value={priority} onChange={(v) => setPriority(v)} icon={<Flag size={17} strokeWidth={2.2} />} label="優先度" />
        </div>
        <div className="field">
          <label>難易度(復習オン時は高いほど復習を増やします)</label>
          <Rating value={difficulty} onChange={(v) => setDifficulty(v)} icon={<Dumbbell size={17} strokeWidth={2.2} />} label="難易度" />
        </div>
        <div className="field">
          <label>試験への重要度</label>
          <Rating value={examRelevance} onChange={(v) => setExamRelevance(v)} icon={<Star size={17} strokeWidth={2.2} />} label="試験への重要度" />
        </div>
        {state.settings.reviewRule.enabled ? (
          <>
            <div className="field">
              <label className="check-row">
                <input type="checkbox" checked={reviewEnabled} onChange={(e) => setReviewEnabled(e.target.checked)} />
                復習タスクを自動生成する(明示的にオン)
              </label>
            </div>
            {reviewEnabled && (
              <div className="field">
                <label htmlFor="mf-review-intervals">復習間隔(日・カンマ区切り)</label>
                <input id="mf-review-intervals" value={reviewIntervalsText} onChange={(e) => setReviewIntervalsText(e.target.value)} placeholder="例: 1, 3, 7, 14, 30" />
              </div>
            )}
          </>
        ) : (
          <p className="field-hint">復習の自動生成は設定でオフになっています(設定から再開できます)</p>
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
        <div className="field-row" style={{ marginBottom: 0 }}>
          <label className="check-row">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            一時停止
          </label>
          <label className="check-row">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            アーカイブする
          </label>
        </div>
      </Disclosure>

      <button className="btn btn-primary btn-block mt-12" onClick={save}>
        {isEdit ? '保存して再計算' : '追加して計画に反映'}
      </button>
      {isEdit && (
        <button className="btn btn-danger btn-block mt-12" onClick={() => remove(false)}>
          教材を削除（記録は保持）
        </button>
      )}
      {isEdit && material && state.sessions.some((session) => session.materialId === material.id) && (
        <button className="btn btn-ghost btn-block mt-8 danger" onClick={() => remove(true)}>
          教材と学習記録を完全削除
        </button>
      )}
    </Sheet>
  );
}
