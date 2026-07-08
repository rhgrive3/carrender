import { useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Sheet } from '../components/ui/Sheet';
import { Segmented, Rating } from '../components/ui/bits';
import { useToast } from '../components/ui/Toast';
import { exportJSON, importJSON, saveStateNow } from '../lib/storage';
import { genId, today, WEEKDAY_LABELS } from '../lib/date';
import type { FixedEvent, Weekday } from '../types';

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [goalName, setGoalName] = useState(state.goal?.name ?? '');
  const [examDate, setExamDate] = useState(state.goal?.examDate ?? '');
  const [availability, setAvailability] = useState(state.availability);
  const [events, setEvents] = useState(state.fixedEvents);
  const [newEvent, setNewEvent] = useState<{ title: string; weekday: Weekday; start: string; end: string }>({
    title: '',
    weekday: 1,
    start: '08:00',
    end: '16:00',
  });

  const setTheme = (theme: 'auto' | 'dark' | 'light') => {
    dispatch({ type: 'UPDATE_SETTINGS', settings: { ...state.settings, theme } });
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

  const addEvent = () => {
    if (!newEvent.title.trim() || newEvent.start >= newEvent.end) {
      toast('予定名と正しい時間帯を入力してください');
      return;
    }
    const ev: FixedEvent = {
      id: genId('ev'),
      title: newEvent.title.trim(),
      weekday: newEvent.weekday,
      date: null,
      start: newEvent.start,
      end: newEvent.end,
    };
    const next = [...events, ev];
    setEvents(next);
    dispatch({ type: 'UPDATE_FIXED_EVENTS', fixedEvents: next });
    setNewEvent({ ...newEvent, title: '' });
    toast('固定予定を追加しました');
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

      {/* 勉強可能時間 */}
      <div className="section-label">⏰ 曜日ごとの勉強可能時間</div>
      {availability.map((slot) => (
        <div key={slot.weekday} className="row" style={{ marginBottom: 8 }}>
          <span style={{ width: 34, fontWeight: 800, fontSize: 14 }}>{WEEKDAY_LABELS[slot.weekday]}</span>
          <input
            type="range"
            min={0}
            max={720}
            step={30}
            value={slot.minutes}
            aria-label={`${WEEKDAY_LABELS[slot.weekday]}曜日の勉強可能時間`}
            style={{ flex: 1, accentColor: 'var(--accent)', minHeight: 44 }}
            onChange={(e) =>
              setAvailability((prev) => prev.map((s) => (s.weekday === slot.weekday ? { ...s, minutes: Number(e.target.value) } : s)))
            }
          />
          <span className="muted" style={{ width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {Math.floor(slot.minutes / 60)}h{slot.minutes % 60 > 0 ? `${slot.minutes % 60}m` : ''}
          </span>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm btn-block" onClick={saveAvailability}>
        時間を保存して再計算
      </button>

      {/* 固定予定 */}
      <div className="section-label">📌 固定予定(毎週)</div>
      {events.map((ev) => (
        <div key={ev.id} className="row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {ev.weekday !== null ? `毎週${WEEKDAY_LABELS[ev.weekday]}` : ev.date} {ev.title}
          </span>
          <span className="faint">
            {ev.start}〜{ev.end}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} aria-label={`${ev.title}を削除`} onClick={() => removeEvent(ev.id)}>
            削除
          </button>
        </div>
      ))}
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
