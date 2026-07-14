/** Import/export and untrusted AI JSON security verification. */
/// <reference types="node" />
import {
  CHATGPT_CONTENT_REQUEST,
  createAiContentExport,
  createFullMemoryBackup,
  createSelectedSetExport,
  detectImportTextFormat,
  findImportDuplicateCandidates,
  parseFullMemoryBackup,
  parseImportText,
  type AiContentDocument,
} from '../src/features/memory/domain/importExport';
import {
  diffAiContent,
  validateAiContentJson,
} from '../src/features/memory/domain/aiContent';
import type {
  MemoryAnswer,
  MemoryContentBundle,
  MemoryExample,
  MemoryItem,
  MemorySense,
  MemorySet,
  MemorySetMember,
  MemoryStat,
} from '../src/features/memory/domain/types';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const now = '2026-07-12T00:00:00.000Z';
const common = {
  source: 'user' as const,
  verificationStatus: 'verified' as const,
  createdAt: now,
  updatedAt: now,
  revision: 3,
};
const currentItem: MemoryItem = {
  ...common,
  id: 'item-existing',
  kind: 'expression',
  label: 'take A into account',
  tags: ['入試'],
};
const currentSense: MemorySense = {
  ...common,
  id: 'sense-existing',
  itemId: currentItem.id,
  promptJa: '〜を考慮に入れる',
  meaningJa: '事情や事実を判断材料として考慮する',
  siblingGroupId: 'siblings-existing',
  tags: ['入試'],
};
const currentAnswer: MemoryAnswer = {
  ...common,
  id: 'answer-existing',
  senseId: currentSense.id,
  displayForm: 'take A into account',
  citationForm: 'take A into account',
  pattern: 'take {object} into account',
  acceptedVariants: ['take it into account'],
  orthographicVariants: ['take A into account (BrE)'],
};
const current: MemoryContentBundle = {
  items: [currentItem],
  senses: [currentSense],
  answers: [currentAnswer],
  examples: [],
  exercises: [],
};

