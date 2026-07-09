import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
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
  mockReview: '模試復習',
  pastExam: '過去問',
};

export function TaskTypeChip({ type }: { type: StudyTask['type'] }) {
  return <span className={`task-type-chip ${type === 'review' ? 'review' : ''}`}>{TASK_TYPE_LABEL[type]}</span>;
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

export function NumericInput({
  id,
  value,
  onChange,
  min,
  max,
  decimal = false,
  placeholder,
  ariaLabel,
  emptyValue = 0,
}: {
  id?: string;
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  decimal?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  emptyValue?: number;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => (value === null || value === 0 ? '' : String(value)));

  useEffect(() => {
    if (focused) return;
    setText(value === null || value === 0 ? '' : String(value));
  }, [focused, value]);

  const parse = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = decimal ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return null;
    const clipped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
    return clipped;
  };

  const sanitize = (raw: string): string => {
    const base = raw.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '');
    if (!decimal) return base;
    const [head, ...rest] = base.split('.');
    return rest.length > 0 ? `${head}.${rest.join('')}` : head;
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      pattern={decimal ? undefined : '[0-9]*'}
      value={text}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onFocus={() => {
        setFocused(true);
        if (text === '0') setText('');
      }}
      onChange={(e) => {
        const next = sanitize(e.target.value);
        setText(next);
        const parsed = parse(next);
        onChange(parsed ?? emptyValue);
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = parse(text);
        if (parsed === null) {
          setText('');
          onChange(emptyValue);
          return;
        }
        const normalized = decimal ? String(parsed).replace(/\.0+$/, '') : String(Math.trunc(parsed));
        setText(normalized);
        onChange(parsed);
      }}
    />
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
  icon?: ReactNode;
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

/** 折りたたみセクション: 詳細設定を隠してフォームや設定画面をシンプルに保つ */
export function Disclosure({
  title,
  icon,
  iconColor,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  iconColor?: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disclosure ${open ? 'open' : ''}`}>
      <button type="button" className="disclosure-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon && (
          <span className="disclosure-icon" aria-hidden="true" style={iconColor ? { color: iconColor } : undefined}>
            {icon}
          </span>
        )}
        <span className="disclosure-title">{title}</span>
        {summary && <span className="disclosure-summary">{summary}</span>}
        <span className="disclosure-chevron" aria-hidden="true">
          <ChevronDown size={16} strokeWidth={2.2} />
        </span>
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}
