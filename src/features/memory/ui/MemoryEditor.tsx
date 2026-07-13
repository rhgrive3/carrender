import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Save, Table2, Trash2 } from 'lucide-react';
import type { MemoryContentBundle, MemoryItemKind } from '../domain/types';
import {
  saveMemoryItemDraft,
  type MemoryExerciseDraft,
  type MemoryItemDraft,
  type MemorySenseDraft,
} from '../application/editContent';
import { Disclosure } from '../../../components/ui/bits';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';
import { MemoryBulkEditor } from './MemoryBulkEditor';

function blankSense(): MemorySenseDraft {
  return { promptJa: '', meaningJa: '', answers: [{ displayForm: '' }], examples: [], exercises: [] };
}

function blankExercise(): MemoryExerciseDraft {
  return { type: 'fill_blank', prompt: '', acceptedAnswerIndexes: [] };
}

const EXERCISE_TYPES: Array<[MemoryExerciseDraft['type'], string]> = [
  ['flashcard', '高速カード'],
  ['typed_output', '入力式'],
  ['fill_blank', '穴埋め'],
  ['reorder', '語順整序'],
  ['multiple_choice', '選択式'],
  ['guided_composition', '指定英作'],
  ['free_composition', '自由英作文'],
];

function draftFromContent(content: MemoryContentBundle, itemId: string): MemoryItemDraft | null {
  const item = content.items.find((value) => value.id === itemId);
  if (!item) return null;
  const senses = content.senses.filter((sense) => sense.itemId === item.id).map((sense): MemorySenseDraft => {
    const senseAnswers = content.answers.filter((answer) => answer.senseId === sense.id);
    const answerIndex = new Map(senseAnswers.map((answer, index) => [answer.id, index]));
    return {
      id: sense.id,
      siblingGroupId: sense.siblingGroupId,
      promptJa: sense.promptJa,
      meaningJa: sense.meaningJa,
      explanation: sense.explanation,
      tags: sense.tags.join(', '),
      answers: senseAnswers.map((answer) => ({
        id: answer.id,
        displayForm: answer.displayForm,
        citationForm: answer.citationForm,
        pattern: answer.pattern,
        acceptedVariants: answer.acceptedVariants.join(', '),
        orthographicVariants: answer.orthographicVariants.join(', '),
        register: answer.register,
        nuance: answer.nuance,
        note: answer.note,
      })),
      examples: content.examples.filter((example) => example.senseId === sense.id).map((example) => ({
        id: example.id,
        english: example.english,
        japanese: example.japanese,
        note: example.note,
        answerId: example.answerId,
      })),
      exercises: content.exercises.filter((exercise) => exercise.senseId === sense.id).map((exercise) => ({
        id: exercise.id,
        type: exercise.type,
        prompt: exercise.prompt,
        context: exercise.context,
        answerIndex: exercise.answerId ? answerIndex.get(exercise.answerId) : undefined,
        acceptedAnswerIndexes: exercise.acceptedAnswerIds.flatMap((id) => {
          const index = answerIndex.get(id);
          return index === undefined ? [] : [index];
        }),
        requiredTokens: exercise.requiredTokens?.join(', '),
        forbiddenTokens: exercise.forbiddenTokens?.join(', '),
        explanation: exercise.explanation,
        hint: exercise.hint,
      })),
    };
  });
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    lemma: item.lemma,
    tags: item.tags.join(', '),
    senses: senses.length > 0 ? senses : [blankSense()],
  };
}

