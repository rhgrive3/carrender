import type { CSSProperties, ReactNode } from 'react';
import type { ISODate } from '../../types';
import { daysInMonthOf, today, weekdayOf, WEEKDAY_LABELS } from '../../lib/date';

/**
 * 月カレンダーの骨組み。マスの中身は renderDay で呼び出し側が描く。
 */
export function MonthCalendar({
  month,
  selectedDate,
  onSelectDay,
  renderDay,
  cellStyle,
}: {
  month: string; // "YYYY-MM"
  selectedDate?: ISODate | null;
  onSelectDay?: (date: ISODate) => void;
  renderDay: (date: ISODate) => ReactNode;
  cellStyle?: (date: ISODate) => CSSProperties | undefined;
}) {
  const t = today();
  const count = daysInMonthOf(month);
  const days: ISODate[] = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const leading = weekdayOf(days[0]);

  return (
    <div>
      <div className="cal-grid cal-head" aria-hidden="true">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={w} className={i === 0 ? 'cal-sun' : i === 6 ? 'cal-sat' : ''}>{w}</span>
        ))}
      </div>
      <div className="cal-grid">
        {Array.from({ length: leading }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {days.map((d) => {
          const wd = weekdayOf(d);
          const cls = [
            'cal-cell',
            d === t ? 'today' : '',
            selectedDate === d ? 'selected' : '',
            d < t ? 'past' : '',
          ].join(' ');
          return (
            <button
              key={d}
              className={cls}
              style={cellStyle?.(d)}
              onClick={() => onSelectDay?.(d)}
              aria-label={`${Number(month.slice(5))}月${Number(d.slice(8))}日${d === t ? ' 今日' : ''}`}
              aria-pressed={onSelectDay ? selectedDate === d : undefined}
              disabled={!onSelectDay}
            >
              <span className={`cal-daynum ${wd === 0 ? 'cal-sun' : wd === 6 ? 'cal-sat' : ''}`}>{Number(d.slice(8))}</span>
              {renderDay(d)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
