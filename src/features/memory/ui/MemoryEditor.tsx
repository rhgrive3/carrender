import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Save, Table2, Trash2 } from 'lucide-react';
import type { MemoryContentBundle } from '../domain/types';
import { saveMemoryItemDraft, type MemoryItemDraft, type MemorySenseDraft } from '../application/editContent';
import { saveNewMemoryItemCards } from '../application/saveMemoryItemCards';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';
import { MemoryBulkEditor } from './MemoryBulkEditor';

function blankSense(): MemorySenseDraft {
  return { promptJa: '', meaningJa: '', answers: [{ displayForm: '' }], examples: [], exercises: [] };
}

function blankDraft(): MemoryItemDraft {
  return { kind: 'expression', senses: [blankSense()] };
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
  const [draft, setDraft] = useState<MemoryItemDraft>(blankDraft);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const saveInFlight = useRef(false);
  const mountedRef = useRef(false);
  const activeRepositoryRef = useRef(repository);
  const activeItemIdRef = useRef(itemId);
  const saveActionTokenRef = useRef(0);
  const savedDraftSnapshotRef = useRef(JSON.stringify(blankDraft()));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveActionTokenRef.current += 1;
      saveInFlight.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    activeRepositoryRef.current = repository;
    activeItemIdRef.current = itemId;
    saveActionTokenRef.current += 1;
    saveInFlight.current = false;
    setSaving(false);
  }, [repository, itemId, setId]);

  useEffect(() => {
    let cancelled = false;
    const nextBlank = blankDraft();
    savedDraftSnapshotRef.current = JSON.stringify(nextBlank);
    setOriginal(undefined);
    setDraft(nextBlank);
    setLoadError(undefined);
    if (!repository || !itemId) return () => { cancelled = true; };
    void repository.loadContent().then((content) => {
      if (cancelled) return;
      const loaded = draftFromContent(content, itemId);
      if (!loaded) throw new Error('編集するカードが見つかりません');
      savedDraftSnapshotRef.current = JSON.stringify(loaded);
      setOriginal(content);
      setDraft(loaded);
    }).catch((caught) => {
      if (!cancelled) setLoadError(caught instanceof Error ? caught.message : 'カードを読み込めませんでした');
    });
    return () => { cancelled = true; };
  }, [repository, itemId]);

  const hasUnsavedChanges = JSON.stringify(draft) !== savedDraftSnapshotRef.current;

  useEffect(() => {
    if (bulk || !hasUnsavedChanges || saving) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [bulk, hasUnsavedChanges, saving]);

  if (bulk) return <MemoryBulkEditor setId={setId} />;

  const isLoading = Boolean(itemId && repository && !original && !loadError);

  const updateSense = (index: number, update: (sense: MemorySenseDraft) => MemorySenseDraft) => {
    setDraft((current) => ({ ...current, senses: current.senses.map((sense, at) => at === index ? update(sense) : sense) }));
  };

  const leaveEditor = (destination: Parameters<typeof navigate>[0]) => {
    if (saving) return;
    if (hasUnsavedChanges && !window.confirm('未保存の入力を破棄して移動しますか？')) return;
    navigate(destination);
  };

  const save = async (continueNext: boolean) => {
    if (!repository || saveInFlight.current || loadError || (itemId && !original)) return;
    const actionRepository = repository;
    const actionItemId = itemId;
    const actionSetId = setId;
    const actionDraft = draft;
    const actionOriginal = original;
    const actionToken = saveActionTokenRef.current + 1;
    saveActionTokenRef.current = actionToken;
    saveInFlight.current = true;
    setSaving(true);
    const isCurrentAction = () => (
      mountedRef.current
      && activeRepositoryRef.current === actionRepository
      && activeItemIdRef.current === actionItemId
      && saveActionTokenRef.current === actionToken
    );
    try {
      const members = actionSetId ? await actionRepository.listSetMembers(actionSetId) : [];
      let savedCount = 1;
      if (actionItemId) {
        await saveMemoryItemDraft({
          repository: actionRepository,
          draft: actionDraft,
          original: actionOriginal,
          setId: actionSetId,
          setOrder: members.length,
        });
      } else {
        const savedItemIds = await saveNewMemoryItemCards({
          repository: actionRepository,
          draft: actionDraft,
          setId: actionSetId,
          setOrder: members.length,
        });
        savedCount = savedItemIds.length;
      }
      if (!isCurrentAction()) return;
      try {
        await refresh();
      } catch (caught) {
        console.warn('暗記カード保存後に一覧を更新できませんでした', caught);
      }
      if (!isCurrentAction()) return;
      void requestSync(true).catch(() => undefined);
      toast(actionItemId ? 'カードを更新しました' : savedCount > 1 ? `${savedCount}枚のカードを保存しました` : 'カードを保存しました');
      if (continueNext && !actionItemId) {
        const nextBlank = blankDraft();
        savedDraftSnapshotRef.current = JSON.stringify(nextBlank);
        setDraft(nextBlank);
        setOriginal(undefined);
        document.getElementById('memory-answer-0-0')?.focus();
      } else {
        savedDraftSnapshotRef.current = JSON.stringify(actionDraft);
        navigate(actionSetId ? { name: 'set', setId: actionSetId } : { name: 'home' });
      }
    } catch (caught) {
      if (isCurrentAction()) {
        toast(caught instanceof Error ? caught.message : '保存できませんでした');
      }
    } finally {
      if (saveActionTokenRef.current === actionToken) {
        saveInFlight.current = false;
        if (mountedRef.current && activeRepositoryRef.current === actionRepository && activeItemIdRef.current === actionItemId) setSaving(false);
      }
    }
  };

  if (isLoading) {
    return (
      <section className="memory-editor memory-simple-editor" aria-busy="true">
        <div className="memory-page-header">
          <button type="button" className="icon-btn" aria-label="戻る" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}><ArrowLeft size={21} aria-hidden="true" /></button>
          <div><h2>カードを編集</h2><p>カードを読み込んでいます…</p></div>
        </div>
        <div className="card" role="status">読み込み中…</div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="memory-editor memory-simple-editor">
        <div className="memory-page-header">
          <button type="button" className="icon-btn" aria-label="戻る" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}><ArrowLeft size={21} aria-hidden="true" /></button>
          <div><h2>カードを編集</h2><p>カードを開けませんでした</p></div>
        </div>
        <div className="card" role="alert"><p>{loadError}</p><button type="button" className="btn btn-primary" onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}>戻る</button></div>
      </section>
    );
  }

  const unitLabel = itemId ? '意味' : 'カード';

  return (
    <section className="memory-editor memory-simple-editor" aria-busy={saving}>
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="戻る" disabled={saving} onClick={() => leaveEditor(setId ? { name: 'set', setId } : { name: 'home' })}><ArrowLeft size={21} aria-hidden="true" /></button>
        <div><h2>{itemId ? 'カードを編集' : 'カードを追加'}</h2><p>英語と日本語だけで登録できます</p></div>
        {!itemId && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => leaveEditor({ name: 'editor', setId, bulk: true })}><Table2 size={18} aria-hidden="true" />まとめて追加</button>}
      </div>

      <fieldset className="memory-editor-card card" disabled={saving}>
        {draft.senses.map((sense, senseIndex) => (
          <fieldset className="memory-sense-editor memory-simple-card-editor" key={sense.id ?? `new-${senseIndex}`}>
            <legend>{draft.senses.length > 1 ? `${unitLabel} ${senseIndex + 1}` : unitLabel}</legend>
            {draft.senses.length > 1 && <button type="button" className="memory-fieldset-remove" aria-label={`${unitLabel}${senseIndex + 1}を削除`} onClick={() => setDraft((current) => ({ ...current, senses: current.senses.filter((_, index) => index !== senseIndex) }))}><Trash2 size={17} aria-hidden="true" />削除</button>}
            <div className="memory-answer-editors">
              {sense.answers.map((answer, answerIndex) => (
                <div className="memory-simple-answer-row" key={answer.id ?? `new-${answerIndex}`}>
                  <div className="field"><label htmlFor={`memory-answer-${senseIndex}-${answerIndex}`}>{answerIndex === 0 ? '英語' : `別の英語 ${answerIndex}`}</label><input id={`memory-answer-${senseIndex}-${answerIndex}`} value={answer.displayForm} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.map((value, index) => index === answerIndex ? { ...value, displayForm: event.target.value } : value) }))} placeholder="take A into account" /></div>
                  {sense.answers.length > 1 && <button type="button" className="icon-btn" aria-label="この英語を削除" onClick={() => updateSense(senseIndex, (current) => ({ ...current, answers: current.answers.filter((_, index) => index !== answerIndex) }))}><Trash2 size={17} aria-hidden="true" /></button>}
                </div>
              ))}
              <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, answers: [...current.answers, { displayForm: '' }] }))}><Plus size={17} aria-hidden="true" />別の英語を追加</button>
            </div>
            <div className="field"><label htmlFor={`memory-prompt-${senseIndex}`}>日本語</label><input id={`memory-prompt-${senseIndex}`} value={sense.promptJa} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, promptJa: event.target.value, meaningJa: event.target.value }))} placeholder="例：〜を考慮に入れる" /></div>
            <div className="memory-simple-examples">
              {sense.examples.map((example, exampleIndex) => {
                const englishId = `memory-example-en-${senseIndex}-${exampleIndex}`;
                const japaneseId = `memory-example-ja-${senseIndex}-${exampleIndex}`;
                return <div className="memory-simple-example-row" key={example.id ?? `example-${exampleIndex}`}><div className="field"><label htmlFor={englishId}>例文（任意）</label><input id={englishId} value={example.english} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.map((value, index) => index === exampleIndex ? { ...value, english: event.target.value } : value) }))} /></div><div className="field"><label htmlFor={japaneseId}>和訳（任意）</label><input id={japaneseId} value={example.japanese ?? ''} onChange={(event) => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.map((value, index) => index === exampleIndex ? { ...value, japanese: event.target.value } : value) }))} /></div><button type="button" className="icon-btn" aria-label="例文を削除" onClick={() => updateSense(senseIndex, (current) => ({ ...current, examples: current.examples.filter((_, index) => index !== exampleIndex) }))}><Trash2 size={17} aria-hidden="true" /></button></div>;
              })}
              {sense.examples.length === 0 && <button type="button" className="btn btn-ghost memory-add-row" onClick={() => updateSense(senseIndex, (current) => ({ ...current, examples: [{ english: '' }] }))}><Plus size={17} aria-hidden="true" />例文を追加</button>}
            </div>
          </fieldset>
        ))}
        <button type="button" className="btn btn-ghost memory-add-sense" onClick={() => setDraft((current) => ({ ...current, senses: [...current.senses, blankSense()] }))}><Plus size={18} aria-hidden="true" />{itemId ? '別の意味を追加' : '別のカードを追加'}</button>
      </fieldset>

      <div className="memory-sticky-actions">
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => leaveEditor(setId ? { name: 'set', setId } : { name: 'home' })}>キャンセル</button>
        {!itemId && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void save(true)}><Save size={18} aria-hidden="true" />{saving ? '保存中…' : '保存して次へ'}</button>}
        <button type="button" className="btn btn-primary" disabled={saving} aria-busy={saving} onClick={() => void save(false)}><Save size={18} aria-hidden="true" />{saving ? '保存中…' : '保存'}</button>
      </div>
    </section>
  );
}