export function MemoryEditor({ setId, itemId, bulk = false }: { setId?: string; itemId?: string; bulk?: boolean }) {
  const { repository, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [original, setOriginal] = useState<MemoryContentBundle>();
  const [draft, setDraft] = useState<MemoryItemDraft>({ kind: 'expression', senses: [blankSense()] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!repository || !itemId) return;
    let cancelled = false;
    void repository.loadContent().then((content) => {
      if (cancelled) return;
      setOriginal(content);
      const loaded = draftFromContent(content, itemId);
      if (loaded) setDraft(loaded);
    });
    return () => { cancelled = true; };
  }, [repository, itemId]);

  if (bulk) return <MemoryBulkEditor setId={setId} />;

  const updateSense = (index: number, update: (sense: MemorySenseDraft) => MemorySenseDraft) => {
    setDraft((current) => ({ ...current, senses: current.senses.map((sense, at) => at === index ? update(sense) : sense) }));
  };

  const save = async (continueNext: boolean) => {
    if (!repository || saving) return;
    setSaving(true);
    try {
      const members = setId ? await repository.listSetMembers(setId) : [];
      await saveMemoryItemDraft({ repository, draft, original, setId, setOrder: members.length });
      await refresh();
      void requestSync(true);
      toast(itemId ? '暗記項目を更新しました' : '暗記項目を保存しました');
      if (continueNext && !itemId) {
        setDraft({ kind: draft.kind, tags: draft.tags, senses: [blankSense()] });
        setOriginal(undefined);
        document.getElementById('memory-prompt-0')?.focus();
      } else {
        navigate(setId ? { name: 'set', setId } : { name: 'home' });
      }
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="memory-editor">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="戻る" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>{itemId ? '暗記項目を編集' : '暗記項目を追加'}</h2><p>一つの意味に自然な英語表現を複数登録できます</p></div>
        {!itemId && <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'editor', setId, bulk: true })}><Table2 size={18} />表形式</button>}
      </div>

      <div className="memory-editor-card card">
        <div className="field-row">
          <div className="field">
            <label htmlFor="memory-kind">種類</label>
            <select id="memory-kind" value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as MemoryItemKind }))}>
              <option value="word">単語</option><option value="phrase">熟語</option><option value="expression">表現</option><option value="construction">構文</option><option value="composition">英作文</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="memory-item-tags">タグ</label>
            <input id="memory-item-tags" value={draft.tags ?? ''} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="入試, 語法" />
          </div>
        </div>
        <Disclosure title="項目全体の詳細" summary={draft.label || draft.lemma || undefined}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="memory-item-label">表示見出し</label>
              <input id="memory-item-label" value={draft.label ?? ''} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="未入力なら最初の英語表現" />
            </div>
            <div className="field">
              <label htmlFor="memory-item-lemma">辞書形・Lemma</label>
              <input id="memory-item-lemma" value={draft.lemma ?? ''} onChange={(event) => setDraft((current) => ({ ...current, lemma: event.target.value }))} placeholder="未入力なら最初の英語表現" />
            </div>
          </div>
        </Disclosure>

        {draft.senses.map((sense, senseIndex) => (
          <fieldset className="memory-sense-editor" key={sense.id ?? `new-${senseIndex}`}>
            <legend>意味 {senseIndex + 1}</legend>
            {draft.senses.length > 1 && (
              <button type="button" className="memory-fieldset-remove" aria-label={`意味${senseIndex + 1}を削除`} onClick={() => setDraft((current) => ({ ...current, senses: current.senses.filter((_, index) => index !== senseIndex) }))}><Trash2 size={17} />削除</button>
            )}
            <div className="field">
              <label htmlFor={`memory-prompt-${senseIndex}`}>日本語</label>
              <input id={`memory-prompt-${senseIndex}`} value={sense.promptJa} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, promptJa: event.target.value }))} placeholder="例：〜を考慮に入れる" />
            </div>
            <div className="memory-answer-editors">
              {sense.answers.map((answer, answerIndex) => (
                <div className="memory-answer-editor" key={answer.id ?? `new-${answerIndex}`}>
                  <div className="field">
                    <label htmlFor={`memory-answer-${senseIndex}-${answerIndex}`}>英語{answerIndex > 0 ? `（別表現 ${answerIndex}）` : ''}</label>
                    <div className="memory-input-action">
                      <input id={`memory-answer-${senseIndex}-${answerIndex}`} value={answer.displayForm} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, displayForm: event.target.value } : value) }))} placeholder="take A into account" />
                      {sense.answers.length > 1 && <button type="button" className="icon-btn" aria-label="この英語表現を削除" onClick={() => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.filter((_, index) => index !== answerIndex) }))}><Trash2 size={17} /></button>}
                    </div>
                  </div>
                  <Disclosure title="この表現の詳細" summary={answer.pattern || answer.nuance || undefined}>
                    <div className="field-row">
                      <div className="field"><label>見出し形</label><input value={answer.citationForm ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, citationForm: event.target.value } : value) }))} /></div>
                      <div className="field"><label>構文パターン</label><input value={answer.pattern ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, pattern: event.target.value } : value) }))} placeholder="take {object} into account" /></div>
                    </div>
                    <div className="field"><label>正解にする別表記</label><input value={answer.acceptedVariants ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, acceptedVariants: event.target.value } : value) }))} placeholder="カンマ区切り" /></div>
                    <div className="field"><label>英米綴りなど</label><input value={answer.orthographicVariants ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, orthographicVariants: event.target.value } : value) }))} /></div>
                    <div className="field-row">
                      <div className="field"><label>語調</label><select value={answer.register ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, register: (event.target.value || undefined) as typeof answer.register } : value) }))}><option value="">指定なし</option><option value="neutral">中立</option><option value="formal">フォーマル</option><option value="informal">口語</option><option value="literary">文語</option></select></div>
                      <div className="field"><label>ニュアンス</label><input value={answer.nuance ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, nuance: event.target.value } : value) }))} /></div>
                    </div>
                    <div className="field"><label>注意・よくある誤り</label><textarea value={answer.note ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, note: event.target.value } : value) }))} /></div>
                  </Disclosure>
                </div>
              ))}
              <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, answers: [...current.answers, { displayForm: '' }] }))}><Plus size={17} />別の表現を追加</button>
            </div>

            <Disclosure title="意味説明・例文・ニュアンス">
              <div className="field"><label>意味（分析用）</label><input value={sense.meaningJa ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, meaningJa: event.target.value }))} placeholder="未入力なら日本語と同じ" /></div>
              <div className="field"><label>意味説明</label><textarea value={sense.explanation ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, explanation: event.target.value }))} /></div>
              <div className="field"><label>意味タグ</label><input value={sense.tags ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, tags: event.target.value }))} /></div>
              {sense.examples.map((example, exampleIndex) => (
                <div className="memory-example-editor" key={example.id ?? `example-${exampleIndex}`}>
                  <div className="field"><label>例文</label><input value={example.english} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.map((value, index) => index === exampleIndex ? { ...value, english: event.target.value } : value) }))} /></div>
                  <div className="field"><label>和訳</label><input value={example.japanese ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.map((value, index) => index === exampleIndex ? { ...value, japanese: event.target.value } : value) }))} /></div>
                  <button type="button" className="icon-btn" aria-label="例文を削除" onClick={() => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.filter((_, index) => index !== exampleIndex) }))}><Trash2 size={17} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, examples: [...current.examples, { english: '' }] }))}><Plus size={17} />例文を追加</button>
            </Disclosure>

            <Disclosure title="問題形式・指定表現" summary={(sense.exercises?.length ?? 0) > 0 ? `${sense.exercises?.length ?? 0}問` : undefined}>
              {(sense.exercises ?? []).map((exercise, exerciseIndex) => (
                <div className="memory-exercise-editor" key={exercise.id ?? `exercise-${exerciseIndex}`}>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor={`memory-exercise-type-${senseIndex}-${exerciseIndex}`}>問題形式</label>
                      <select id={`memory-exercise-type-${senseIndex}-${exerciseIndex}`} value={exercise.type} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, type: event.target.value as MemoryExerciseDraft['type'] } : value) }))}>
                        {EXERCISE_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`memory-exercise-answer-${senseIndex}-${exerciseIndex}`}>指定表現</label>
                      <select id={`memory-exercise-answer-${senseIndex}-${exerciseIndex}`} value={exercise.answerIndex ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, answerIndex: event.target.value === '' ? undefined : Number(event.target.value) } : value) }))}>
                        <option value="">指定なし</option>
                        {sense.answers.map((answer, index) => answer.displayForm.trim() && <option value={index} key={answer.id ?? index}>{answer.displayForm}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field"><label htmlFor={`memory-exercise-prompt-${senseIndex}-${exerciseIndex}`}>問題文</label><textarea id={`memory-exercise-prompt-${senseIndex}-${exerciseIndex}`} value={exercise.prompt} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, prompt: event.target.value } : value) }))} placeholder="His activities were (       ) to the school." /></div>
                  <div className="field"><label>文脈・和文</label><textarea aria-label={`問題${exerciseIndex + 1}の文脈・和文`} value={exercise.context ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, context: event.target.value } : value) }))} /></div>
                  <fieldset className="memory-answer-choice-editor">
                    <legend>この文脈で正解にする表現</legend>
                    {sense.answers.map((answer, answerIndex) => answer.displayForm.trim() && (
                      <label key={answer.id ?? answerIndex}>
                        <input
                          type="checkbox"
                          checked={(exercise.acceptedAnswerIndexes ?? []).includes(answerIndex)}
                          onChange={(event) => updateSense(senseIndex, (current) => ({
                            ...current,
                            exercises: (current.exercises ?? []).map((value, index) => {
                              if (index !== exerciseIndex) return value;
                              const selected = new Set(value.acceptedAnswerIndexes ?? []);
                              if (event.target.checked) selected.add(answerIndex); else selected.delete(answerIndex);
                              return { ...value, acceptedAnswerIndexes: [...selected].sort((left, right) => left - right) };
                            }),
                          }))}
                        />
                        {answer.displayForm}
                      </label>
                    ))}
                  </fieldset>
                  <div className="field-row">
                    <div className="field"><label>必須語句</label><input aria-label={`問題${exerciseIndex + 1}の必須語句`} value={exercise.requiredTokens ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, requiredTokens: event.target.value } : value) }))} placeholder="カンマ区切り" /></div>
                    <div className="field"><label>禁止語句</label><input aria-label={`問題${exerciseIndex + 1}の禁止語句`} value={exercise.forbiddenTokens ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, forbiddenTokens: event.target.value } : value) }))} /></div>
                  </div>
                  <div className="field-row">
                    <div className="field"><label>解説</label><textarea aria-label={`問題${exerciseIndex + 1}の解説`} value={exercise.explanation ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, explanation: event.target.value } : value) }))} /></div>
                    <div className="field"><label>ヒント</label><textarea aria-label={`問題${exerciseIndex + 1}のヒント`} value={exercise.hint ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).map((value, index) => index === exerciseIndex ? { ...value, hint: event.target.value } : value) }))} /></div>
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => updateSense(senseIndex, (current) => ({ ...current, exercises: (current.exercises ?? []).filter((_, index) => index !== exerciseIndex) }))}><Trash2 size={17} />この問題を削除</button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, exercises: [...(current.exercises ?? []), blankExercise()] }))}><Plus size={17} />問題を追加</button>
            </Disclosure>
          </fieldset>
        ))}
        <button type="button" className="btn btn-ghost memory-add-sense" onClick={() => setDraft((current) => ({ ...current, senses: [...current.senses, blankSense()] }))}><Plus size={18} />別の意味を追加</button>
      </div>

      <div className="memory-sticky-actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}>キャンセル</button>
        {!itemId && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void save(true)}><Save size={18} />保存して次へ</button>}
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save(false)}><Save size={18} />保存</button>
      </div>
    </section>
  );
}
