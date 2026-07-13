export function validateMaterialDates(startDate: string, targetDate: string, preferredFinishDate?: string): string | null {
  if (startDate > targetDate) return '開始日は目標完了日以前にしてください';
  if (preferredFinishDate && preferredFinishDate < startDate) return '推奨完了日は開始日以降にしてください';
  if (preferredFinishDate && preferredFinishDate > targetDate) return '推奨完了日は目標完了日以前にしてください';
  return null;
}
