/** 下部ナビ用アイコン(lucide)。currentColorでアクティブ色に追従し、選択中はストロークを太くする */
import { Home, CalendarDays, BookOpen, History, ChartColumn, ListRestart } from 'lucide-react';

const navProps = (active: boolean) =>
  ({
    size: 23,
    strokeWidth: active ? 2.5 : 1.8,
    'aria-hidden': true,
  }) as const;

export function IconHome({ active }: { active: boolean }) {
  return <Home {...navProps(active)} />;
}

export function IconPlan({ active }: { active: boolean }) {
  return <CalendarDays {...navProps(active)} />;
}

export function IconBook({ active }: { active: boolean }) {
  return <BookOpen {...navProps(active)} />;
}

export function IconTimer({ active }: { active: boolean }) {
  return <History {...navProps(active)} />;
}

export function IconChart({ active }: { active: boolean }) {
  return <ChartColumn {...navProps(active)} />;
}

export function IconHistory({ active }: { active: boolean }) {
  return <ListRestart {...navProps(active)} />;
}
