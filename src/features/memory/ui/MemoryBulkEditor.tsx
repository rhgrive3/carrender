import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
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

const RESOLUTION_LABEL: Record<DuplicateResolution, string> = {
  merge: '既存の意味へ統合',
  new_sense: '別の意味として追加',
  separate: '別項目として保持',
  replace: '既存を置換',
  skip: 'スキップ',
};

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
  const activeSetIdRef = useRef(setId);
  activeSetIdRef.current = setId;
  const validRows = useMemo(() => rows.filter((row) => row.japanese.trim() || row.english.trim()), [rows]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveInFlight.current = false;
    };
  }, []);

  const update = (id: string, key: keyof GridRow, value: string) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row));
    setDuplicatePreview(undefined);
    setResolutions(new Map());
  };

  const focusCell = (rowIndex: number, columnIndex: number) => {
    document.querySelector<HTMLElement>(`[data-memory-grid-row="${rowIndex}"][data-memory-grid-col="${columnIndex}"]`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>, rowIndex: number, columnIndex: number) => {
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
    const parsedRows: ParsedImportRow[] = validRows.map((row, index) => ({
      english: row.english.trim(),
      japanese: row.japanese.trim(),
      meaning: row.meaning.trim() || undefined,
      example: row.example.trim() || undefined,
      tags: row.tags.split(/[,、]/u).map((tag) => tag.trim()).filter(Boolean),
      setName: sets.find((set) => set.id === row.setId)?.name,
      sourceLine: index + 1,
    }));
    const actionSetId = setId;
    saveInFlight.current = true;
    setSaving(true);

    try {
      if (!duplicatePreview) {
        const candidates = findImportDuplicates(parsedRows, await repository.loadContent())
          .filter((candidate) => candidate.kinds.length > 0);
        if (candidates.length > 0) {
          if (mountedRef.current && activeSetIdRef.current === actionSetId) {
            setDuplicatePreview(candidates);
            setResolutions(new Map(candidates.map((candidate) => [candidate.rowIndex, candidate.suggestedResolution])));
            toast(`${candidates.length}件の重複候補があります。保存方法を確認してください`);
          }
          return;
        }
      }

      const result = await importParsedRows({
        repository,
        rows: parsedRows,
        resolutions,
        source: 'user',
        requireExplicitDuplicateResolution: true,
        reviewedDuplicates: duplicatePreview ?? [],
      });
      try {
        await refresh();
      } catch (caught) {
        console.warn('暗記カード一括保存後に一覧を更新できませんでした', caught);
      }
      void requestSync(true).catch(() => undefined);
      if (!mountedRef.current || activeSetIdRef.current !== actionSetId) return;
      toast(`${result.imported}件を一括保存しました${result.skipped ? `（${result.skipped}件スキップ）` : ''}`);
      navigate(setId ? { name: 'set', setId } : { name: 'home' });
    } catch (caught) {
      if (mountedRef.current && activeSetIdRef.current === actionSetId) {
        toast(caught instanceof Error ? caught.message : '一括保存に失敗しました');
      }
    } finally {
      saveInFlight.current = false;
      if (mountedRef.current && activeSetIdRef.current === actionSetId) setSaving(false);
    }
  };

  return (
    <section className="memory-bulk-editor" aria-busy={saving}>
      <div className="memory-page-header">
        <button type="button" className="icon-btn" aria-label="1枚入力へ戻る" disabled={saving} onClick={() => navigate({ name: 'editor', setId })}><ArrowLeft size={21} aria-hidden="true" /></button>
        <div><h2>表形式で一括登録</h2><p>CSV・TSV・コピーした表をそのまま貼り付けできます</p></div>
        <span className="status-badge">{validRows.length}件</span>
      </div>
      <div className="memory-grid-help">列：日本語／英語／意味・ニュアンス／例文／タグ／セット。Tab・Enter・矢印キーで移動できます。</div>
      {pasteErrors.length > 0 && (
        <div className="memory-import-errors" role="alert">
          <b>解析できない行があるため保存できません</b>
          <p>内容を修正し、欠けた行を含む全データをもう一度貼り付けてください。</p>
          <ul>{pasteErrors.slice(0, 8).map((error, index) => <li key={`${error.line}-${index}`}>{error.line}行目：{error.message}</li>)}</ul>
        </div>
      )}
      <div className="memory-grid-scroll" onPaste={onPaste}>
        <table className="memory-edit-grid">
          <thead><tr><th>日本語</th><th>英語</th><th>意味・ニュアンス</th><th>例文</th><th>タグ</th><th>セット</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {COLUMNS.slice(0, 5).map((column, columnIndex) => (
                  <td key={column}><input disabled={saving} data-memory-grid-row={rowIndex} data-memory-grid-col={columnIndex} aria-label={`${rowIndex + 1}行 ${column}`} value={row[column]} onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)} onChange={(event) => update(row.id, column, event.target.value)} /></td>
                ))}
                <td>
                  <select disabled={saving} data-memory-grid-row={rowIndex} data-memory-grid-col={5} aria-label={`${rowIndex + 1}行 セット`} value={row.setId} onKeyDown={(event) => onKeyDown(event, rowIndex, 5)} onChange={(event) => update(row.id, 'setId', event.target.value)}>
                    <option value="">セットなし</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
                  </select>
                </td>
                <td><button type="button" className="icon-btn" disabled={saving} aria-label={`${rowIndex + 1}行を削除`} onClick={() => { setRows((current) => current.filter((value) => value.id !== row.id)); setDuplicatePreview(undefined); setResolutions(new Map()); }}><Trash2 size={17} aria-hidden="true" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <button type="button" className="btn btn-ghost memory-add-row" disabled={saving} onClick={() => { setRows((current) => [...current, emptyRow(defaultSetId)]); setDuplicatePreview(undefined); setResolutions(new Map()); }}><Plus size={18} aria-hidden="true" />行を追加</button>
      <div className="memory-sticky-actions">
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => navigate(setId ? { name: 'set', setId } : { name: 'home' })}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={saving || validRows.length === 0 || pasteErrors.length > 0} aria-busy={saving} onClick={() => void save()}><Save size={18} aria-hidden="true" />{saving ? '保存中…' : duplicatePreview ? '確認して保存' : `${validRows.length}件を保存`}</button>
      </div>
    </section>
  );
}
