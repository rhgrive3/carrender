import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Save, Table2, Trash2 } from 'lucide-react';
import type { MemoryContentBundle } from '../domain/types';
import { saveMemoryItemDraft, type MemoryItemDraft, type MemorySenseDraft } from '../application/editContent';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';
import { MemoryBulkEditor } from './MemoryBulkEditor';

function blankSense(): MemorySenseDraft {
  return { promptJa: '', meaningJa: '', answers: [{ displayForm: '' }], examples: [], exercises: [] };
}

function draftFromContent(content: MemoryContentBundle, itemId: string): MemoryItemDraft | null {
  const item = content.items.find((value) => value.id === itemId);
  if (!item) return null;
  const senses = content.senses.filter((sense) => sense.itemId === item.id).map((sense): MemorySenseDraft => ({
    id: sense.id,
    siblingGroupId: sense.siblingGroupId,
    promptJa: sense.promptJa,
    meaningJa: sense.meaningJa,
    explanation: sense.explanation,
    tags: sense.tags.join(', '),
    answers: content.answers.filter((answer) => answer.senseId === sense.id).map((answer) => ({
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
    exercises: [],
  }));
  return { id: item.id, kind: item.kind, label: item.label, lemma: item.lemma, tags: item.tags.join(', '), senses: senses.length ? senses : [blankSense()] };
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
      toast(itemId ? 'カードを更新しました' : 'カードを保存しました');
      if (continueNext && !itemId) {
        setDraft({ kind: 'expression', senses: [blankSense()] });
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
    <section className="memory-editor memory-simple-editor">
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="戻る" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}><ArrowLeft size={21} /></button>
        <div><h2>{itemId ? 'カードを編集' : 'カードを追加'}</h2><p>日本語と英語だけで登録できます</p></div>
        {!itemId && <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'editor', setId, bulk: true })}><Table2 size={18} />まとめて追加</button>}
      </div>

      <div className="memory-simple-editor-note">別解がある場合だけ「別の英語を追加」を使ってください。問題形式や細かい採点設定は廃止しました。</div>

      <div className="memory-editor-card card">
        {draft.senses.map((sense, senseIndex) => (
          <fieldset className="memory-sense-editor memory-simple-card-editor" key={sense.id ?? `new-${senseIndex}`}>
            <legend>{draft.senses.length > 1 ? `カード ${senseIndex + 1}` : 'カード'}</legend>
            {draft.senses.length > 1 && <button type="button" className="memory-fieldset-remove" aria-label={`カード${senseIndex + 1}を削除`} onClick={() => setDraft((current) => ({ ...current, senses: current.senses.filter((_, index) => index !== senseIndex) }))}><Trash2 size={17} />削除</button>}

            <div className="field">
              <label htmlFor={`memory-prompt-${senseIndex}`}>日本語</label>
              <input id={`memory-prompt-${senseIndex}`} value={sense.promptJa} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, promptJa: event.target.value, meaningJa: event.target.value }))} placeholder="例：〜を考慮に入れる" />
            </div>

            <div className="memory-answer-editors">
              {sense.answers.map((answer, answerIndex) => (
                <div className="memory-simple-answer-row" key={answer.id ?? `new-${answerIndex}`}>
                  <div className="field">
                    <label htmlFor={`memory-answer-${senseIndex}-${answerIndex}`}>{answerIndex === 0 ? '英語' : `別の英語 ${answerIndex}`}</label>
                    <input id={`memory-answer-${senseIndex}-${answerIndex}`} value={answer.displayForm} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, displayForm: event.target.value } : value) }))} placeholder="take A into account" />
                  </div>
                  {sense.answers.length > 1 && <button type="button" className="icon-btn" aria-label="この英語を削除" onClick={() => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.filter((_, index) => index !== answerIndex) }))}><Trash2 size={17} /></button>}
                </div>
              ))}
              <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, answers: [...current.answers, { displayForm: '' }] }))}><Plus size={17} />別の英語を追加</button>
            </div>

            <div className="memory-simple-examples">
              {sense.examples.map((example, exampleIndex) => (
                <div className="memory-simple-example-row" key={example.id ?? `example-${exampleIndex}`}>
                  <div className="field"><label>例文（任意）</label><input value={example.english} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.map((value, index) => index === exampleIndex ? { ...value, english: event.target.value } : value) }))} /></div>
                  <div className="field"><label>和訳（任意）</label><input value={example.japanese ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.map((value, index) => index === exampleIndex ? { ...value, japanese: event.target.value } : value) }))} /></div>
                  <button type="button" className="icon-btn" aria-label="例文を削除" onClick={() => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.filter((_, index) => index !== exampleIndex) }))}><Trash2 size={17} /></button>
                </div>
              ))}
              {sense.examples.length === 0 && <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, examples: [{ english: '' }] }))}><Plus size={17} />例文を追加</button>}
            </div>
          </fieldset>
        ))}
        <button type="button" className="btn btn-ghost memory-add-sense" onClick={() => setDraft((current) => ({ ...current, senses: [...current.senses, blankSense()] }))}><Plus size={18} />別のカードを追加</button>
      </div>

      <div className="memory-sticky-actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}>キャンセル</button>
        {!itemId && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void save(true)}><Save size={18} />保存して次へ</button>}
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save(false)}><Save size={18} />保存</button>
      </div>
    </section>
  );
}
