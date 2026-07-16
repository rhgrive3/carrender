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
          const content = (
            <>
              <span className={`cal-daynum ${wd === 0 ? 'cal-sun' : wd === 6 ? 'cal-sat' : ''}`}>{Number(d.slice(8))}</span>
              {renderDay(d)}
            </>
          );

          if (!onSelectDay) {
            // 閲覧専用カレンダーをdisabledボタンにすると、VoiceOverや外付け
            // キーボードへ操作不能なコントロールを大量に公開してしまう。
            // 表示専用セルでは通常要素を使い、日付と内容をそのまま読み上げる。
            return <div key={d} className={cls} style={cellStyle?.(d)}>{content}</div>;
          }

          return (
            <button
              key={d}
              type="button"
              className={cls}
              style={cellStyle?.(d)}
              onClick={() => onSelectDay(d)}
              aria-label={`${Number(month.slice(5))}月${Number(d.slice(8))}日${d === t ? ' 今日' : ''}`}
              aria-pressed={selectedDate === d}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
