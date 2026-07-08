/** 下部ナビ用SVGアイコン(currentColorでアクティブ色に追従) */

const common = {
  width: 23,
  height: 23,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function IconHome({ active }: { active: boolean }) {
  return (
    <svg {...common} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.22 : 0} />
    </svg>
  );
}

export function IconPlan({ active }: { active: boolean }) {
  return (
    <svg {...common} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="17" rx="3" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.22 : 0} />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      {active && <path d="M8.5 14.5l2.3 2.3 4.7-4.7" strokeWidth={2.1} />}
    </svg>
  );
}

export function IconBook({ active }: { active: boolean }) {
  return (
    <svg {...common} aria-hidden="true">
      <path
        d="M12 6.5C10.5 4.9 8.4 4 6 4c-1 0-2 .15-3 .5v14c1-.35 2-.5 3-.5 2.4 0 4.5.9 6 2.5 1.5-1.6 3.6-2.5 6-2.5 1 0 2 .15 3 .5v-14c-1-.35-2-.5-3-.5-2.4 0-4.5.9-6 2.5Z"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.22 : 0}
      />
      <path d="M12 6.5V20" />
    </svg>
  );
}

export function IconTimer({ active }: { active: boolean }) {
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="12" cy="13.5" r="8" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.22 : 0} />
      <path d="M12 9.5v4l2.8 1.8M9.5 2.5h5" />
    </svg>
  );
}

export function IconChart({ active }: { active: boolean }) {
  return (
    <svg {...common} aria-hidden="true">
      {active ? (
        <>
          <rect x="4" y="12.5" width="4" height="8" rx="1.2" fill="currentColor" fillOpacity={0.9} stroke="none" />
          <rect x="10" y="7.5" width="4" height="13" rx="1.2" fill="currentColor" fillOpacity={0.55} stroke="none" />
          <rect x="16" y="3.5" width="4" height="17" rx="1.2" fill="currentColor" fillOpacity={0.3} stroke="none" />
        </>
      ) : (
        <>
          <rect x="4" y="12.5" width="4" height="8" rx="1.2" />
          <rect x="10" y="7.5" width="4" height="13" rx="1.2" />
          <rect x="16" y="3.5" width="4" height="17" rx="1.2" />
        </>
      )}
    </svg>
  );
}
