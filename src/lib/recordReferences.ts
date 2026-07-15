import type { Material, Subject } from '../types';

export interface MissingRecordReferenceOption {
  id: string;
  label: string;
}

/** 現在の科目一覧に存在しない記録参照を、編集画面で明示する。 */
export function missingRecordSubjectOption(
  subjects: Pick<Subject, 'id'>[],
  subjectId: string,
): MissingRecordReferenceOption | null {
  if (!subjectId || subjects.some((subject) => subject.id === subjectId)) return null;
  return { id: subjectId, label: '削除済みの科目' };
}

/**
 * 表示中の教材候補に存在しない記録参照を、空欄にせず編集画面へ残す。
 * visibleMaterials を受け取るため、科目との不整合がある古い記録も保護できる。
 */
export function missingRecordMaterialOption(
  visibleMaterials: Pick<Material, 'id'>[],
  materialId: string | null,
  fallbackLabel: string,
): MissingRecordReferenceOption | null {
  if (!materialId || visibleMaterials.some((material) => material.id === materialId)) return null;
  const label = fallbackLabel.trim();
  return {
    id: materialId,
    label: label ? `${label}（削除済み）` : '削除済みの教材',
  };
}
