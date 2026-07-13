import { useState } from 'react';
import { Plus, Rocket, Target, Trash2 } from 'lucide-react';
import { useApp, type OnboardingInput } from '../state/AppContext';
import { addDays, genId, today } from '../lib/date';
import { SUBJECT_COLOR_PALETTE, SUBJECT_PRESETS, UNIT_OPTIONS } from '../data/defaults';
import { NumericInput, Stepper } from '../components/ui/bits';
import type { Material } from '../types';

type DraftMaterial = {
  draftId: string;
  subjectIndex: number;
  name: string;
  unit: Material['unit'];
  totalAmount: number;
  targetDate: string;
  minutesPerUnit: number;
};

/** 初回セットアップ: 4ステップ + デモで試す */
export function OnboardingScreen() {
  const { dispatch } = useApp();
  const t = today();
  const [step, setStep] = useState(0);

  const [goalName, setGoalName] = useState('');
  const [examDate, setExamDate] = useState(addDays(t, 120));
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState('');
  const [weekdayMinutes, setWeekdayMinutes] = useState(150);
  const [weekendMinutes, setWeekendMinutes] = useState(300);
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);
  const [validationError, setValidationError] = useState('');

  const toggleSubject = (name: string) => {
    setSelectedSubjects((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  };

  const addCustomSubject = () => {
    const name = customSubject.trim();
    if (name && !selectedSubjects.includes(name)) {
      setSelectedSubjects((prev) => [...prev, name]);
      setCustomSubject('');
    }
  };

  const updateExamDate = (next: string) => {
    const previous = examDate;
    setExamDate(next);
    // 教材ごとに変更していない既定期限だけ、試験日の変更へ追従させる。
    setMaterials((current) => current.map((material) =>
      material.targetDate === previous ? { ...material, targetDate: next } : material));
  };

  const addMaterial = () => {
    setMaterials((prev) => [
      ...prev,
      { draftId: genId('draft-mat'), subjectIndex: 0, name: '', unit: '問題', totalAmount: 100, targetDate: examDate, minutesPerUnit: 10 },
    ]);
  };

  const finish = () => {
    setValidationError('');
    if (!examDate || examDate < t) {
      setValidationError('試験日は今日以降を指定してください');
      setStep(0);
      return;
    }
    const invalidMaterial = materials.find((material) => material.name.trim()
      && (!material.targetDate || material.targetDate < t || material.targetDate > examDate
        || material.totalAmount <= 0 || material.minutesPerUnit <= 0));
    if (invalidMaterial) {
      setValidationError('教材の期限は今日から試験日まで、総量と所要時間は正の値で入力してください');
      return;
    }
    const input: OnboardingInput = {
      goalName: goalName.trim() || '試験本番',
      examDate,
      subjects: selectedSubjects.map((name, i) => ({
        name,
        color: SUBJECT_COLOR_PALETTE[i % SUBJECT_COLOR_PALETTE.length],
        importance: 3,
        weakness: 3,
      })),
      weekdayMinutes,
      weekendMinutes,
      materials: materials
        .filter((material) => material.name.trim() && material.totalAmount > 0)
        .map(({ draftId: _draftId, ...material }) => ({ ...material, name: material.name.trim() })),
    };
    dispatch({ type: 'COMPLETE_ONBOARDING', input });
  };

  const steps = ['目標', '科目', '時間', '教材'];

  return (
    <div className="screen" style={{ paddingBottom: 40, maxWidth: 560, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', margin: '26px 0 22px' }}>
        <div
          style={{
            width: 66,
            height: 66,
            borderRadius: 19,
            background: 'var(--accent-grad)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
            boxShadow: '0 8px 32px rgba(79,124,255,0.4)',
          }}
          aria-hidden="true"
        >
          <Target size={32} strokeWidth={2} color="#fff" />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 14 }}>StudyCommander</h1>
        <p className="muted" style={{ marginTop: 5, lineHeight: 1.6 }}>
          試験日までの毎日の計画を自動で作り、
          <br />
          ズレたら自動で組み直す学習司令塔
        </p>
      </div>

      {/* ステップインジケーター */}
      <div className="row" style={{ justifyContent: 'center', gap: 6, marginBottom: 22 }}>
        {steps.map((label, i) => (
          <div key={label} className="row" style={{ gap: 6 }}>
            <span
              className="status-badge"
              style={{
                background: i <= step ? 'var(--accent-soft)' : 'var(--bg-elev2)',
                color: i <= step ? 'var(--accent)' : 'var(--text-faint)',
              }}
            >
              {i + 1}. {label}
            </span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="card">
          <div className="sheet-title">目標を教えてください</div>
          <div className="field">
            <label htmlFor="ob-goal">目標名</label>
            <input id="ob-goal" value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="例: 大学受験 本番" />
          </div>
          <div className="field">
            <label htmlFor="ob-exam">試験日</label>
            <input id="ob-exam" type="date" value={examDate} min={t} onChange={(e) => updateExamDate(e.target.value)} />
          </div>
          {validationError && <p className="status-danger mt-8" role="alert">{validationError}</p>}
          <button className="btn btn-primary btn-block" onClick={() => {
            if (!examDate || examDate < t) { setValidationError('試験日は今日以降を指定してください'); return; }
            setValidationError('');
            setStep(1);
          }}>
            次へ
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="sheet-title">受験する科目は?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {SUBJECT_PRESETS.map((name) => (
              <button
                key={name}
                type="button"
                className="btn btn-sm"
                style={{
                  background: selectedSubjects.includes(name) ? 'var(--accent-grad)' : 'var(--bg-elev2)',
                  color: selectedSubjects.includes(name) ? '#fff' : 'var(--text)',
                  border: '1px solid var(--border)',
                }}
                onClick={() => toggleSubject(name)}
                aria-pressed={selectedSubjects.includes(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="ob-custom">その他の科目を追加</label>
            <div className="row">
              <input
                id="ob-custom"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder="例: 小論文"
                style={{ flex: 1 }}
              />
              <button className="btn btn-secondary btn-sm" onClick={addCustomSubject}>
                追加
              </button>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setStep(0)}>
              戻る
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={selectedSubjects.length === 0} onClick={() => setStep(2)}>
              次へ({selectedSubjects.length}科目)
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div className="sheet-title">1日どれくらい勉強できる?</div>
          <div className="field">
            <label>平日(1日あたり)</label>
            <Stepper value={weekdayMinutes} onChange={setWeekdayMinutes} step={30} min={30} max={330} suffix="分" />
          </div>
          <div className="field">
            <label>土日(1日あたり)</label>
            <Stepper value={weekendMinutes} onChange={setWeekendMinutes} step={30} min={30} max={720} suffix="分" />
          </div>
          <p className="faint" style={{ marginBottom: 14 }}>後から曜日ごとに細かく設定できます。</p>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>
              戻る
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(3)}>
              次へ
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <div className="sheet-title">使う教材を追加(任意)</div>
          {materials.map((m, i) => (
            <div key={m.draftId} className="card" style={{ padding: 13, marginBottom: 12, background: 'var(--bg-elev2)' }}>
              <div className="row spread mb-12">
                <b>教材 {i + 1}</b>
                <button type="button" className="icon-btn danger" aria-label={`教材${i + 1}を削除`} onClick={() => setMaterials((current) => current.filter((item) => item.draftId !== m.draftId))}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="field">
                <label htmlFor={`ob-mname-${i}`}>教材名</label>
                <input
                  id={`ob-mname-${i}`}
                  value={m.name}
                  onChange={(e) => setMaterials((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="例: 英単語ターゲット1900"
                />
              </div>
              <div className="field-row">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ob-msubj-${i}`}>科目</label>
                  <select
                    id={`ob-msubj-${i}`}
                    value={m.subjectIndex}
                    onChange={(e) => setMaterials((p) => p.map((x, j) => (j === i ? { ...x, subjectIndex: Number(e.target.value) } : x)))}
                  >
                    {selectedSubjects.map((name, idx) => (
                      <option key={name} value={idx}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ob-munit-${i}`}>単位</label>
                  <select
                    id={`ob-munit-${i}`}
                    value={m.unit}
                    onChange={(e) => setMaterials((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value as Material['unit'] } : x)))}
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field-row mt-12">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ob-mtotal-${i}`}>総量</label>
                  <NumericInput
                    id={`ob-mtotal-${i}`}
                    value={m.totalAmount}
                    min={1}
                    placeholder="例: 300"
                    onChange={(v) => setMaterials((p) => p.map((x, j) => (j === i ? { ...x, totalAmount: v } : x)))}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ob-mmpu-${i}`}>1{m.unit}の分数</label>
                  <NumericInput
                    id={`ob-mmpu-${i}`}
                    decimal
                    value={m.minutesPerUnit}
                    min={0.1}
                    placeholder="例: 12"
                    onChange={(v) => setMaterials((p) => p.map((x, j) => (j === i ? { ...x, minutesPerUnit: v } : x)))}
                  />
                </div>
              </div>
              <div className="field mt-12" style={{ marginBottom: 0 }}>
                <label htmlFor={`ob-mtarget-${i}`}>この教材の期限</label>
                <input
                  id={`ob-mtarget-${i}`}
                  type="date"
                  min={t}
                  max={examDate}
                  value={m.targetDate}
                  onChange={(event) => setMaterials((current) => current.map((item) => item.draftId === m.draftId ? { ...item, targetDate: event.target.value } : item))}
                />
              </div>
            </div>
          ))}
          <button className="btn btn-secondary btn-block mb-12" onClick={addMaterial}>
            <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> 教材を追加
          </button>
          <p className="faint" style={{ marginBottom: 14 }}>教材は後からいつでも追加・編集できます。</p>
          {validationError && <p className="status-danger mb-12" role="alert">{validationError}</p>}
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>
              戻る
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={finish}>
              <Rocket size={15} strokeWidth={2.2} aria-hidden="true" /> 計画を自動生成する
            </button>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <button className="btn btn-ghost" onClick={() => dispatch({ type: 'LOAD_DEMO' })}>
          まずはデモデータで試す →
        </button>
      </div>
    </div>
  );
}