console.log('--- Memory import: format detection and parsing ---');
{
  check('空入力を判定', detectImportTextFormat('  ') === 'empty');
  check('JSONを判定', detectImportTextFormat('[{"english":"a","japanese":"あ"}]') === 'json');
  check('TSV/コピー表を判定', detectImportTextFormat('英語\t日本語\nperceive\t気づく') === 'tsv');
  check('矢印形式を判定', detectImportTextFormat('perceive → 気づく') === 'arrow');
  check('等号形式を判定', detectImportTextFormat('perceive = 気づく') === 'equals');
  check('カンマ形式をCSV判定', detectImportTextFormat('perceive,気づく') === 'csv');

  const csv = parseImportText('英語,日本語,意味・ニュアンス,例文,タグ,セット\n"take A, B into account",考慮する,判断材料にする,"Take A, B into account.",入試、熟語,LEAP');
  check(
    'CSVヘッダー・引用符内カンマ・追加列を解析',
    csv.format === 'csv'
      && csv.errors.length === 0
      && csv.rows[0].english === 'take A, B into account'
      && csv.rows[0].meaning === '判断材料にする'
      && csv.rows[0].tags.length === 2
      && csv.rows[0].setName === 'LEAP',
    csv,
  );

  const tsv = parseImportText('日本語\t英語\tタグ\n気づく\tperceive\tLEAP,単語');
  check('TSVは日本語/英語列順をヘッダーで対応', tsv.errors.length === 0 && tsv.rows[0].english === 'perceive' && tsv.rows[0].japanese === '気づく', tsv);

  const equals = parseImportText('take A into account = 〜を考慮に入れる\nallow for A = Aを考慮する');
  check('等号形式を複数行解析', equals.format === 'equals' && equals.rows.length === 2 && equals.errors.length === 0, equals);

  const arrow = parseImportText('perceive → 気づく\nconfine O to A -> OをAに限定する');
  check('Unicode/ASCII矢印形式を解析', arrow.format === 'arrow' && arrow.rows.length === 2 && arrow.errors.length === 0, arrow);

  const json = parseImportText(JSON.stringify([
    { english: 'environment', japanese: '環境', tags: ['単語'] },
    { displayForm: 'allow for A', promptJa: 'Aを考慮する', tags: '熟語,入試' },
  ]));
  check('簡易JSON配列を解析', json.format === 'json' && json.rows.length === 2 && json.rows[1].tags.length === 2, json);

  const badCsv = parseImportText('english,japanese\n"unclosed,日本語');
  check('閉じていないCSV引用符をエラー', badCsv.errors.some((error) => /引用符/.test(error.message)), badCsv);

  const hundred = parseImportText(Array.from({ length: 100 }, (_, index) => `word-${index}\t意味-${index}`).join('\n'));
  check('100件のコピー表を欠損なく解析', hundred.rows.length === 100 && hundred.errors.length === 0, { rows: hundred.rows.length, errors: hundred.errors });

  const html = parseImportText('<table><tr><td>word</td><td>意味</td></tr></table>');
  check('HTML表を実行対象にせず拒否', html.rows.length === 0 && html.errors.length > 0, html);

  const eventHandler = parseImportText('<img src=x onerror=alert(1)> = 危険');
  check('event handlerを含む取込文字列を拒否', eventHandler.rows.length === 0 && eventHandler.errors.length > 0, eventHandler);

  const javascriptUrl = parseImportText('javascript:alert(1) = 危険');
  check('javascript URLを含む取込文字列を拒否', javascriptUrl.rows.length === 0 && javascriptUrl.errors.length > 0, javascriptUrl);

  let deeplyNested: unknown = 'value';
  for (let depth = 0; depth < 15; depth += 1) deeplyNested = [deeplyNested];
  const deepJson = parseImportText(JSON.stringify({ rows: deeplyNested }));
  check('通常JSON取込も異常な深さを拒否', deepJson.rows.length === 0 && deepJson.errors.some((error) => /深すぎ/.test(error.message)), deepJson);

  const unknownJson = parseImportText(JSON.stringify([{ english: 'word', japanese: '意味', userId: 'forbidden' }]));
  check('通常JSON取込も未許可フィールドを拒否', unknownJson.rows.length === 0 && unknownJson.errors.some((error) => /許可されていない/.test(error.message)), unknownJson);

  const longJson = parseImportText(JSON.stringify([{ english: 'a'.repeat(20_001), japanese: '意味' }]));
  check('通常JSON取込も極端に長い文字列を拒否', longJson.rows.length === 0 && longJson.errors.some((error) => /20000/.test(error.message)), longJson);
}

console.log('--- Memory export: AI-safe content only ---');
const exported = createAiContentExport(current, {
  exportId: 'export-1',
  baseRevision: 3,
  exportedAt: now,
});
{
  const keys = Object.keys(exported).sort();
  check(
    'AI用出力はcontentとメタデータだけ',
    JSON.stringify(keys) === JSON.stringify([
      'answers', 'baseRevision', 'examples', 'exercises', 'exportId', 'exportType',
      'exportedAt', 'items', 'schemaVersion', 'senses',
    ]),
    keys,
  );
  const serialized = JSON.stringify(exported).toLocaleLowerCase('en-US');
  check('AI用出力に成績・履歴・セッション・ユーザー情報なし', !/(memorystat|attempt|session|user_id|email|clientid)/u.test(serialized), serialized);
  check('AI用出力で既存IDを維持', exported.items[0].id === currentItem.id && exported.answers[0].id === currentAnswer.id, exported);
  check('ChatGPT依頼文に保護ルールを含む', /既存idを変更しない/.test(CHATGPT_CONTENT_REQUEST) && /成績、回答履歴、セッション/.test(CHATGPT_CONTENT_REQUEST), CHATGPT_CONTENT_REQUEST);
  check(
    'ChatGPTへ求める補完は例文だけ',
    /追加してよいのはexamples配列の新規要素だけ/.test(CHATGPT_CONTENT_REQUEST)
      && /items、senses、answers、exercisesを追加・変更・削除しない/.test(CHATGPT_CONTENT_REQUEST)
      && !/別の意味|別表現|穴埋め問題|指定英作問題|文脈選択問題/.test(CHATGPT_CONTENT_REQUEST),
    CHATGPT_CONTENT_REQUEST,
  );
}

