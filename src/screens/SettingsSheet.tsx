import { useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Sheet } from '../components/ui/Sheet';
import { Segmented, Rating, NumericInput } from '../components/ui/bits';
import { useToast } from '../components/ui/Toast';
import { exportJSON, importJSON, saveStateNow } from '../lib/storage';
import { formatDateShort, genId, hmToMinutes, minutesToHM, today, WEEKDAY_LABELS } from '../lib/date';
import type { DayLoad, DayPlanOverride, FixedEvent, TimeRange, Weekday } from '../types';

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [goalName, setGoalName] = useState(state.goal?.name ?? '');
  const [examDate, setExamDate] = useState(state.goal?.examDate ?? '');
  const [availability, setAvailability] = useState(state.availability);
  const [events, setEvents] = useState(state.fixedEvents);
  const [settingsDraft, setSettingsDraft] = useState(state.settings);
  const [newEvent, setNewEvent] = useState<{ title: string; mode: 'weekly' | 'date'; weekday: Weekday; date: string; start: string; end: string }>({
    title: '',
    mode: 'weekly',
    weekday: 1,
    date: today(),
    start: '08:00',
    end: '16:00',
  });
  const [dayException, setDayException] = useState<{
    date: string;
    load: DayLoad;
    memo: string;
    useWindow: boolean;
    start: string;
    end: string;
  }>({ date: today(), load: 'normal', memo: '', useWindow: false, start: '18:00', end: '20:00' });

  const setTheme = (theme: 'auto' | 'dark' | 'light') => {
    dispatch({ type: 'UPDATE_SETTINGS', settings: { ...state.settings, theme } });
    setSettingsDraft((prev) => ({ ...prev, theme }));
  };

  const saveGoal = () => {
    if (!state.goal || !goalName.trim() || !examDate) return;
    dispatch({ type: 'UPDATE_GOAL', goal: { ...state.goal, name: goalName.trim(), examDate } });
    toast('目標を更新し、計画を再計算しました');
  };

  const saveAvailability = () => {
    dispatch({ type: 'UPDATE_AVAILABILITY', availability });
    toast('勉強可能時間を更新し、計画を再計算しました');
  };

  const saveStudySettings = () => {
    dispatch({ type: 'UPDATE_SETTINGS', settings: settingsDraft });
    toast('学習時間の上限を保存し、計画を再計算しました');
  };

  const addEvent = () => {
    if (!newEvent.title.trim() || newEvent.start >= newEvent.end) {
      toast('予定名と正しい時間帯を入力してください');
      return;
    }
    const ev: FixedEvent = {
      id: genId('ev'),
      title: newEvent.title.trim(),
      weekday: newEvent.mode === 'weekly' ? newEvent.weekday : null,
      date: newEvent.mode === 'date' ? newEvent.date : null,
      start: newEvent.start,
      end: newEvent.end,
    };
    const next = [...events, ev];
    setEvents(next);
    dispatch({ type: 'UPDATE_FIXED_EVENTS', fixedEvents: next });
    setNewEvent({ ...newEvent, title: '' });
    toast('固定予定を追加しました');
  };

  const saveDayException = () => {
    if (dayException.useWindow && dayException.start >= dayException.end) {
      toast('例外時間帯を正しく入力してください');
      return;
    }
    const dayPlan: DayPlanOverride = {
      date: dayException.date,
      load: dayException.load,
      memo: dayException.memo,
      availabilityWindows: dayException.useWindow ? [{ start: dayException.start, end: dayException.end }] : null,
    };
    dispatch({ type: 'UPDATE_DAY_PLAN', dayPlan });
    dispatch({ type: 'RESCHEDULE_FROM', fromDate: dayException.date, reason: `${formatDateShort(dayException.date)}の例外設定` });
    toast('日別例外を保存して再計算しました');
  };

  const updateAvailabilityWindows = (weekday: Weekday, windows: TimeRange[]) => {
    const clean = windows.filter((w) => w.start && w.end && w.start < w.end);
    const minutes = clean.reduce((sum, w) => sum + Math.max(0, hmToMinutes(w.end) - hmToMinutes(w.start)), 0);
    setAvailability((prev) => prev.map((s) => (s.weekday === weekday ? { ...s, windows: clean, minutes } : s)));
  };

  const removeEvent = (id: string) => {
    const next = events.filter((e) => e.id !== id);
    setEvents(next);
    dispatch({ type: 'UPDATE_FIXED_EVENTS', fixedEvents: next });
  };

  const doExport = () => {
    const blob = new Blob([exportJSON(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studycommander-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSONをエクスポートしました');
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importJSON(String(reader.result));
        dispatch({ type: 'IMPORT_STATE', state: imported });
        saveStateNow(imported);
        toast('データをインポートしました');
        onClose();
      } catch {
        toast('インポートに失敗しました。ファイルを確認してください');
      }
    };
    reader.readAsText(file);
  };

  const doReset = () => {
    if (!window.confirm('すべてのデータを削除して初期状態に戻しますか?この操作は取り消せません。')) return;
    dispatch({ type: 'RESET_ALL' });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="設定">
      {/* テーマ */}
      <div className="field">
        <label>テーマ</label>
        <Segmented
          ariaLabel="テーマ"
          options={[
            { value: 'auto', label: '自動' },
            { value: 'dark', label: 'ダーク' },
            { value: 'light', label: 'ライト' },
          ]}
          value={state.settings.theme}
          onChange={setTheme}
        />
      </div>

      {/* 目標 */}
      {state.goal && (
        <>
          <div className="section-label">🎯 目標と試験日</div>
          <div className="field">
            <label htmlFor="st-goal">目標名</label>
            <input id="st-goal" value={goalName} onChange={(e) => setGoalName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="st-exam">試験日</label>
            <input id="st-exam" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm btn-block" onClick={saveGoal}>
            目標を保存して再計算
          </button>
        </>
      )}

      {/* 学習時間の上限 */}
      <div className="section-label">学習ブロック設定</div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="st-max-daily">1日の最大勉強時間(分)</label>
          <NumericInput
            id="st-max-daily"
            value={settingsDraft.maxDailyMinutes}
            min={0}
            max={1200}
            placeholder="例: 360"
            onChange={(v) => setSettingsDraft((prev) => ({ ...prev, maxDailyMinutes: v }))}
          />
        </div>
        <div className="field">
          <label htmlFor="st-session-max">1コマの最大時間(分)</label>
          <NumericInput
            id="st-session-max"
            value={settingsDraft.sessionMaxMinutes}
            min={15}
            max={240}
            placeholder="例: 90"
            onChange={(v) => setSettingsDraft((prev) => ({ ...prev, sessionMaxMinutes: v }))}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="st-session-min">1コマの最小時間(分)</label>
        <NumericInput
          id="st-session-min"
          value={settingsDraft.sessionMinMinutes}
          min={5}
          max={120}
          placeholder="例: 25"
          onChange={(v) => setSettingsDraft((prev) => ({ ...prev, sessionMinMinutes: v }))}
        />
      </div>
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveStudySettings}>
        ブロック設定を保存して再計算
      </button>

      {/* 勉強可能時間 */}
      <div className="section-label">曜日ごとの勉強可能時間</div>
      {availability.map((slot) => (
        <div key={slot.weekday} className="card availability-card">
          <div className="row spread">
            <span style={{ fontWeight: 800, fontSize: 14 }}>{WEEKDAY_LABELS[slot.weekday]}曜日</span>
            <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {slot.minutes > 0 ? `${Math.floor(slot.minutes / 60)}h${slot.minutes % 60 > 0 ? `${slot.minutes % 60}m` : ''}` : '休み'}
            </span>
          </div>
          {(slot.windows.length > 0 ? slot.windows : []).map((window, idx) => (
            <div key={`${slot.weekday}-${idx}`} className="row mt-8">
              <input
                aria-label={`${WEEKDAY_LABELS[slot.weekday]}曜日 ${idx + 1}枠目の開始`}
                type="time"
                value={window.start}
                onChange={(e) => {
                  const windows = slot.windows.map((w, i) => (i === idx ? { ...w, start: e.target.value } : w));
                  updateAvailabilityWindows(slot.weekday, windows);
                }}
                style={inputStyle}
              />
              <span className="faint">〜</span>
              <input
                aria-label={`${WEEKDAY_LABELS[slot.weekday]}曜日 ${idx + 1}枠目の終了`}
                type="time"
                value={window.end}
                onChange={(e) => {
                  const windows = slot.windows.map((w, i) => (i === idx ? { ...w, end: e.target.value } : w));
                  updateAvailabilityWindows(slot.weekday, windows);
                }}
                style={inputStyle}
              />
              <button className="btn btn-ghost btn-sm" onClick={() => updateAvailabilityWindows(slot.weekday, slot.windows.filter((_, i) => i !== idx))}>
                削除
              </button>
            </div>
          ))}
          <div className="row mt-8">
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() => {
                const last = slot.windows.length > 0 ? slot.windows[slot.windows.length - 1] : null;
                const start = last?.end ?? (slot.weekday === 0 || slot.weekday === 6 ? '09:00' : '18:00');
                updateAvailabilityWindows(slot.weekday, [...slot.windows, { start, end: minutesToHM(hmToMinutes(start) + 120) }]);
              }}
            >
              時間帯を追加
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => updateAvailabilityWindows(slot.weekday, [])}>
              休みにする
            </button>
          </div>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveAvailability}>
        曜日テンプレートを保存して再計算
      </button>

      {/* 固定予定 */}
      <div className="section-label">固定予定</div>
      {events.map((ev) => (
        <div key={ev.id} className="row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {ev.weekday !== null ? `毎週${WEEKDAY_LABELS[ev.weekday]}` : ev.date ? formatDateShort(ev.date) : ''} {ev.title}
          </span>
          <span className="faint">
            {ev.start}〜{ev.end}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} aria-label={`${ev.title}を削除`} onClick={() => removeEvent(ev.id)}>
            削除
          </button>
        </div>
      ))}
      <div className="field">
        <Segmented
          ariaLabel="予定種別"
          options={[
            { value: 'weekly', label: '毎週' },
            { value: 'date', label: '1日だけ' },
          ]}
          value={newEvent.mode}
          onChange={(mode) => setNewEvent({ ...newEvent, mode })}
        />
      </div>
      <div className="field-row">
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            aria-label="予定名"
            value={newEvent.title}
            onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
            placeholder="予定名(例: 部活)"
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          {newEvent.mode === 'weekly' ? (
            <select
              aria-label="曜日"
              value={newEvent.weekday}
              onChange={(e) => setNewEvent({ ...newEvent, weekday: Number(e.target.value) as Weekday })}
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={label} value={i}>
                  毎週{label}曜日
                </option>
              ))}
            </select>
          ) : (
            <input aria-label="日付" type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
          )}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input aria-label="開始時刻" type="time" value={newEvent.start} onChange={(e) => setNewEvent({ ...newEvent, start: e.target.value })} style={inputStyle} />
        <span className="faint">〜</span>
        <input aria-label="終了時刻" type="time" value={newEvent.end} onChange={(e) => setNewEvent({ ...newEvent, end: e.target.value })} style={inputStyle} />
        <button className="btn btn-secondary btn-sm" onClick={addEvent}>
          追加
        </button>
      </div>

      {/* 日別例外 */}
      <div className="section-label">日別の例外</div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="st-ex-date">日付</label>
          <input id="st-ex-date" type="date" value={dayException.date} onChange={(e) => setDayException({ ...dayException, date: e.target.value })} />
        </div>
        <div className="field">
          <label>負荷</label>
          <Segmented
            ariaLabel="日別負荷"
            options={[
              { value: 'normal', label: '通常' },
              { value: 'light', label: '軽め' },
              { value: 'heavy', label: '重め' },
              { value: 'rest', label: '休養' },
            ]}
            value={dayException.load}
            onChange={(load) => setDayException({ ...dayException, load })}
          />
        </div>
      </div>
      <label className="check-row" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={dayException.useWindow} onChange={(e) => setDayException({ ...dayException, useWindow: e.target.checked })} />
        この日だけ勉強可能時間を上書きする
      </label>
      {dayException.useWindow && (
        <div className="row" style={{ marginBottom: 8 }}>
          <input aria-label="例外開始時刻" type="time" value={dayException.start} onChange={(e) => setDayException({ ...dayException, start: e.target.value })} style={inputStyle} />
          <span className="faint">〜</span>
          <input aria-label="例外終了時刻" type="time" value={dayException.end} onChange={(e) => setDayException({ ...dayException, end: e.target.value })} style={inputStyle} />
        </div>
      )}
      <div className="field">
        <label htmlFor="st-ex-memo">メモ</label>
        <input id="st-ex-memo" value={dayException.memo} onChange={(e) => setDayException({ ...dayException, memo: e.target.value })} placeholder="例: 模試、復習日、明日は2時間だけ" />
      </div>
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveDayException}>
        例外を保存して再計算
      </button>
      {state.dayPlans.length > 0 && (
        <div className="mt-12">
          {state.dayPlans.slice(0, 5).map((plan) => (
            <div key={plan.date} className="mini-block" style={{ cursor: 'default' }}>
              <span style={{ fontWeight: 800 }}>{formatDateShort(plan.date)}</span>
              <span className="faint">{plan.load === 'rest' ? '休養' : plan.load === 'light' ? '軽め' : plan.load === 'heavy' ? '重め' : '通常'}</span>
              {plan.memo && <span className="muted" style={{ marginLeft: 'auto' }}>{plan.memo}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 科目の重要度・苦手度 */}
      {state.subjects.length > 0 && (
        <>
          <div className="section-label">📖 科目の重要度・苦手度</div>
          <SubjectTuner />
        </>
      )}

      {/* データ管理 */}
      <div className="section-label">💾 データ管理</div>
      {state.isDemo && (
        <div className="card" style={{ padding: 12, marginBottom: 10, borderColor: 'var(--warn)' }}>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            現在<b>デモデータ</b>を表示中です。本番利用の際は「初期化」して自分のデータで始めてください。
          </p>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={doExport}>
          ⬇ エクスポート
        </button>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          ⬆ インポート
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        aria-label="バックアップJSONを選択"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doImport(f);
          e.target.value = '';
        }}
      />
      <button className="btn btn-danger btn-block mt-8" onClick={doReset}>
        すべてのデータを初期化
      </button>

      <p className="faint" style={{ textAlign: 'center', marginTop: 18 }}>
        StudyCommander v1.0 ・ データは端末内にのみ保存されます
      </p>
    </Sheet>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 44,
  background: 'var(--bg-elev2)',
  border: '1.5px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 16,
  padding: '8px 10px',
};

function SubjectTuner() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      {state.subjects.map((s) => (
        <div key={s.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <button
            className="row spread"
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', color: 'var(--text)', minHeight: 30 }}
            onClick={() => setOpenId(openId === s.id ? null : s.id)}
            aria-expanded={openId === s.id}
          >
            <span style={{ fontWeight: 800, fontSize: 14, color: s.color }}>{s.name}</span>
            <span className="faint">
              重要度{s.importance} ・ 苦手度{s.weakness} {openId === s.id ? '▲' : '▼'}
            </span>
          </button>
          {openId === s.id && (
            <div className="mt-12">
              <div className="field">
                <label>重要度(配点が大きい・合否に直結)</label>
                <Rating
                  value={s.importance}
                  label={`${s.name}の重要度`}
                  onChange={(v) => {
                    dispatch({ type: 'UPDATE_SUBJECT', subject: { ...s, importance: v } });
                    toast(`${s.name}の重要度を${v}にして再計算しました`);
                  }}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>苦手度(高いほど優先的に配置)</label>
                <Rating
                  value={s.weakness}
                  label={`${s.name}の苦手度`}
                  onChange={(v) => {
                    dispatch({ type: 'UPDATE_SUBJECT', subject: { ...s, weakness: v } });
                    toast(`${s.name}の苦手度を${v}にして再計算しました`);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
