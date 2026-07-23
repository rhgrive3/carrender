import type { MemorySenseDraft } from './editContent';

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function answerHasContent(answer: MemorySenseDraft['answers'][number]): boolean {
  return Boolean(
    hasText(answer.displayForm)
    || hasText(answer.citationForm)
    || hasText(answer.pattern)
    || hasText(answer.acceptedVariants)
    || hasText(answer.orthographicVariants)
    || answer.register
    || hasText(answer.nuance)
    || hasText(answer.note)
  );
}

function exampleHasContent(example: MemorySenseDraft['examples'][number]): boolean {
  return Boolean(
    hasText(example.english)
    || hasText(example.japanese)
    || hasText(example.note)
  );
}

function exerciseHasContent(exercise: NonNullable<MemorySenseDraft['exercises']>[number]): boolean {
  return Boolean(
    hasText(exercise.prompt)
    || hasText(exercise.context)
    || exercise.answerIndex !== undefined
    || (exercise.acceptedAnswerIndexes?.length ?? 0) > 0
    || hasText(exercise.requiredTokens)
    || hasText(exercise.forbiddenTokens)
    || hasText(exercise.explanation)
    || hasText(exercise.hint)
  );
}

export function memorySenseDraftHasUserContent(sense: MemorySenseDraft): boolean {
  return Boolean(
    hasText(sense.promptJa)
    || hasText(sense.meaningJa)
    || hasText(sense.explanation)
    || hasText(sense.tags)
    || sense.answers.some(answerHasContent)
    || sense.examples.some(exampleHasContent)
    || (sense.exercises ?? []).some(exerciseHasContent)
  );
}

export function selectValidMemorySenseDrafts(
  senses: readonly MemorySenseDraft[],
  unitLabel: 'カード' | '意味',
): MemorySenseDraft[] {
  for (const [index, sense] of senses.entries()) {
    if (hasText(sense.promptJa)) continue;
    if (sense.id) {
      throw new Error(`${unitLabel}${index + 1}の日本語が空です。削除する場合は削除ボタンを使ってください`);
    }
    if (memorySenseDraftHasUserContent(sense)) {
      throw new Error(`${unitLabel}${index + 1}に日本語を入力してください`);
    }
  }
  return senses.filter((sense) => hasText(sense.promptJa));
}
