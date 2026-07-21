import {
  englishFormsForSense,
  examplesForSense,
  primaryEnglishForSense,
} from './cardIntegrity';
import type { MemoryExample, MemorySetBundle } from './types';

export interface MemorySetCardRow {
  itemId: string;
  senseId: string;
  japanese: string;
  englishForms: string[];
  examples: MemoryExample[];
  hasUnverified: boolean;
  itemSenseCount: number;
  senseIndex: number;
  isFirstSense: boolean;
  searchText: string;
}

/**
 * The UI and study queue define one card as one Sense. Old versions sometimes
 * stored unrelated cards as multiple Senses under one Item, so rendering one
 * row per Item recreates the giant slash-joined card. This selector keeps the
 * storage graph intact while presenting every Sense as its own card.
 */
export function buildMemorySetCardRows(bundle: MemorySetBundle): MemorySetCardRow[] {
  const memberOrder = new Map(bundle.setMembers
    .filter((member) => !member.deletedAt)
    .map((member) => [member.itemId, member.order]));
  const items = bundle.items
    .filter((item) => !item.deletedAt && memberOrder.has(item.id))
    .sort((left, right) => (
      (memberOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (memberOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        || left.createdAt.localeCompare(right.createdAt)
    ));

  return items.flatMap((item) => {
    const senses = bundle.senses
      .filter((sense) => !sense.deletedAt && sense.itemId === item.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return senses.map((sense, senseIndex): MemorySetCardRow => {
      const answers = bundle.answers.filter((answer) => !answer.deletedAt && answer.senseId === sense.id);
      const examples = examplesForSense(bundle, sense.id);
      const exercises = bundle.exercises.filter((exercise) => !exercise.deletedAt && exercise.senseId === sense.id);
      const answerForms = englishFormsForSense(bundle, sense.id);
      const primaryEnglish = primaryEnglishForSense(bundle, sense.id);
      const englishForms = answerForms.length > 0
        ? answerForms
        : primaryEnglish ? [primaryEnglish] : [];
      const hasUnverified = [item, sense, ...answers, ...examples, ...exercises]
        .some((record) => record.verificationStatus === 'unverified_ai');
      const searchText = [
        sense.promptJa,
        sense.meaningJa,
        ...englishForms,
        ...examples.flatMap((example) => [example.english, example.japanese ?? '']),
      ].join('\n').normalize('NFKC').toLocaleLowerCase('ja-JP');
      return {
        itemId: item.id,
        senseId: sense.id,
        japanese: sense.promptJa,
        englishForms,
        examples,
        hasUnverified,
        itemSenseCount: senses.length,
        senseIndex,
        isFirstSense: senseIndex === 0,
        searchText,
      };
    });
  });
}
