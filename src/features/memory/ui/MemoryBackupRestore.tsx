import { useState } from 'react';
import { AlertTriangle, RotateCcw, Upload } from 'lucide-react';
import {
  parseFullMemoryBackup,
  type FullMemoryBackupParseResult,
} from '../domain/importExport';
import { useToast } from '../../../components/ui/Toast';
import { APP_TIME_ZONE } from '../../../lib/date';
import { useMemory } from './MemoryContext';

const MAX_BACKUP_BYTES = 25_000_000;

export function MemoryBackupRestore() {
  const { repository, refresh, navigate, requestSync } = useMemory();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<FullMemoryBackupParseResult>();
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const inspect = async (file: File | undefined) => {
    setFileName(file?.name ?? '');
    setResult(undefined);
    setConfirming(false);
    setUnderstood(false);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setResult({
        valid: false,
        issues: [{
          path: '$',
          code: 'document_too_large',
          message: 'バックアップは25MB以内にしてください',
        }],
      });
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      setResult(parseFullMemoryBackup(text, { maxJsonBytes: MAX_BACKUP_BYTES }));
    } catch {
      setResult({
        valid: false,
        issues: [{ path: '$', code: 'invalid_json', message: 'ファイルを読み込めませんでした' }],
      });
    } finally {
      setReading(false);
    }
  };

  const restore = async () => {
    if (!repository || !result?.valid || !result.backup || !understood || restoring) return;
    setRestoring(true);
    try {
      const backup = result.backup;
      await repository.replaceFromBackup({
        snapshot: {
          sets: backup.sets,
          setMembers: backup.setMembers,
          items: backup.items,
          senses: backup.senses,
          answers: backup.answers,
          examples: backup.examples,
          exercises: backup.exercises,
          stats: backup.stats,
        },
        attempts: backup.attempts,
        sessions: backup.sessions,
      });
      await refresh();
      void requestSync(true);
      toast('完全バックアップを復元しました');
      navigate({ name: 'home' });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'バックアップを復元できませんでした');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <article className="card memory-backup-restore">
      <RotateCcw size={24} />
      <h3>完全バックアップを復元</h3>
      <p>復元専用JSONを検証してから、端末内の暗記データ一式を置き換えます。</p>
      <label className="btn btn-ghost memory-file-button">
        <Upload size={18} />バックアップを選択
        <input
          type="file"
          accept=".json,application/json"
          aria-label="復元する完全バックアップを選択"
          disabled={restoring}
          onChange={(event) => void inspect(event.target.files?.[0])}
        />
      </label>
      {fileName && <small className="memory-backup-file">{fileName}</small>}
      <div aria-live="polite">
        {reading && <p className="muted">安全性と参照関係を検証中…</p>}
        {result && !result.valid && (
          <div className="memory-backup-errors" role="alert">
            <b>このファイルは復元できません（{result.issues.length}件）</b>
            {result.issues.slice(0, 8).map((issue, index) => (
              <span key={`${issue.path}-${issue.code}-${index}`}>{issue.path}：{issue.message}</span>
            ))}
            {result.issues.length > 8 && <span>ほか {result.issues.length - 8}件</span>}
          </div>
        )}
        {result?.valid && result.backup && result.counts && (
          <div className="memory-backup-preview">
            <b>検証済み：{new Date(result.backup.exportedAt).toLocaleString('ja-JP', { timeZone: APP_TIME_ZONE })}</b>
            <div className="memory-backup-counts">
              <span>セット <b>{result.counts.sets}</b></span>
              <span>項目 <b>{result.counts.items}</b></span>
              <span>意味 <b>{result.counts.senses}</b></span>
              <span>表現 <b>{result.counts.answers}</b></span>
              <span>問題 <b>{result.counts.exercises}</b></span>
              <span>成績 <b>{result.counts.stats}</b></span>
              <span>回答 <b>{result.counts.attempts}</b></span>
              <span>セッション <b>{result.counts.sessions}</b></span>
            </div>
            {!confirming ? (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
                復元確認へ進む
              </button>
            ) : (
              <div className="memory-backup-final" role="alert">
                <div><AlertTriangle size={19} /><b>現在の端末内の暗記データは、この内容に置き換わります。</b></div>
                <label>
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(event) => setUnderstood(event.target.checked)}
                  />
                  内容と置き換えを確認しました
                </label>
                <div className="memory-backup-actions">
                  <button type="button" className="btn btn-ghost" disabled={restoring} onClick={() => { setConfirming(false); setUnderstood(false); }}>戻る</button>
                  <button type="button" className="btn btn-danger" disabled={!understood || restoring} onClick={() => void restore()}>
                    {restoring ? '復元中…' : 'このバックアップで復元'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