console.log('--- Memory AI import: validation and isolation ---');
const newAnswer: MemoryAnswer = {
  id: 'answer-ai-new',
  senseId: currentSense.id,
  displayForm: 'take account of A',
  citationForm: 'take account of A',
  acceptedVariants: [],
  orthographicVariants: [],
  source: 'ai',
  verificationStatus: 'unverified_ai',
  createdAt: now,
  updatedAt: now,
  revision: 1,
};
const newExample: MemoryExample = {
  id: 'example-ai-new',
  senseId: currentSense.id,
  answerId: currentAnswer.id,
  english: 'We must take the cost into account.',
  japanese: '私たちは費用を考慮に入れなければならない。',
  source: 'ai',
  verificationStatus: 'unverified_ai',
  createdAt: now,
  updatedAt: now,
  revision: 1,
};
const validDocument: AiContentDocument = {
  ...clone(exported),
  examples: [...clone(exported.examples), newExample],
};
{
  const valid = validateAiContentJson(JSON.stringify(validDocument), {
    currentContent: current,
    currentBaseRevision: 3,
  });
  check('正しいAI追加JSONを受理', valid.valid && !!valid.document && valid.issues.length === 0, valid);
  check('AI追加は未確認メタデータのまま隔離', valid.document?.examples.at(-1)?.source === 'ai' && valid.document.examples.at(-1)?.verificationStatus === 'unverified_ai', valid.document?.examples.at(-1));

  const stale = validateAiContentJson(validDocument, { currentContent: current, currentBaseRevision: 4 });
  check(
    'baseRevision不一致を上書きせず警告',
    stale.valid && stale.hasBaseRevisionConflict && stale.issues.some((entry) => entry.code === 'base_revision_conflict' && entry.severity === 'warning'),
    stale,
  );

  const badMetadata = clone(validDocument);
  badMetadata.examples.at(-1)!.source = 'user';
  badMetadata.examples.at(-1)!.verificationStatus = 'verified';
  const metadataResult = validateAiContentJson(badMetadata, { currentContent: current });
  check('AI新規データのverified/user偽装を拒否', !metadataResult.valid && metadataResult.issues.some((entry) => entry.code === 'new_ai_metadata'), metadataResult);

  const addedAnswer = clone(exported);
  addedAnswer.answers.push(newAnswer);
  const addedAnswerResult = validateAiContentJson(addedAnswer, { currentContent: current });
  check('AIが例文以外を追加した場合は拒否', !addedAnswerResult.valid && addedAnswerResult.issues.some((entry) => entry.code === 'example_only_violation'), addedAnswerResult);

  const changedExistingExample = clone(validDocument);
  changedExistingExample.items[0].label = 'changed by AI';
  const changedExistingResult = validateAiContentJson(changedExistingExample, { currentContent: current });
  check('AIが既存内容を変更した場合は拒否', !changedExistingResult.valid && changedExistingResult.issues.some((entry) => entry.code === 'example_only_violation'), changedExistingResult);

  const protectedChange = clone(validDocument);
  protectedChange.items[0].revision += 1;
  protectedChange.items[0].verificationStatus = 'unverified_ai';
  const protectedResult = validateAiContentJson(protectedChange, { currentContent: current });
  check('AIによるrevision/verified状態の変更を拒否', !protectedResult.valid && protectedResult.issues.filter((entry) => entry.code === 'protected_change').length >= 2, protectedResult);

  const changedId = clone(exported);
  changedId.answers[0] = {
    ...changedId.answers[0],
    id: 'answer-illegally-renamed',
    source: 'ai',
    verificationStatus: 'unverified_ai',
    revision: 1,
  };
  const changedIdResult = validateAiContentJson(changedId, { currentContent: current });
  check(
    'AIが既存IDを新規IDへすり替えた場合に拒否',
    !changedIdResult.valid
      && changedIdResult.issues.some((entry) => entry.code === 'protected_change' && entry.path.endsWith('.id')),
    changedIdResult,
  );

  const forbidden = { ...clone(validDocument), stats: [{ targetId: 'sense-existing', attempts: 999 }], userId: 'victim' };
  const forbiddenResult = validateAiContentJson(forbidden, { currentContent: current });
  check('AIによる統計・userId追加を拒否', !forbiddenResult.valid && forbiddenResult.issues.some((entry) => entry.code === 'forbidden_field'), forbiddenResult);

  const missingParent = clone(validDocument);
  missingParent.examples.at(-1)!.senseId = 'sense-missing';
  const missingParentResult = validateAiContentJson(missingParent, { currentContent: current });
  check('存在しない親IDを拒否', !missingParentResult.valid && missingParentResult.issues.some((entry) => entry.code === 'missing_parent'), missingParentResult);

  const duplicate = clone(validDocument);
  duplicate.items.push(clone(duplicate.items[0]));
  const duplicateResult = validateAiContentJson(duplicate, { currentContent: current });
  check('重複IDを拒否', !duplicateResult.valid && duplicateResult.issues.some((entry) => entry.code === 'duplicate_id'), duplicateResult);

  const dangerous = clone(validDocument);
  dangerous.examples.at(-1)!.note = '<img src=x onerror=alert(1)>';
  const dangerousResult = validateAiContentJson(dangerous, { currentContent: current });
  check('script/event handler/iframe/javascript URLを危険文字列として拒否', !dangerousResult.valid && dangerousResult.issues.some((entry) => entry.code === 'dangerous_text'), dangerousResult);

  const external = clone(validDocument);
  external.examples.at(-1)!.note = 'https://attacker.example/collect';
  const externalResult = validateAiContentJson(external, { currentContent: current });
  check('不正な外部URLを拒否', !externalResult.valid && externalResult.issues.some((entry) => entry.code === 'external_url'), externalResult);

  const tooLong = clone(validDocument);
  tooLong.examples.at(-1)!.note = 'x'.repeat(101);
  const tooLongResult = validateAiContentJson(tooLong, { currentContent: current, maxStringLength: 100 });
  check('極端に長い文字列を拒否', !tooLongResult.valid && tooLongResult.issues.some((entry) => entry.code === 'string_too_long'), tooLongResult);

  const unknown = clone(validDocument) as AiContentDocument & { ownership?: string };
  unknown.ownership = 'other';
  const unknownResult = validateAiContentJson(unknown, { currentContent: current });
  check('許可されていないフィールドを拒否', !unknownResult.valid && unknownResult.issues.some((entry) => entry.code === 'unknown_field'), unknownResult);
}

