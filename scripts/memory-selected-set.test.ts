/** Selected-set JSON parser and additive import verification. */
/// <reference types="node" />
import {
  createSelectedSetExport,
  parseSelectedSetExport,
} from '../src/features/memory/domain/importExport';
import {
  importSelectedSetExport,
  previewSelectedSetImport,
} from '../src/features/memory/application/selectedSetImport';
import type { MemoryContentBundle, MemorySet, MemorySetMember, MemoryStat } from '../src/features/memory/domain/types';
import type { MemoryLocalSnapshot, MemoryRepository } from '../src/features/memory/infrastructure/repositories';
import type { MemoryWritePrecondition } from '../src/features/memory/infrastructure/indexedDb';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
}

const now = '2026-07-12T00:00:00.000Z';
const common = { source: 'import' as const, verificationStatus: 'verified' as const, createdAt: now, updatedAt: now, revision: 4 };
const content: MemoryContentBundle = {
  items: [{ ...common, id: 'selected-item', kind: 'word', label: 'perceive', tags: ['LEAP'] }],
  senses: [{ ...common, id: 'selected-sense', itemId: 'selected-item', promptJa: '気づく', meaningJa: '気づく', siblingGroupId: 'selected-siblings', tags: [] }],
  answers: [{ ...common, id: 'selected-answer', senseId: 'selected-sense', displayForm: 'perceive', citationForm: 'perceive', acceptedVariants: [], orthographicVariants: [] }],
  examples: [],
  exercises: [],
};
const set: MemorySet = { id: 'selected-set', name: 'LEAP', tags: ['入試'], createdAt: now, updatedAt: now, revision: 4 };
const member: MemorySetMember = { setId: set.id, itemId: content.items[0].id, order: 0, createdAt: now };
const stat: MemoryStat = {
  id: 'sense:selected-sense:output', targetType: 'sense', targetId: 'selected-sense', mode: 'output',
  attempts: 1, correctCount: 1, partialCount: 0, incorrectCount: 0, skippedCount: 0,
  consecutiveCorrect: 1, consecutiveIncorrect: 0, averageResponseMs: 300, hintCount: 0,
  manualWeak: false, weaknessScore: 10, updatedAt: now,
};
const withoutStats = createSelectedSetExport({
  sets: [set], setMembers: [member], content, selectedSetIds: [set.id], exportId: 'selected-export', exportedAt: now,
});
const withStats = createSelectedSetExport({
  sets: [set], setMembers: [member], content, selectedSetIds: [set.id], exportId: 'selected-export-stats', exportedAt: now,
  includeStats: true, stats: [stat],
});
const emptySnapshot: MemoryLocalSnapshot = {
  ...({ items: [], senses: [], answers: [], examples: [], exercises: [] } satisfies MemoryContentBundle),
  sets: [], setMembers: [], stats: [],
};

console.log('--- Selected-set JSON: strict validation and round trip ---');
{
  const direct = parseSelectedSetExport(withoutStats);
  const serialized = parseSelectedSetExport(JSON.stringify(withoutStats));
  check('統計なし出力はstatsプロパティ自体を持たない', !Object.prototype.hasOwnProperty.call(withoutStats, 'stats'), withoutStats);
  check('出力直後のオブジェクトとJSON文字列を同じ形式で再取込可能', direct.valid && serialized.valid && !direct.hasStats && !serialized.hasStats, { direct, serialized });
  const parsedStats = parseSelectedSetExport(withStats);
  check('統計は明示的に含むファイルだけ検出', parsedStats.valid && parsedStats.hasStats && parsedStats.counts?.stats === 1, parsedStats);

  const unknown = { ...withoutStats, userId: 'forbidden' };
  check('userIdなど未許可フィールドを拒否', !parseSelectedSetExport(unknown).valid, parseSelectedSetExport(unknown));
  const missingParent = { ...withoutStats, senses: withoutStats.senses.map((sense) => ({ ...sense, itemId: 'missing' })) };
  check('存在しない親IDを拒否', !parseSelectedSetExport(missingParent).valid, parseSelectedSetExport(missingParent));
  const duplicate = { ...withoutStats, answers: [...withoutStats.answers, { ...withoutStats.answers[0] }] };
  check('重複IDを拒否', !parseSelectedSetExport(duplicate).valid, parseSelectedSetExport(duplicate));
  const deletion = { ...withoutStats, items: withoutStats.items.map((item) => ({ ...item, deletedAt: now })) };
  check('選択セット形式からtombstone削除を適用しない', !parseSelectedSetExport(deletion).valid, parseSelectedSetExport(deletion));
}

