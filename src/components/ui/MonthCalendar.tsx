import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { ISODate } from '../../types';
import { daysInMonthOf, today, weekdayOf, WEEKDAY_LABELS } from '../../lib/date';

const WEEKDAY_FULL_LABELS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'] as const;

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
  const [year, monthNumber] = month.split('-').map(Number);
  const calendarLabel = `${year}年${monthNumber}月のカレンダー`;
  const defaultFocusableDate = selectedDate && days.includes(selectedDate)
    ? selectedDate
    : t.startsWith(`${month}-`)
      ? t
      : days[0];

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, currentDate: ISODate) => {
    let nextIndex: number | null = null;
    const currentIndex = days.indexOf(currentDate);

    if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
    else if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex - 7;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex + 7;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = days.length - 1;
    else return;

    event.preventDefault();
    const nextDate = days[Math.max(0, Math.min(days.length - 1, nextIndex))];
    onSelectDay?.(nextDate);
    requestAnimationFrame(() => {
      event.currentTarget
        .closest('[data-month-calendar]')
        ?.querySelector<HTMLButtonElement>(`button[data-date="${nextDate}"]`)
        ?.focus();
    });
  };

  return (
    <div role="group" aria-label={calendarLabel} data-month-calendar>
      <div className="cal-grid cal-head" aria-hidden="true">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={w} className={i === 0 ? 'cal-sun' : i === 6 ? 'cal-sat' : ''}>{w}</span>
        ))}
      </div>
      <div className="cal-grid">
        {Array.from({ length: leading }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const wd = weekdayOf(d);
          const cls = [
            'cal-cell',
            d === t ? 'today' : '',
            selectedDate === d ? 'selected' : '',
            d < t ? 'past' : '',
          ].join(' ');
          const dateLabel = `${year}年${monthNumber}月${Number(d.slice(8))}日 ${WEEKDAY_FULL_LABELS[wd]}${d === t ? ' 今日' : ''}`;
          const content = (
            <>
              <span className="sr-only">{dateLabel}</span>
              <span className={`cal-daynum ${wd === 0 ? 'cal-sun' : wd === 6 ? 'cal-sat' : ''}`} aria-hidden="true">{Number(d.slice(8))}</span>
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
              data-date={d}
              tabIndex={defaultFocusableDate === d ? 0 : -1}
              onClick={() => onSelectDay(d)}
              onKeyDown={(event) => moveSelection(event, d)}
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