console.log('--- Memory AI import: diff preview only ---');
{
  const changed = clone(validDocument);
  changed.items[0].label = 'changed label';
  changed.answers = [newAnswer]; // existing answer omission is a deletion preview
  const before = JSON.stringify(current);
  const diff = diffAiContent(current, changed);
  check(
    'AI差分で追加・変更・削除を個別集計',
    diff.summary.newAnswers === 1 && diff.summary.changed === 1 && diff.summary.deleted === 1,
    diff,
  );
  check('削除は差分プレビューだけで元データを変更しない', JSON.stringify(current) === before && diff.operations.some((entry) => entry.kind === 'delete'), diff);
}

console.log('--- Memory import: duplicate preview ---');
{
  const rows = [
    { english: 'take A into account', japanese: '〜を考慮に入れる', tags: [], sourceLine: 1 },
    { english: ' TAKE   A INTO ACCOUNT. ', japanese: '別の意味', tags: [], sourceLine: 2 },
    { english: 'take A into account (BrE)', japanese: '別の意味', tags: [], sourceLine: 3 },
  ];
  const candidates = findImportDuplicateCandidates(rows, current);
  check('同じItem候補を提示', candidates.some((entry) => entry.rowIndex === 0 && entry.kind === 'same_item'), candidates);
  check('同じSense候補を提示', candidates.some((entry) => entry.rowIndex === 0 && entry.kind === 'same_sense'), candidates);
  check('同じAnswer候補を提示', candidates.some((entry) => entry.rowIndex === 0 && entry.kind === 'same_answer'), candidates);
  check('正規化後一致を別候補として提示', candidates.some((entry) => entry.rowIndex === 1 && entry.kind === 'normalized_answer'), candidates);
  check('表記差Answer候補を提示', candidates.some((entry) => entry.rowIndex === 2 && entry.kind === 'orthographic_answer'), candidates);
  check('重複プレビューは元コンテンツを自動統合しない', current.answers.length === 1 && current.answers[0].id === currentAnswer.id, current);
}

