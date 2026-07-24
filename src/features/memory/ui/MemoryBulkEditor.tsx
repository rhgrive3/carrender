import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardPaste, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { parseImportText, type ImportParseError, type ParsedImportRow } from '../domain/importExport';
import {
  findImportDuplicates,
  importParsedRows,
  type DuplicateResolution,
  type ImportDuplicateCandidate,
} from '../application/importContent';
import { useToast } from '../../../components/ui/Toast';
import { useMemory } from './MemoryContext';

interface GridRow {
  id: string;
  japanese: string;
  english: string;
  meaning: string;
  example: string;
  tags: string;
  setId: string;
}

type TextColumn = keyof Pick<GridRow, 'japanese' | 'english' | 'meaning' | 'example' | 'tags'>;

function emptyRow(setId = ''): GridRow {
  return { id: crypto.randomUUID(), japanese: '', english: '', meaning: '', example: '', tags: '', setId };
}

function fromParsed(row: ParsedImportRow, setId: string, sets: Array<{ id: string; name: string }>): GridRow {
  const namedSet = row.setName
    ? sets.find((value) => value.name.normalize('NFKC').trim() === row.setName?.normalize('NFKC').trim())
    : undefined;
  return {
    id: crypto.randomUUID(),
    japanese: row.japanese,
    english: row.english,
    meaning: row.meaning ?? '',
    example: row.example ?? '',
    tags: row.tags.join(', '),
    setId: namedSet?.id ?? setId,
  };
}

const COLUMNS: Array<keyof Pick<GridRow, 'japanese' | 'english' | 'meaning' | 'example' | 'tags' | 'setId'>> = [
  'japanese', 'english', 'meaning', 'example', 'tags', 'setId',
];

const TEXT_COLUMNS: TextColumn[] = ['japanese', 'english', 'meaning', 'example', 'tags'];

const COLUMN_LABEL: Record<(typeof COLUMNS)[number], string> = {
  japanese: '日本語',
  english: '英語',
  meaning: '意味・ニュアンス',
  example: '例文',
  tags: 'タグ',
  setId: 'セット',
};

const COLUMN_PLACEHOLDER: Record<TextColumn, string> = {
  japanese: '例：考慮する',
  english: '例：take A into account',
  meaning: '任意：使い分け・補足',
  example: '任意：例文',
  tags: '任意：熟語, LEAP',
};

const RESOLUTION_LABEL: Record<DuplicateResolution, string> = {
  merge: '既存の意味へ統合',
  new_sense: '別の意味として追加',
  separate: '別項目として保持',
  replace: '既存を置換',
  skip: 'スキップ',
};

function rowHasContent(row: GridRow): boolean {
  return Boolean(row.japanese.trim() || row.english.trim() || row.meaning.trim() || row.example.trim() || row.tags.trim());
}

function rowIsIncomplete(row: GridRow): boolean {
  return rowHasContent(row) && (!row.japanese.trim() || !row.english.trim());
}

