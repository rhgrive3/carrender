import type {
  LearningTarget,
  MemoryAnswer,
  MemoryContentBundle,
  MemoryExample,
} from './types';

const LATIN_LETTER = /[A-Za-z]/u;
const JAPANESE_CHARACTER = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

export interface MemoryLanguageIssue {
  field: string;
  message: string;
}

export function normalizeMemoryCardText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

export function hasLatinLetter(value: string | null | undefined): boolean {
  return LATIN_LETTER.test(value ?? '');
}

export function isJapaneseOnlyText(value: string | null | undefined): boolean {
  const text = (value ?? '').trim();
  return Boolean(text) && JAPANESE_CHARACTER.test(text) && !LATIN_LETTER.test(text);
}

export function isUsableEnglishMemoryText(value: string | null | undefined): boolean {
  return Boolean((value ?? '').trim()) && hasLatinLetter(value);
}

/**
 * The simplified card editor exposes displayForm but intentionally hides
 * citationForm. Legacy/imported data can therefore contain an unusable hidden
 * citationForm that the user has no way to repair. Treat displayForm as the
 * effective base form whenever the hidden value is not usable English.
 */
export function effectiveMemoryCitationForm(
  displayForm: string | null | undefined,
  citationForm: string | null | undefined,
): string {
  const display = (displayForm ?? '').trim();
  const citation = (citationForm ?? '').trim();
  return isUsableEnglishMemoryText(citation) ? citation : display;
}

function uniqueTexts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    const key = normalizeMemoryCardText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function englishAnswersForSense(
  content: MemoryContentBundle,
  senseId: string,
  options: { verifiedOnly?: boolean } = {},
): MemoryAnswer[] {
  return content.answers.filter((answer) => (
    !answer.deletedAt
    && answer.senseId === senseId
    && (!options.verifiedOnly || answer.verificationStatus === 'verified')
    && isUsableEnglishMemoryText(answer.displayForm)
  ));
}

export function englishFormsForSense(
  content: MemoryContentBundle,
  senseId: string,
  options: { verifiedOnly?: boolean } = {},
): string[] {
  return uniqueTexts(englishAnswersForSense(content, senseId, options).map((answer) => answer.displayForm));
}

export function primaryEnglishForSense(
  content: MemoryContentBundle,
  senseId: string,
  options: { verifiedOnly?: boolean } = {},
): string | undefined {
  const firstAnswer = englishFormsForSense(content, senseId, options)[0];
  if (firstAnswer) return firstAnswer;
  const sense = content.senses.find((value) => !value.deletedAt && value.id === senseId);
  const item = sense ? content.items.find((value) => !value.deletedAt && value.id === sense.itemId) : undefined;
  return [item?.label, item?.lemma].find(isUsableEnglishMemoryText)?.trim();
}

