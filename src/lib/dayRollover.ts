export function resolveDayRollover(previousDay: string, currentDay: string): string {
  return previousDay === currentDay ? previousDay : currentDay;
}