export function MemoryBulkEditor({ setId }: { setId?: string }) {
  const { repository, sets, navigate, refresh, requestSync } = useMemory();
  const toast = useToast();
  const defaultSetId = setId ?? sets[0]?.id ?? '';
  const [rows, setRows] = useState<GridRow[]>(() => Array.from({ length: 8 }, () => emptyRow(defaultSetId)));
  const [saving, setSaving] = useState(false);
  const [pasteErrors, setPasteErrors] = useState<ImportParseError[]>([]);
  const [duplicatePreview, setDuplicatePreview] = useState<ImportDuplicateCandidate[]>();
  const [resolutions, setResolutions] = useState<Map<number, DuplicateResolution>>(new Map());
  const saveInFlight = useRef(false);
  const mountedRef = useRef(false);
  const activeRepositoryRef = useRef(repository);
  const activeSetIdRef = useRef(setId);
  const saveActionTokenRef = useRef(0);
  const validRows = useMemo(() => rows.filter((row) => row.japanese.trim() || row.english.trim()), [rows]);
  const incompleteCount = useMemo(() => rows.filter(rowIsIncomplete).length, [rows]);
  const hasAnyInput = useMemo(() => rows.some(rowHasContent), [rows]);

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
    activeSetIdRef.current = setId;
    saveActionTokenRef.current += 1;
    saveInFlight.current = false;
    setSaving(false);
    setRows(Array.from({ length: 8 }, () => emptyRow(defaultSetId)));
    setPasteErrors([]);
    setDuplicatePreview(undefined);
    setResolutions(new Map());
  }, [repository, setId]);

  useEffect(() => {
    if (!hasAnyInput || saving) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasAnyInput, saving]);

  const resetValidation = () => {
    setPasteErrors([]);
    setDuplicatePreview(undefined);
    setResolutions(new Map());
  };

  const update = (id: string, key: keyof GridRow, value: string) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row));
    resetValidation();
  };

  const appendRows = (count: number) => {
    setRows((current) => [...current, ...Array.from({ length: count }, () => emptyRow(defaultSetId))]);
    resetValidation();
  };

  const removeRow = (id: string) => {
    setRows((current) => {
      const next = current.filter((value) => value.id !== id);
      return next.length > 0 ? next : [emptyRow(defaultSetId)];
    });
    resetValidation();
  };

  const clearAllRows = () => {
    if (hasAnyInput && !window.confirm('入力中のカードをすべて消しますか？')) return;
    setRows(Array.from({ length: 8 }, () => emptyRow(defaultSetId)));
    resetValidation();
  };

  const leaveEditor = (destination: Parameters<typeof navigate>[0]) => {
    if (saving) return;
    if (hasAnyInput && !window.confirm('入力中のカードを破棄して移動しますか？')) return;
    navigate(destination);
  };

  const focusCell = (rowIndex: number, columnIndex: number) => {
    document.querySelector<HTMLElement>(`[data-memory-grid-row="${rowIndex}"][data-memory-grid-col="${columnIndex}"]`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>, rowIndex: number, columnIndex: number) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusCell(Math.max(0, Math.min(rows.length - 1, rowIndex + (event.key === 'ArrowDown' ? 1 : -1))), columnIndex);
    } else if (event.key === 'ArrowLeft' && event.currentTarget instanceof HTMLInputElement && event.currentTarget.selectionStart === 0) {
      focusCell(rowIndex, Math.max(0, columnIndex - 1));
    } else if (event.key === 'ArrowRight' && event.currentTarget instanceof HTMLInputElement && event.currentTarget.selectionStart === event.currentTarget.value.length) {
      focusCell(rowIndex, Math.min(COLUMNS.length - 1, columnIndex + 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (rowIndex === rows.length - 1) setRows((current) => [...current, emptyRow(defaultSetId)]);
      window.requestAnimationFrame(() => focusCell(rowIndex + 1, columnIndex));
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (saving) {
      event.preventDefault();
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\n') && !text.includes('\t')) return;
    const parsed = parseImportText(text);
    event.preventDefault();
    setPasteErrors(parsed.errors);
    if (parsed.rows.length === 0) {
      toast(parsed.errors[0]?.message ?? '貼り付け内容を解析できませんでした');
      return;
    }
    const pastedRows = parsed.rows.map((row) => {
      const firstLooksJapanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(row.english);
      const secondLooksEnglish = /[A-Za-z]/u.test(row.japanese)
        && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(row.japanese);
      return firstLooksJapanese && secondLooksEnglish
        ? { ...row, english: row.japanese, japanese: row.english }
        : row;
    });
    setRows(pastedRows.map((row) => fromParsed(row, defaultSetId, sets)));
    setDuplicatePreview(undefined);
    setResolutions(new Map());
    const unknownSets = [...new Set(pastedRows.flatMap((row) => row.setName
      && !sets.some((set) => set.name.normalize('NFKC').trim() === row.setName?.normalize('NFKC').trim())
      ? [row.setName] : []))];
    if (unknownSets.length > 0) toast(`未登録セット（${unknownSets.join('、')}）は既定セットへ割り当てました`);
    else if (parsed.errors.length > 0) toast(`${parsed.rows.length}件を展開しました。解析できない行があるため保存を停止しています`);
    else toast(`${parsed.rows.length}件を表へ展開しました`);
  };

  const save = async () => {
    if (!repository || saveInFlight.current) return;
    if (pasteErrors.length > 0) {
      toast('解析できない行があります。内容を修正して、全行をもう一度貼り付けてください');
      return;
    }
    if (validRows.length === 0) {
      toast('日本語と英語を入力してください');
      return;
    }
    const incomplete = validRows.find((row) => !row.japanese.trim() || !row.english.trim());
    if (incomplete) {
      toast('日本語または英語が空の行があります');
      return;
    }
    const actionRepository = repository;
    const actionSetId = setId;
    const actionRows = validRows;
    const actionSets = sets;
    const actionDuplicatePreview = duplicatePreview;
    const actionResolutions = resolutions;
    const actionToken = saveActionTokenRef.current + 1;
    saveActionTokenRef.current = actionToken;
    saveInFlight.current = true;
    setSaving(true);
    const isCurrentAction = () => (
      mountedRef.current
      && activeRepositoryRef.current === actionRepository
      && activeSetIdRef.current === actionSetId
      && saveActionTokenRef.current === actionToken
    );
    const parsedRows: ParsedImportRow[] = actionRows.map((row, index) => ({
      english: row.english.trim(),
      japanese: row.japanese.trim(),
      meaning: row.meaning.trim() || undefined,
      example: row.example.trim() || undefined,
      tags: row.tags.split(/[,、]/u).map((tag) => tag.trim()).filter(Boolean),
      setName: actionSets.find((set) => set.id === row.setId)?.name,
      sourceLine: index + 1,
    }));

    try {
      if (!actionDuplicatePreview) {
        const candidates = findImportDuplicates(parsedRows, await actionRepository.loadContent())
          .filter((candidate) => candidate.kinds.length > 0);
        if (!isCurrentAction()) return;
        if (candidates.length > 0) {
          setDuplicatePreview(candidates);
          setResolutions(new Map(candidates.map((candidate) => [candidate.rowIndex, candidate.suggestedResolution])));
          toast(`${candidates.length}件の重複候補があります。保存方法を確認してください`);
          return;
        }
      }

      const result = await importParsedRows({
        repository: actionRepository,
        rows: parsedRows,
        resolutions: actionResolutions,
        source: 'user',
        requireExplicitDuplicateResolution: true,
        reviewedDuplicates: actionDuplicatePreview ?? [],
      });
      if (!isCurrentAction()) return;
      let refreshWarning = false;
      try {
        await refresh();
      } catch (caught) {
        console.warn('暗記カード一括保存後に一覧を更新できませんでした', caught);
        refreshWarning = true;
      }
      if (!isCurrentAction()) return;
      void requestSync(true).catch(() => undefined);
      toast(refreshWarning
        ? `${result.imported}件は保存済みですが、一覧を更新できませんでした。アプリを再読み込みしてください`
        : `${result.imported}件を一括保存しました${result.skipped ? `（${result.skipped}件スキップ）` : ''}`);
      navigate(actionSetId ? { name: 'set', setId: actionSetId } : { name: 'home' });
    } catch (caught) {
      if (isCurrentAction()) {
        toast(caught instanceof Error ? caught.message : '一括保存に失敗しました');
      }
    } finally {
      if (saveActionTokenRef.current === actionToken) {
        saveInFlight.current = false;
        if (mountedRef.current && activeRepositoryRef.current === actionRepository && activeSetIdRef.current === actionSetId) setSaving(false);
      }
    }
  };

  return (
    <section className="memory-bulk-editor" aria-busy={saving}>
      <span data-app-screen-label="暗記カードをまとめて追加" hidden />
      <div className="memory-page-header memory-bulk-header">
        <button type="button" className="icon-btn" aria-label="1枚入力へ戻る" disabled={saving} onClick={() => leaveEditor({ name: 'editor', setId })}><ArrowLeft size={21} aria-hidden="true" /></button>
        <div className="memory-bulk-header-copy">
          <span className="memory-bulk-eyebrow">暗記カード</span>
          <h2>まとめて追加</h2>
          <p>手入力でも、Excel・スプレッドシートからの貼り付けでも登録できます</p>
        </div>
        <div className="memory-bulk-count" aria-live="polite" aria-atomic="true">
          <strong>{validRows.length}</strong>
          <span>入力済み</span>
        </div>
      </div>

      <div className="memory-bulk-workspace" onPaste={onPaste}>
        <div className="memory-bulk-guide">
          <div className="memory-bulk-guide-icon" aria-hidden="true"><ClipboardPaste size={22} /></div>
          <div>
            <b>表をコピーして、そのまま貼り付け</b>
            <p>日本語・英語の2列だけでもOK。複数行を貼ると自動でカード行へ展開します。</p>
          </div>
          <button type="button" className="btn btn-ghost memory-bulk-clear" disabled={saving || !hasAnyInput} onClick={clearAllRows}>
            <RotateCcw size={16} aria-hidden="true" />入力をクリア
          </button>
        </div>
        <div className="memory-grid-help">必須は「日本語」と「英語」だけです。パソコンではTab・Enter・矢印キーで移動できます。</div>

        {pasteErrors.length > 0 && (
          <div className="memory-import-errors" role="alert">
            <b>解析できない行があるため保存できません</b>
            <p>内容を修正し、欠けた行を含む全データをもう一度貼り付けてください。</p>
            <ul>{pasteErrors.slice(0, 8).map((error, index) => <li key={`${error.line}-${index}`}>{error.line}行目：{error.message}</li>)}</ul>
          </div>
        )}

        <div className="memory-grid-scroll">
          <table className="memory-edit-grid">
            <caption className="sr-only">暗記カードのまとめて追加。日本語と英語は必須です。</caption>
            <colgroup>
              <col className="memory-bulk-col-number" />
              <col className="memory-bulk-col-japanese" />
              <col className="memory-bulk-col-english" />
              <col className="memory-bulk-col-meaning" />
              <col className="memory-bulk-col-example" />
              <col className="memory-bulk-col-tags" />
              <col className="memory-bulk-col-set" />
              <col className="memory-bulk-col-actions" />
            </colgroup>
            <thead>
              <tr><th scope="col">#</th><th scope="col">日本語<span>必須</span></th><th scope="col">英語<span>必須</span></th><th scope="col">意味・ニュアンス</th><th scope="col">例文</th><th scope="col">タグ</th><th scope="col">セット</th><th scope="col"><span className="sr-only">操作</span></th></tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const incomplete = rowIsIncomplete(row);
                return (
                  <tr key={row.id} className={`memory-bulk-row${incomplete ? ' is-incomplete' : ''}`}>
                    <th scope="row" className="memory-bulk-row-number"><span>{rowIndex + 1}</span></th>
                    {TEXT_COLUMNS.map((column, columnIndex) => {
                      const required = column === 'japanese' || column === 'english';
                      const invalid = incomplete && !row[column].trim() && required;
                      return (
                        <td key={column} data-label={COLUMN_LABEL[column]} data-required={required ? 'true' : undefined}>
                          <input disabled={saving} data-memory-grid-row={rowIndex} data-memory-grid-col={columnIndex} aria-label={`${rowIndex + 1}行 ${COLUMN_LABEL[column]}`} aria-required={required} aria-invalid={invalid || undefined} value={row[column]} placeholder={COLUMN_PLACEHOLDER[column]} onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)} onChange={(event) => update(row.id, column, event.target.value)} />
                        </td>
                      );
                    })}
                    <td data-label="セット">
                      <select disabled={saving} data-memory-grid-row={rowIndex} data-memory-grid-col={5} aria-label={`${rowIndex + 1}行 セット`} value={row.setId} onKeyDown={(event) => onKeyDown(event, rowIndex, 5)} onChange={(event) => update(row.id, 'setId', event.target.value)}>
                        <option value="">セットなし</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
                      </select>
                    </td>
                    <td className="memory-bulk-delete-cell">
                      <button type="button" className="memory-bulk-delete" disabled={saving} aria-label={`${rowIndex + 1}行を削除`} onClick={() => removeRow(row.id)}><Trash2 size={17} aria-hidden="true" /><span>削除</span></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="memory-bulk-row-tools">
          <button type="button" className="btn btn-ghost memory-add-row" disabled={saving} onClick={() => appendRows(1)}><Plus size={18} aria-hidden="true" />1行追加</button>
          <button type="button" className="btn btn-ghost memory-add-five" disabled={saving} onClick={() => appendRows(5)}><Plus size={18} aria-hidden="true" />5行追加</button>
          <span>{rows.length}行用意済み</span>
        </div>
      </div>

      {duplicatePreview && (
        <div className="card memory-bulk-duplicate-preview" role="region" aria-label="重複候補の確認">
          <h3>重複候補を確認</h3>
          <p className="muted">自動統合はしません。各行の保存方法を選んでから確定してください。</p>
          <div className="memory-import-rows">
            {duplicatePreview.map((duplicate) => {
              const row = validRows[duplicate.rowIndex];
              if (!row) return null;
              return (
                <div className="memory-import-row" key={`${duplicate.rowIndex}-${duplicate.kinds.join('-')}`}>
                  <div><b>{row.japanese}</b><span>{row.english}</span><span className="status-badge status-warn">{duplicate.kinds.join('・')}</span></div>
                  <select
                    disabled={saving}
                    aria-label={`${row.japanese}の重複処理`}
                    value={resolutions.get(duplicate.rowIndex) ?? duplicate.suggestedResolution}
                    onChange={(event) => setResolutions((current) => new Map(current).set(duplicate.rowIndex, event.target.value as DuplicateResolution))}
                  >
                    {Object.entries(RESOLUTION_LABEL)
                      .filter(([value]) => (value !== 'replace' || duplicate.canReplace)
                        && (value !== 'merge' || duplicate.canMerge))
                      .map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="memory-sticky-actions memory-bulk-actions">
        <div className="memory-bulk-action-summary" id="memory-bulk-save-status">
          <b>{validRows.length}件を保存</b>
          <span>{pasteErrors.length > 0 ? '貼り付けエラーを修正してください' : incompleteCount > 0 ? `${incompleteCount}行の必須項目が未入力です` : validRows.length > 0 ? '日本語と英語を確認して保存' : 'カードを入力してください'}</span>
        </div>
        <div className="memory-bulk-action-buttons">
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => leaveEditor(setId ? { name: 'set', setId } : { name: 'home' })}>キャンセル</button>
          <button type="button" className="btn btn-primary" disabled={saving || validRows.length === 0 || pasteErrors.length > 0 || incompleteCount > 0} aria-describedby="memory-bulk-save-status" aria-busy={saving} onClick={() => void save()}><Save size={18} aria-hidden="true" />{saving ? '保存中…' : duplicatePreview ? '確認して保存' : `${validRows.length}件を保存`}</button>
        </div>
      </div>
    </section>
  );
}