export function examplesForSense(
  content: MemoryContentBundle,
  senseId: string,
  options: { verifiedOnly?: boolean } = {},
): MemoryExample[] {
  const seen = new Set<string>();
  const sense = content.senses.find((value) => !value.deletedAt && value.id === senseId);
  const item = sense
    ? content.items.find((value) => !value.deletedAt && value.id === sense.itemId)
    : undefined;
  // カード本体を利用者が確認済みにした後は、そのSenseへ保存済みの例文も
  // 答え合わせ資料として失わない。未確認カード自体は従来どおり出題されない。
  const reviewedCard = sense?.verificationStatus === 'verified'
    && item?.verificationStatus === 'verified';
  return content.examples
    .filter((example) => (
      !example.deletedAt
      && example.senseId === senseId
      && (!options.verifiedOnly || example.verificationStatus === 'verified' || reviewedCard)
      && isUsableEnglishMemoryText(example.english)
    ))
    .sort((left, right) => {
      const verificationOrder = Number(right.verificationStatus === 'verified')
        - Number(left.verificationStatus === 'verified');
      return verificationOrder || left.createdAt.localeCompare(right.createdAt);
    })
    .filter((example) => {
      const key = `${normalizeMemoryCardText(example.english)}\u0000${normalizeMemoryCardText(example.japanese)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function memoryTargetHasUsableLanguagePair(
  content: MemoryContentBundle,
  target: LearningTarget,
): boolean {
  const sense = content.senses.find((value) => !value.deletedAt && value.id === target.senseId);
  const item = content.items.find((value) => !value.deletedAt && value.id === target.itemId);
  if (!sense || !item || sense.itemId !== item.id || !sense.promptJa.trim()) return false;

  const english = target.answerId
    ? content.answers.find((answer) => (
      !answer.deletedAt
      && answer.id === target.answerId
      && answer.senseId === sense.id
      && isUsableEnglishMemoryText(answer.displayForm)
    ))?.displayForm
    : primaryEnglishForSense(content, sense.id, {
      verifiedOnly: target.verificationStatus === 'verified',
    });
  if (!english) return false;
  return normalizeMemoryCardText(english) !== normalizeMemoryCardText(sense.promptJa);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function checkEnglishField(
  record: Record<string, unknown>,
  field: string,
  label: string,
  optional = false,
): MemoryLanguageIssue[] {
  const value = record[field];
  if (optional && (value === undefined || value === null || value === '')) return [];
  if (typeof value !== 'string' || !isUsableEnglishMemoryText(value)) {
    return [{
      field,
      message: `${label}には英字を含む英語を入力してください。日本語だけの内容は保存できません`,
    }];
  }
  return [];
}

export function languageIssuesForMemoryEntity(
  entityType: string,
  value: unknown,
): MemoryLanguageIssue[] {
  const record = objectRecord(value);
  if (!record || typeof record.deletedAt === 'string') return [];
  switch (entityType) {
    case 'item':
      return [
        ...checkEnglishField(record, 'label', '英語表現'),
        ...checkEnglishField(record, 'lemma', '英語の見出し', true),
      ];
    case 'answer': {
      const displayIssues = checkEnglishField(record, 'displayForm', '英語表現');
      if (displayIssues.length > 0) return displayIssues;
      const effectiveCitation = effectiveMemoryCitationForm(
        typeof record.displayForm === 'string' ? record.displayForm : undefined,
        typeof record.citationForm === 'string' ? record.citationForm : undefined,
      );
      return isUsableEnglishMemoryText(effectiveCitation)
        ? []
        : [{
          field: 'citationForm',
          message: '英語の基本形には英字を含む英語を入力してください。日本語だけの内容は保存できません',
        }];
    }
    case 'example':
      return checkEnglishField(record, 'english', '例文');
    default:
      return [];
  }
}

const ENGLISH_FIELDS: Readonly<Record<string, readonly string[]>> = {
  item: ['label', 'lemma'],
  answer: ['displayForm', 'citationForm'],
  example: ['english'],
};

export function sameEnglishBearingFields(
  entityType: string,
  left: unknown,
  right: unknown,
): boolean {
  const fields = ENGLISH_FIELDS[entityType];
  const leftRecord = objectRecord(left);
  const rightRecord = objectRecord(right);
  if (!fields || !leftRecord || !rightRecord) return false;
  if (entityType === 'answer') {
    const leftDisplay = String(leftRecord.displayForm ?? '');
    const rightDisplay = String(rightRecord.displayForm ?? '');
    return normalizeMemoryCardText(leftDisplay) === normalizeMemoryCardText(rightDisplay)
      && normalizeMemoryCardText(effectiveMemoryCitationForm(leftDisplay, String(leftRecord.citationForm ?? '')))
        === normalizeMemoryCardText(effectiveMemoryCitationForm(rightDisplay, String(rightRecord.citationForm ?? '')));
  }
  return fields.every((field) => normalizeMemoryCardText(String(leftRecord[field] ?? ''))
    === normalizeMemoryCardText(String(rightRecord[field] ?? '')));
}
