import type { ReactNode } from 'react';
import type { Subject, StudyTask } from '../../types';

export function SubjectChip({ subject }: { subject: Subject | undefined }) {
  if (!subject) return null;
  return (
    <span className="subject-chip" style={{ background: `${subject.color}26`, color: subject.color }}>
      {subject.name}
    </span>
  );
}

export const TASK_TYPE_LABEL: Record<StudyTask['type'], string> = {
  new: '新規',
  review: '復習',
  correction: '間違い直し',
  mockReview: '模試復習',
  pastExam: '過去問',
};

export function TaskTypeChip({ type }: { type: StudyTask['type'] }) {
  const cls = type === 'review' ? 'review' : type === 'correction' ? 'correction' : '';
  return <span className={`task-type-chip ${cls}`}>{TASK_TYPE_LABEL[type]}</span>;
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="progress-fill"
        style={{ width: `${pct}%`, background: color ?? 'var(--accent-grad)' }}
      />
    </div>
  );
}

export function Rating({
  value,
  onChange,
  icon = '★',
  label,
}: {
  value: number | null;
  onChange: (v: 1 | 2 | 3 | 4 | 5) => void;
  icon?: string;
  label: string;
}) {
  return (
    <div className="rating" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${label} ${n}`}
          className={value !== null && value >= n ? 'active' : ''}
          onClick={() => onChange(n as 1 | 2 | 3 | 4 | 5)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 99999,
  suffix = '',
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label="減らす" onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <div className="stepper-value">
        {value}
        {suffix && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-sub)', marginLeft: 3 }}>{suffix}</span>}
      </div>
      <button type="button" aria-label="増やす" onClick={() => onChange(Math.min(max, value + step))}>
        ＋
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <div className="empty-title">{title}</div>
      {children && <p>{children}</p>}
    </div>
  );
}