console.log('--- Memory export: selected sets and full backup ---');
{
  const sets: MemorySet[] = [
    { id: 'set-a', name: 'LEAP', tags: [], createdAt: now, updatedAt: now, revision: 1 },
    { id: 'set-b', name: '英作文', tags: [], createdAt: now, updatedAt: now, revision: 1 },
    { id: 'set-c', name: '対象外', tags: [], createdAt: now, updatedAt: now, revision: 1 },
  ];
  const members: MemorySetMember[] = [
    { setId: 'set-a', itemId: currentItem.id, order: 0, createdAt: now },
    { setId: 'set-b', itemId: currentItem.id, order: 0, createdAt: now },
    { setId: 'set-c', itemId: 'item-outside', order: 0, createdAt: now },
  ];
  const stat: MemoryStat = {
    id: 'sense-output', targetType: 'sense', targetId: currentSense.id, mode: 'output', attempts: 2,
    correctCount: 1, partialCount: 0, incorrectCount: 1, skippedCount: 0, consecutiveCorrect: 0,
    consecutiveIncorrect: 1, averageResponseMs: 1000, hintCount: 0, manualWeak: false, weaknessScore: 50,
    revision: 2, updatedAt: now,
  };
  const selected = createSelectedSetExport({
    sets,
    setMembers: members,
    content: current,
    selectedSetIds: ['set-a', 'set-b'],
    exportId: 'selected-export',
    exportedAt: now,
    stats: [stat],
  });
  check('選択セットだけを出力', selected.sets.length === 2 && selected.sets.every((set) => set.id !== 'set-c'), selected.sets);
  check('複数セットが同一Itemを参照してもcontentは1件', selected.setMembers.length === 2 && selected.items.length === 1 && selected.senses.length === 1, selected);
  check('選択セット出力は初期状態で統計を含めない', !JSON.stringify(selected).includes('"stats"'), selected);

  const selectedWithStats = createSelectedSetExport({
    sets,
    setMembers: members,
    content: current,
    selectedSetIds: ['set-a'],
    exportId: 'selected-stats-export',
    exportedAt: now,
    includeStats: true,
    stats: [stat, { ...stat, id: 'outside', targetId: 'outside' }],
  });
  check('明示時のみ参照contentの統計を含む', selectedWithStats.stats?.length === 1 && selectedWithStats.stats[0].targetId === currentSense.id, selectedWithStats.stats);

  const attempt = {
    attemptId: 'attempt-1', sessionId: 'session-1', clientId: 'client-1', itemId: currentItem.id,
    senseId: currentSense.id, targetId: `output:${currentSense.id}`, mode: 'output' as const,
    exerciseType: 'flashcard' as const, assessment: 'incorrect' as const, errorTypes: ['recall' as const],
    hintUsed: false, responseMs: 1200, createdAt: now, undoneAt: '2026-07-12T00:01:00.000Z',
  };
  const session = {
    id: 'session-1', status: 'completed' as const, selectedSetIds: ['set-a'], initialTargetIds: [attempt.targetId],
    config: { questionCount: { type: 'count' as const, count: 1 }, direction: 'output' as const, includeUnverifiedAi: false },
    seed: 'seed', queueState: {}, completedTargetIds: [], needsReviewTargetIds: [attempt.targetId],
    answerCount: 1, createdAt: now, updatedAt: now, completedAt: now,
  };
  const backup = createFullMemoryBackup({
    sets,
    setMembers: members,
    content: current,
    stats: [stat],
    attempts: [attempt],
    sessions: [session],
    settings: { defaultDirection: 'output' },
    exportedAt: now,
  });
  check(
    '完全バックアップは復元用データ一式を含む',
    backup.exportType === 'full-backup'
      && backup.backupVersion === 1
      && backup.stats.length === 1
      && backup.attempts.length === 1
      && backup.sessions.length === 1
      && backup.settings.defaultDirection === 'output',
    backup,
  );
  check(
    '取消済みAttemptは元ログと取消時刻を保ったまま出力',
    backup.attempts[0].attemptId === attempt.attemptId
      && backup.attempts[0].undoneAt === attempt.undoneAt,
    backup.attempts[0],
  );

  const validRestoreBackup = {
    ...backup,
    sets: backup.sets
      .filter((set) => set.id !== 'set-c')
      .map((set) => set.id === 'set-b' ? { ...set, deletedAt: '2026-07-12T00:02:00.000Z' } : set),
    setMembers: backup.setMembers
      .filter((member) => member.itemId === currentItem.id)
      .map((member) => member.setId === 'set-b' ? { ...member, deletedAt: '2026-07-12T00:02:00.000Z' } : member),
  };
  const parsedBackup = parseFullMemoryBackup(JSON.stringify(validRestoreBackup));
  check(
    '完全バックアップを全参照検証して復元可能データへ変換',
    parsedBackup.valid
      && parsedBackup.backup?.attempts[0].attemptId === attempt.attemptId
      && parsedBackup.backup.attempts[0].undoneAt === attempt.undoneAt
      && parsedBackup.backup.stats[0].revision === 2
      && parsedBackup.counts?.sets === 2
      && parsedBackup.counts.attempts === 1,
    parsedBackup,
  );
  check(
    '完全バックアップ解析はSetと参照Memberのtombstoneを保持',
    parsedBackup.backup?.sets.find((set) => set.id === 'set-b')?.deletedAt === '2026-07-12T00:02:00.000Z'
      && parsedBackup.backup.setMembers.find((member) => member.setId === 'set-b')?.deletedAt === '2026-07-12T00:02:00.000Z',
    parsedBackup.backup,
  );

  const missingParent = clone(validRestoreBackup);
  missingParent.senses[0].itemId = 'missing-item';
  const missingParentResult = parseFullMemoryBackup(missingParent);
  check(
    '存在しない親IDを復元前に拒否',
    !missingParentResult.valid && missingParentResult.issues.some((issue) => issue.code === 'missing_parent'),
    missingParentResult,
  );

  const duplicateAttempt = clone(validRestoreBackup);
  duplicateAttempt.attempts.push(clone(duplicateAttempt.attempts[0]));
  const duplicateResult = parseFullMemoryBackup(duplicateAttempt);
  check(
    '重複attemptIdを復元前に拒否',
    !duplicateResult.valid && duplicateResult.issues.some((issue) => issue.code === 'duplicate_id'),
    duplicateResult,
  );

  const unknownField = clone(validRestoreBackup) as typeof validRestoreBackup & { userId?: string };
  unknownField.userId = 'do-not-import';
  const unknownResult = parseFullMemoryBackup(unknownField);
  check(
    'ユーザー情報を含む未知フィールドを拒否',
    !unknownResult.valid && unknownResult.issues.some((issue) => issue.code === 'unknown_field'),
    unknownResult,
  );

  const dangerousBackup = clone(validRestoreBackup);
  dangerousBackup.senses[0].explanation = '<iframe src="javascript:alert(1)"></iframe>';
  const dangerousResult = parseFullMemoryBackup(dangerousBackup);
  check(
    '実行可能HTMLを含むバックアップを拒否',
    !dangerousResult.valid && dangerousResult.issues.some((issue) => issue.code === 'dangerous_text'),
    dangerousResult,
  );

  const deepBackup = clone(validRestoreBackup);
  let nested: Record<string, unknown> = {};
  deepBackup.settings = nested;
  for (let index = 0; index < 15; index += 1) {
    nested.next = {};
    nested = nested.next as Record<string, unknown>;
  }
  const deepResult = parseFullMemoryBackup(deepBackup);
  check(
    '異常に深いJSONを拒否',
    !deepResult.valid && deepResult.issues.some((issue) => issue.code === 'too_deep'),
    deepResult,
  );

  const malformedResult = parseFullMemoryBackup('{"exportType":"full-backup"');
  check(
    '壊れたJSONを復元前に拒否',
    !malformedResult.valid && malformedResult.issues.some((issue) => issue.code === 'invalid_json'),
    malformedResult,
  );
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory import/AI)' : `\n💥 ${failures} FAILURES (memory import/AI)`);
process.exit(failures === 0 ? 0 : 1);
