interface ProgressRingProps {
  /** 0-1 */
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
  color?: string;
}

/** SVG円形プログレス */
export function ProgressRing({ value, size = 104, stroke = 9, label, sublabel, color }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gradId = 'ring-grad';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ? `${label} ${sublabel ?? ''}` : `進捗 ${Math.round(clamped * 100)}%`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f7cff" />
          <stop offset="1" stopColor="#9a5cff" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-elev3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color ?? `url(#${gradId})`}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.3, 0.8, 0.3, 1)' }}
      />
      {label && (
        <text x="50%" y={sublabel ? '46%' : '52%'} textAnchor="middle" fontSize={size * 0.21} fontWeight={800} fill="var(--text)">
          {label}
        </text>
      )}
      {sublabel && (
        <text x="50%" y="64%" textAnchor="middle" fontSize={size * 0.1} fontWeight={600} fill="var(--text-sub)">
          {sublabel}
        </text>
      )}
    </svg>
  );
}