console.log('--- Selected-set JSON: duplicate preview and atomic import plan ---');
{
  const fresh = previewSelectedSetImport(withoutStats, emptySnapshot);
  check('新規セット・content・memberを追加対象として数える', fresh.additions === 5 && fresh.conflicts.length === 0, fresh);

  const logicallySame: MemoryLocalSnapshot = {
    ...content,
    items: content.items.map((item) => ({ ...item, revision: 1, updatedAt: '2026-07-12T01:00:00.000Z' })),
    senses: content.senses.map((sense) => ({ ...sense, revision: 1, updatedAt: '2026-07-12T01:00:00.000Z' })),
    answers: content.answers.map((answer) => ({ ...answer, revision: 1, updatedAt: '2026-07-12T01:00:00.000Z' })),
    sets: [{ ...set, revision: 1, updatedAt: '2026-07-12T01:00:00.000Z' }],
    setMembers: [member], stats: [],
  };
  const repeated = previewSelectedSetImport(withoutStats, logicallySame);
  check('同内容IDは同期revision差だけなら安全にスキップ', repeated.additions === 0 && repeated.identical === 5 && repeated.conflicts.length === 0, repeated);

  const conflicting: MemoryLocalSnapshot = {
    ...logicallySame,
    items: logicallySame.items.map((item) => ({ ...item, label: 'different local content', revision: 2 })),
  };
  const conflictPreview = previewSelectedSetImport(withoutStats, conflicting);
  check('同一IDで内容が違うレコードを競合として表示', conflictPreview.conflicts.some((entry) => entry.entityId === 'selected-item'), conflictPreview);

  const sameStatIdDifferentTarget: MemoryLocalSnapshot = {
    ...emptySnapshot,
    stats: [{ ...stat, mode: 'input' }],
  };
  const sameStatIdentityDifferentId: MemoryLocalSnapshot = {
    ...emptySnapshot,
    stats: [{ ...stat, id: 'different-stat-id' }],
  };
  const idCollision = previewSelectedSetImport(withStats, sameStatIdDifferentTarget);
  const identityCollision = previewSelectedSetImport(withStats, sameStatIdentityDifferentId);
  check('同じStat IDが別target/modeを指す衝突を検出', idCollision.conflicts.some((entry) => entry.entityType === 'stat' && entry.reason === 'identity_conflict'), idCollision);
  check('同じtarget/modeが別Stat IDを持つ衝突を検出', identityCollision.conflicts.some((entry) => entry.entityType === 'stat' && entry.reason === 'identity_conflict'), identityCollision);

  let writes: { operations: Array<{ store: string; value?: unknown }>; mutations: Array<Record<string, unknown>>; preconditions: MemoryWritePrecondition[] } | undefined;
  const repository = {
    exportAll: async () => ({ snapshot: emptySnapshot, attempts: [], sessions: [] }),
    clientId: async () => 'selected-client',
    store: {
      writeWithPendingMutations: async (operations: Array<{ store: string; value?: unknown }>, mutations: Array<Record<string, unknown>>, preconditions: MemoryWritePrecondition[]) => {
        writes = { operations, mutations, preconditions };
      },
    },
  } as unknown as MemoryRepository;
  const imported = await importSelectedSetExport({ repository, document: withStats });
  const values = writes?.operations.map((operation) => operation.value).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') ?? [];
  check('セット・content・memberを一回のatomic writerへ渡す', imported.imported === 5 && writes?.operations.length === 5 && writes.mutations.length === 5, { imported, writes });
  check('プレビュー時の存在/不存在をatomic writerのpreconditionへ渡す', (writes?.preconditions.length ?? 0) >= 9 && writes?.preconditions.some((entry) => entry.store === 'memoryItems' && entry.key === 'selected-item' && entry.expected === undefined), writes?.preconditions);
  check('IDを維持し新規同期revisionを1へrebase', values.some((value) => value.id === 'selected-item' && value.revision === 1), values);
  check('確認なしではファイル内Statを書かない', imported.importedStats === 0 && !values.some((value) => value.id === stat.id), values);

  writes = undefined;
  const importedWithStats = await importSelectedSetExport({ repository, document: withStats, includeStats: true });
  const statsWritten = writes?.operations.some((operation) => (operation.value as { id?: string } | undefined)?.id === stat.id);
  check('明示確認時だけStatを同じatomic writerへ追加', importedWithStats.importedStats === 1 && statsWritten === true, { importedWithStats, writes });
  check('Stat IDと一意target indexを同じtransaction内で再検証', writes?.preconditions.some((entry) => entry.store === 'memoryStats' && entry.indexName === 'target' && Array.isArray(entry.key)) === true, writes?.preconditions);

  let collisionWrites = 0;
  const collisionRepository = {
    exportAll: async () => ({ snapshot: sameStatIdentityDifferentId, attempts: [], sessions: [] }),
    clientId: async () => 'selected-client',
    store: { writeWithPendingMutations: async () => { collisionWrites += 1; } },
  } as unknown as MemoryRepository;
  let collisionRejected = false;
  try {
    await importSelectedSetExport({ repository: collisionRepository, document: withStats, includeStats: true });
  } catch {
    collisionRejected = true;
  }
  check('Stat identity衝突がある取込はwrite前に拒否', collisionRejected && collisionWrites === 0, { collisionRejected, collisionWrites });
}

console.log(failures === 0 ? '\n🎉 ALL PASS (selected-set import)' : `\n💥 ${failures} FAILURES (selected-set import)`);
process.exit(failures === 0 ? 0 : 1);
