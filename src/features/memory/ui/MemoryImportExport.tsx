import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckSquare, Clipboard, Download, FileJson, ShieldAlert, Upload } from 'lucide-react';
import {
  CHATGPT_CONTENT_REQUEST,
  createAiContentExport,
  createFullMemoryBackup,
  createSelectedSetExport,
  parseImportText,
  parseSelectedSetExport,
  type ParsedImportRow,
  type SelectedSetExport,
} from '../domain/importExport';
import { findImportDuplicates, importParsedRows, type DuplicateResolution, type ImportDuplicateCandidate } from '../application/importContent';
import { applyAiImport, maximumContentRevision, newAiExportId, previewAiImport, type AiImportPreview } from '../application/aiImport';
import {
  importSelectedSetExport,
  previewSelectedSetImport,
  type SelectedSetImportPreview,
} from '../application/selectedSetImport';
import { useToast } from '../../../components/ui/Toast';
import { today } from '../../../lib/date';
import { MemoryBackupRestore } from './MemoryBackupRestore';
import { useMemory } from './MemoryContext';

type Tab = 'import' | 'export' | 'ai';
type ImportColumnOrder = 'auto' | 'english-first' | 'japanese-first';

function containsJapanese(value: string): boolean {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
}

function confirmImportColumnOrder(
  rows: readonly ParsedImportRow[],
  format: string,
  order: ImportColumnOrder,
): ParsedImportRow[] {
  const shouldSwap = order === 'japanese-first'
    || (order === 'auto'
      && (format === 'csv' || format === 'tsv')
      && rows.slice(0, 20).filter((row) => containsJapanese(row.english) && !containsJapanese(row.japanese)).length
        > rows.slice(0, 20).length / 2);
  return rows.map((row) => shouldSwap
    ? { ...row, english: row.japanese, japanese: row.english }
    : row);
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const RESOLUTION_LABEL: Record<DuplicateResolution, string> = {
  merge: '既存の意味へ統合',
  new_sense: '別の意味として追加',
  separate: '別項目として保持',
  replace: '既存を置換',
  skip: 'スキップ',
};

function DuplicateBadge({ duplicate }: { duplicate?: ImportDuplicateCandidate }) {
  if (!duplicate || duplicate.kinds.length === 0) return <span className="status-badge status-ok">新規</span>;
  return <span className="status-badge status-warn">重複候補：{duplicate.kinds.join('・')}</span>;
}

export function MemoryImportExport({ setId }: { setId?: string }) {
  const { repository, sets, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('import');
  const [targetSetId, setTargetSetId] = useState(setId ?? sets[0]?.id ?? '');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ line: number; message: string }>>([]);
  const [format, setFormat] = useState('empty');
  const [columnOrder, setColumnOrder] = useState<ImportColumnOrder>('auto');
  const [parsing, setParsing] = useState(false);
  const [duplicates, setDuplicates] = useState<ImportDuplicateCandidate[]>([]);
  const [resolutions, setResolutions] = useState<Map<number, DuplicateResolution>>(new Map());
  const [selectedSetDocument, setSelectedSetDocument] = useState<SelectedSetExport>();
  const [selectedSetPreview, setSelectedSetPreview] = useState<SelectedSetImportPreview>();
  const [includeSelectedSetStats, setIncludeSelectedSetStats] = useState(false);
  const [includeSelectedExportStats, setIncludeSelectedExportStats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiPreview, setAiPreview] = useState<AiImportPreview>();
  const [aiSelected, setAiSelected] = useState<Set<string>>(new Set());
  const mountedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const exportInFlightRef = useRef(false);
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
  const busy = saving || exporting;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveInFlightRef.current = false;
      exportInFlightRef.current = false;
    };
  }, []);

  const beginSave = (): boolean => {
    if (saveInFlightRef.current) return false;
    saveInFlightRef.current = true;
    setSaving(true);
    return true;
  };

  const finishSave = (): void => {
    saveInFlightRef.current = false;
    if (mountedRef.current) setSaving(false);
  };

  const beginExport = (): boolean => {
    if (exportInFlightRef.current) return false;
    exportInFlightRef.current = true;
    setExporting(true);
    return true;
  };

  const finishExport = (): void => {
    exportInFlightRef.current = false;
    if (mountedRef.current) setExporting(false);
  };

  const isCurrentRepository = (actionRepository: NonNullable<typeof repository>): boolean =>
    mountedRef.current && repositoryRef.current === actionRepository;

  const refreshAfterSave = async (): Promise<void> => {
    try {
      await refresh();
    } catch (caught) {
      console.error('暗記取込後の一覧更新に失敗しました', caught);
    }
  };

  const requestSyncSafely = (): void => {
    void requestSync(true).catch((caught) => {
      console.error('暗記取込後の同期要求に失敗しました', caught);
    });
  };

  const loadTextFile = async (file: File | undefined, target: 'import' | 'ai') => {
    if (!file || busy) return;
    if (file.size > 5_000_000) {
      toast('ファイルは5MB以内にしてください');
      return;
    }
    try {
      const value = await file.text();
      if (!mountedRef.current) return;
      if (target === 'ai') { setAiText(value); setAiPreview(undefined); }
      else setText(value);
    } catch {
      if (mountedRef.current) toast('ファイルを読み込めませんでした');
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!text.trim()) {
      setRows([]); setParseErrors([]); setFormat('empty'); setDuplicates([]);
      setSelectedSetDocument(undefined); setSelectedSetPreview(undefined); setIncludeSelectedSetStats(false);
      return;
    }
    setParsing(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const selected = parseSelectedSetExport(text, { maxJsonBytes: 5_000_000 });
        if (selected.recognized) {
          setRows([]);
          setDuplicates([]);
          setResolutions(new Map());
          setFormat('selected-sets');
          setParseErrors(selected.issues.map((issue) => ({ line: 1, message: `${issue.path}：${issue.message}` })));
          setIncludeSelectedSetStats(false);
          if (selected.valid && selected.document && repository) {
            const current = await repository.exportAll();
            if (cancelled) return;
            setSelectedSetDocument(selected.document);
            setSelectedSetPreview(previewSelectedSetImport(selected.document, current.snapshot));
          } else {
            setSelectedSetDocument(undefined);
            setSelectedSetPreview(undefined);
          }
          return;
        }

        setSelectedSetDocument(undefined);
        setSelectedSetPreview(undefined);
        setIncludeSelectedSetStats(false);
        const parsed = parseImportText(text);
        const confirmedRows = confirmImportColumnOrder(parsed.rows, parsed.format, columnOrder);
        setRows(confirmedRows);
        setParseErrors(parsed.errors);
        setFormat(parsed.format);
        if (repository && confirmedRows.length > 0) {
          const content = await repository.loadContent();
          if (cancelled) return;
          const next = findImportDuplicates(confirmedRows, content);
          setDuplicates(next);
          setResolutions(new Map(next.map((duplicate) => [duplicate.rowIndex, duplicate.suggestedResolution])));
        }
      })().catch((caught: unknown) => {
        if (cancelled) return;
        setRows([]);
        setDuplicates([]);
        setSelectedSetDocument(undefined);
        setSelectedSetPreview(undefined);
        setParseErrors([{ line: 1, message: caught instanceof Error ? caught.message : '取込内容を確認できませんでした' }]);
      }).finally(() => {
        if (!cancelled) setParsing(false);
      });
    }, text.length > 100_000 ? 50 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [columnOrder, repository, text]);

  const duplicateByRow = useMemo(() => new Map(duplicates.map((duplicate) => [duplicate.rowIndex, duplicate])), [duplicates]);

  const saveImport = async () => {
    if (!repository || rows.length === 0 || !beginSave()) return;
    const actionSetId = targetSetId;
    try {
      const result = await importParsedRows({
        repository,
        rows,
        resolutions,
        setId: actionSetId || undefined,
        requireExplicitDuplicateResolution: true,
        reviewedDuplicates: duplicates,
      });
      await refreshAfterSave();
      requestSyncSafely();
      if (!mountedRef.current) return;
      toast(`${result.imported}件を保存しました${result.skipped ? `（${result.skipped}件スキップ）` : ''}`);
      navigate(actionSetId ? { name: 'set', setId: actionSetId } : { name: 'home' });
    } catch (caught) {
      if (mountedRef.current) toast(caught instanceof Error ? caught.message : '取込に失敗しました');
    } finally {
      finishSave();
    }
  };

  const saveSelectedSetImport = async () => {
    if (!repository || !selectedSetDocument || !selectedSetPreview || saveInFlightRef.current) return;
    const blockingConflicts = selectedSetPreview.conflicts.filter((conflict) =>
      conflict.entityType !== 'stat' || includeSelectedSetStats
    );
    if (blockingConflicts.length > 0) {
      toast('IDが一致して内容の異なるデータがあります。元データを保護するため取り込めません');
      return;
    }
    if (!beginSave()) return;
    const actionDocument = selectedSetDocument;
    const actionIncludeStats = includeSelectedSetStats;
    try {
      const result = await importSelectedSetExport({
        repository,
        document: actionDocument,
        includeStats: actionIncludeStats,
      });
      await refreshAfterSave();
      requestSyncSafely();
      if (!mountedRef.current) return;
      toast(`${result.imported}件を取り込みました${result.skippedIdentical ? `（同一ID ${result.skippedIdentical}件は保持）` : ''}${result.importedStats ? `・統計 ${result.importedStats}件` : ''}`);
      navigate({ name: 'home' });
    } catch (caught) {
      if (mountedRef.current) toast(caught instanceof Error ? caught.message : '選択セットJSONを取り込めませんでした');
    } finally {
      finishSave();
    }
  };

  const exportAi = async () => {
    if (!repository || !beginExport()) return;
    const actionRepository = repository;
    try {
      const content = await actionRepository.loadContent();
      if (!isCurrentRepository(actionRepository)) return;
      const document = createAiContentExport(content, {
        exportId: newAiExportId(),
        baseRevision: maximumContentRevision(content),
        exportedAt: new Date().toISOString(),
      });
      downloadJson(`carrender-ai-content-${today()}.json`, document);
    } catch (caught) {
      if (isCurrentRepository(actionRepository)) toast(caught instanceof Error ? caught.message : 'AI用JSONを書き出せませんでした');
    } finally {
      finishExport();
    }
  };

  const copyChatGptRequest = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_CONTENT_REQUEST);
    } catch {
      const area = document.createElement('textarea');
      area.value = CHATGPT_CONTENT_REQUEST;
      area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) { toast('コピーできませんでした。依頼文を手動で選択してください'); return; }
    }
    toast('ChatGPT用依頼文をコピーしました');
  };

  const exportSelectedSet = async () => {
    if (!repository || !beginExport()) return;
    const actionRepository = repository;
    const selectedIds = targetSetId ? [targetSetId] : sets.map((set) => set.id);
    const actionIncludeStats = includeSelectedExportStats;
    try {
      const snapshot = await actionRepository.loadSnapshot();
      if (!isCurrentRepository(actionRepository)) return;
      const document = createSelectedSetExport({
        sets: snapshot.sets,
        setMembers: snapshot.setMembers,
        content: snapshot,
        selectedSetIds: selectedIds,
        exportId: crypto.randomUUID(),
        exportedAt: new Date().toISOString(),
        includeStats: actionIncludeStats,
        stats: snapshot.stats,
      });
      downloadJson(`carrender-memory-sets-${today()}.json`, document);
    } catch (caught) {
      if (isCurrentRepository(actionRepository)) toast(caught instanceof Error ? caught.message : 'セットを書き出せませんでした');
    } finally {
      finishExport();
    }
  };

  const exportBackup = async () => {
    if (!repository || !beginExport()) return;
    const actionRepository = repository;
    try {
      const all = await actionRepository.exportAll();
      if (!isCurrentRepository(actionRepository)) return;
      const document = createFullMemoryBackup({
        sets: all.snapshot.sets,
        setMembers: all.snapshot.setMembers,
        content: all.snapshot,
        stats: all.snapshot.stats,
        attempts: all.attempts,
        sessions: all.sessions,
        exportedAt: new Date().toISOString(),
        settings: {},
      });
      downloadJson(`carrender-memory-backup-${today()}.json`, document);
    } catch (caught) {
      if (isCurrentRepository(actionRepository)) toast(caught instanceof Error ? caught.message : 'バックアップを作成できませんでした');
    } finally {
      finishExport();
    }
  };

  const inspectAi = async () => {
    if (!repository || busy) return;
    const preview = previewAiImport(aiText, await repository.loadContent());
    if (!mountedRef.current) return;
    setAiPreview(preview);
    setAiSelected(new Set(preview.entries.filter((entry) => entry.kind === 'new').map((entry) => entry.key)));
  };

  const importAi = async () => {
    if (!repository || !aiPreview || !beginSave()) return;
    const actionPreview = aiPreview;
    const actionSelected = new Set(aiSelected);
    const actionSetId = targetSetId;
    try {
      const count = await applyAiImport({ repository, preview: actionPreview, selectedKeys: actionSelected, setId: actionSetId || undefined });
      await refreshAfterSave();
      requestSyncSafely();
      if (!mountedRef.current) return;
      toast(`${count}件のAI差分を未確認データとして追加しました`);
      navigate(actionSetId ? { name: 'set', setId: actionSetId } : { name: 'home' });
    } catch (caught) {
      if (mountedRef.current) toast(caught instanceof Error ? caught.message : 'AI差分を追加できませんでした');
    } finally {
      finishSave();
    }
  };

  return (
    <section className="memory-import" aria-busy={busy}>
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="戻る" disabled={busy} onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}><ArrowLeft size={21} aria-hidden="true" /></button>
        <div><h2>取込・出力</h2><p>保存前に解析結果と重複を確認します</p></div>
      </div>
      <div className="segmented memory-import-tabs" role="tablist" aria-label="取込と出力">
        {([['import', '取込'], ['export', '出力'], ['ai', 'AI差分']] as const).map(([value, label]) => (
          <button type="button" role="tab" aria-selected={tab === value} disabled={busy} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>

      {tab === 'import' && (
        <div className="memory-import-layout">
          <fieldset disabled={saving} className="memory-import-input-group">
            <div className="card memory-import-input">
              {format !== 'selected-sets' && <div className="field"><label htmlFor="memory-import-set">保存先セット</label><select id="memory-import-set" value={targetSetId} onChange={(event) => setTargetSetId(event.target.value)}><option value="">セットなし</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></div>}
              <div className="field">
                <label htmlFor="memory-import-text">CSV・TSV・セットJSON・コピーした表・「英語 = 日本語」</label>
                <input type="file" accept=".csv,.tsv,.json,.txt,text/csv,text/tab-separated-values,application/json,text/plain" aria-label="取込ファイルを選択" onChange={(event) => void loadTextFile(event.target.files?.[0], 'import')} />
                <textarea id="memory-import-text" className="memory-import-textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder={'take A into account\t〜を考慮に入れる\nallow for A = Aを考慮する'} />
              </div>
              <div className="memory-parse-status" aria-live="polite">{parsing ? '解析中…' : `形式：${format.toUpperCase()}・有効 ${rows.length}件・エラー ${parseErrors.length}件`}</div>
              {format !== 'selected-sets' && <div className="field">
                <label htmlFor="memory-import-column-order">列対応の確認</label>
                <select id="memory-import-column-order" value={columnOrder} onChange={(event) => setColumnOrder(event.target.value as ImportColumnOrder)}>
                  <option value="auto">自動判定</option>
                  <option value="english-first">1列目：英語／2列目：日本語</option>
                  <option value="japanese-first">1列目：日本語／2列目：英語</option>
                </select>
              </div>}
              {parseErrors.slice(0, 5).map((error) => <div className="memory-error" key={`${error.line}-${error.message}`}>{error.line}行：{error.message}</div>)}
            </div>
            <div className="card memory-import-preview">
              <h3>{format === 'selected-sets' ? 'セットJSONプレビュー' : '解析結果プレビュー'}</h3>
              {selectedSetPreview ? (
                <div className="memory-import-rows">
                  <div className="memory-ai-counts">
                    <span>セット <b>{selectedSetDocument?.sets.length ?? 0}</b></span>
                    <span>項目 <b>{selectedSetDocument?.items.length ?? 0}</b></span>
                    <span>意味 <b>{selectedSetDocument?.senses.length ?? 0}</b></span>
                    <span>追加対象 <b>{selectedSetPreview.additions}</b></span>
                    <span>同一ID <b>{selectedSetPreview.identical}</b></span>
                    <span>競合 <b>{selectedSetPreview.conflicts.filter((conflict) => conflict.entityType !== 'stat').length}</b></span>
                  </div>
                  {selectedSetPreview.conflicts.filter((conflict) => conflict.entityType !== 'stat').map((conflict) => (
                    <div className="memory-error" role="alert" key={`${conflict.entityType}:${conflict.entityId}`}>
                      {conflict.entityType}「{conflict.entityId}」は端末内の同じIDと内容またはrevisionが異なります。既存データを優先し、取込を停止します。
                    </div>
                  ))}
                  {selectedSetPreview.statsAvailable > 0 && (
                    <label className="memory-ai-manual-note">
                      <input type="checkbox" checked={includeSelectedSetStats} onChange={(event) => setIncludeSelectedSetStats(event.target.checked)} />
                      統計 {selectedSetPreview.statsAvailable}件も取り込む（回答履歴は含まれません。明示的に選んだ場合のみ、この端末へ保存します）
                    </label>
                  )}
                  {includeSelectedSetStats && selectedSetPreview.conflicts.filter((conflict) => conflict.entityType === 'stat').map((conflict) => (
                    <div className="memory-error" role="alert" key={`stat:${conflict.entityId}`}>
                      統計「{conflict.entityId}」は既存統計と異なるため取り込めません。
                    </div>
                  ))}
                  <p className="muted">IDは変更せず、同じ内容の既存IDはスキップします。内容が異なる同一IDは自動上書きしません。</p>
                </div>
              ) : rows.length === 0 ? <p className="muted">左へ貼り付けると、列・重複・保存方法を確認できます。</p> : (
                <div className="memory-import-rows">
                  {rows.slice(0, 200).map((row, index) => {
                    const duplicate = duplicateByRow.get(index);
                    return (
                      <div className="memory-import-row" key={`${row.sourceLine}-${index}`}>
                        <div><b>{row.japanese}</b><span>{row.english}</span><DuplicateBadge duplicate={duplicate} /></div>
                        <select aria-label={`${row.japanese}の重複処理`} value={resolutions.get(index) ?? duplicate?.suggestedResolution ?? 'separate'} onChange={(event) => setResolutions((current) => new Map(current).set(index, event.target.value as DuplicateResolution))}>
                          {Object.entries(RESOLUTION_LABEL)
                            .filter(([value]) => (value !== 'replace' || duplicate?.canReplace)
                              && (value !== 'merge' || duplicate?.canMerge))
                            .map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                      </div>
                    );
                  })}
                  {rows.length > 200 && <p className="muted">先頭200件を表示しています。{rows.length}件すべて保存されます。</p>}
                </div>
              )}
            </div>
          </fieldset>
          <div className="memory-sticky-actions">
            {selectedSetPreview ? (
              <button type="button" className="btn btn-primary" aria-busy={saving} disabled={saving || parsing || parseErrors.length > 0 || selectedSetPreview.conflicts.some((conflict) => conflict.entityType !== 'stat' || includeSelectedSetStats)} onClick={() => void saveSelectedSetImport()}><Upload size={18} aria-hidden="true" />{saving ? '取込中…' : 'セットJSONを取り込む'}</button>
            ) : (
              <button type="button" className="btn btn-primary" aria-busy={saving} disabled={saving || parsing || rows.length === 0 || parseErrors.length > 0} onClick={() => void saveImport()}><Upload size={18} aria-hidden="true" />{saving ? '保存中…' : `${rows.length}件を一括保存`}</button>
            )}
          </div>
        </div>
      )}

      {tab === 'export' && (
        <fieldset disabled={exporting} className="memory-export-grid">
          <article className="card"><FileJson size={24} aria-hidden="true" /><h3>ChatGPTへ手動で渡す</h3><p><b>AI API・APIキーは不要です。</b> 成績・履歴・ユーザー情報を除いたJSONファイルを取得し、ChatGPTアプリへ添付します。</p><ol className="memory-manual-ai-steps"><li>JSONを書き出す</li><li>依頼文をコピーしてChatGPTアプリへ貼る</li><li>返されたJSONを「AI差分」で確認して追加</li></ol><button type="button" className="btn btn-primary" aria-busy={exporting} onClick={() => void exportAi()}><Download size={18} aria-hidden="true" />{exporting ? '書き出し中…' : 'JSONファイルを取得'}</button><button type="button" className="btn btn-ghost" onClick={() => void copyChatGptRequest()}><Clipboard size={18} aria-hidden="true" />依頼文をコピー</button><details className="memory-chatgpt-request"><summary>依頼文を表示</summary><pre>{CHATGPT_CONTENT_REQUEST}</pre></details></article>
          <article className="card"><CheckSquare size={24} aria-hidden="true" /><h3>選択セット</h3><p>選択セットと参照コンテンツを出力します。統計は初期状態では含みません。</p><div className="field"><select aria-label="出力するセット" value={targetSetId} onChange={(event) => setTargetSetId(event.target.value)}><option value="">全セット</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></div><label className="memory-ai-manual-note"><input type="checkbox" checked={includeSelectedExportStats} onChange={(event) => setIncludeSelectedExportStats(event.target.checked)} />統計も含める（回答履歴は含みません）</label><button type="button" className="btn btn-primary" aria-busy={exporting} onClick={() => void exportSelectedSet()}><Download size={18} aria-hidden="true" />{exporting ? '書き出し中…' : 'セットを書き出す'}</button></article>
          <article className="card"><ShieldAlert size={24} aria-hidden="true" /><h3>完全バックアップ</h3><p>全コンテンツ・統計・回答履歴・セッションを復元専用形式で保存します。</p><button type="button" className="btn btn-primary" aria-busy={exporting} onClick={() => void exportBackup()}><Download size={18} aria-hidden="true" />{exporting ? '作成中…' : 'バックアップを作成'}</button></article>
          <MemoryBackupRestore />
        </fieldset>
      )}

      {tab === 'ai' && (
        <div className="memory-ai-import">
          <fieldset disabled={saving} className="memory-import-input-group">
            <div className="card">
              <p className="memory-ai-manual-note"><b>ChatGPTアプリから受け取ったファイルを手動で確認します。</b> CarrenderからAIへ通信することはありません。</p>
              <div className="field"><label htmlFor="memory-ai-json">ChatGPTが返したAI用JSON</label><textarea id="memory-ai-json" className="memory-import-textarea" value={aiText} onChange={(event) => { setAiText(event.target.value); setAiPreview(undefined); }} /></div>
              <input type="file" accept=".json,application/json" aria-label="ChatGPTが返したJSONファイルを選択" onChange={(event) => void loadTextFile(event.target.files?.[0], 'ai')} />
              <button type="button" className="btn btn-primary" disabled={!aiText.trim()} onClick={() => void inspectAi()}>差分を確認</button>
            </div>
            {aiPreview && (
              <div className="card memory-ai-preview">
                {aiPreview.revisionMismatch && <div className="memory-warning" role="alert">このJSONを出力した後に、元データが変更されています。変更項目は特に確認してください。</div>}
                <div className="memory-ai-counts">
                  <span>新規の意味 <b>{aiPreview.counts.newSenses}</b></span><span>新規の別表現 <b>{aiPreview.counts.newAnswers}</b></span><span>新規例文 <b>{aiPreview.counts.newExamples}</b></span><span>新規問題 <b>{aiPreview.counts.newExercises}</b></span><span>既存内容の変更 <b>{aiPreview.counts.changed}</b></span><span>削除 <b>{aiPreview.counts.deletions}</b></span><span>不正データ <b>{aiPreview.counts.invalid}</b></span>
                </div>
                {aiPreview.issues.map((issue, index) => <div className={issue.severity === 'error' ? 'memory-error' : 'memory-warning'} key={`${issue.path}-${index}`}>{issue.path}：{issue.message}</div>)}
                <div className="memory-ai-actions"><button type="button" className="btn btn-ghost" onClick={() => setAiSelected(new Set(aiPreview.entries.filter((entry) => entry.kind !== 'delete').map((entry) => entry.key)))}>すべて確認</button><button type="button" className="btn btn-ghost" onClick={() => setAiSelected(new Set(aiPreview.entries.filter((entry) => entry.kind === 'new').map((entry) => entry.key)))}>変更を拒否</button><button type="button" className="btn btn-ghost" onClick={() => setAiSelected(new Set(aiPreview.entries.filter((entry) => entry.kind === 'new').map((entry) => entry.key)))}>元データを優先</button></div>
                <div className="memory-ai-diffs">
                  {aiPreview.entries.map((entry) => (
                    <label key={entry.key}><input type="checkbox" disabled={entry.kind === 'delete'} checked={entry.kind !== 'delete' && aiSelected.has(entry.key)} onChange={(event) => setAiSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.key); else next.delete(entry.key); return next; })} /><span><b>{entry.kind === 'new' ? '新規' : entry.kind === 'delete' ? '削除要求（適用しません）' : '変更'}・{entry.entityType}</b><small>{entry.id}{entry.changedFields.length > 0 ? `・${entry.changedFields.join('、')}` : ''}</small>{entry.current && <code>元：{JSON.stringify(entry.current)}</code>}<code>{entry.kind === 'delete' ? '削除後：適用対象外' : `新：${JSON.stringify(entry.incoming)}`}</code></span></label>
                  ))}
                </div>
                <button type="button" className="btn btn-primary" aria-busy={saving} disabled={saving || aiSelected.size === 0 || aiPreview.counts.invalid > 0} onClick={() => void importAi()}>{saving ? '追加中…' : '選択項目だけ追加'}</button>
              </div>
            )}
          </fieldset>
        </div>
      )}
    </section>
  );
}
