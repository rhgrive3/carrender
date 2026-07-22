import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw, Upload } from 'lucide-react';
import {
  parseFullMemoryBackup,
  type FullMemoryBackupParseResult,
} from '../domain/importExport';
import {
  apiExistingMemoryAttemptIds,
  MEMORY_ATTEMPT_RECEIPT_BATCH_SIZE,
} from '../infrastructure/api';
import { useToast } from '../../../components/ui/Toast';
import { APP_TIME_ZONE } from '../../../lib/date';
import { useMemory } from './MemoryContext';

const MAX_BACKUP_BYTES = 25_000_000;

interface RestoreProgress {
  checked: number;
  total: number;
}

export function MemoryBackupRestore() {
  const { repository, refresh, navigate, requestSync } = useMemory();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<FullMemoryBackupParseResult>();
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress>();
  const mountedRef = useRef(false);
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
  const inspectTokenRef = useRef(0);
  const restoreTokenRef = useRef(0);
  const restoreInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inspectTokenRef.current += 1;
      restoreTokenRef.current += 1;
      restoreInFlightRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    inspectTokenRef.current += 1;
    restoreTokenRef.current += 1;
    restoreInFlightRef.current = false;
    setFileName('');
    setResult(undefined);
    setReading(false);
    setConfirming(false);
    setUnderstood(false);
    setRestoring(false);
    setRestoreProgress(undefined);
  }, [repository]);

  const inspect = async (file: File | undefined) => {
    const token = ++inspectTokenRef.current;
    setFileName(file?.name ?? '');
    setResult(undefined);
    setConfirming(false);
    setUnderstood(false);
    setReading(Boolean(file));
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      if (inspectTokenRef.current !== token) return;
      setResult({
        valid: false,
        issues: [{
          path: '$',
          code: 'document_too_large',
          message: 'バックアップは25MB以内にしてください',
        }],
      });
      setReading(false);
      return;
    }
    try {
      const text = await file.text();
      if (!mountedRef.current || inspectTokenRef.current !== token) return;
      setResult(parseFullMemoryBackup(text, { maxJsonBytes: MAX_BACKUP_BYTES }));
    } catch {
      if (!mountedRef.current || inspectTokenRef.current !== token) return;
      setResult({
        valid: false,
        issues: [{ path: '$', code: 'invalid_json', message: 'ファイルを読み込めませんでした' }],
      });
    } finally {
      if (mountedRef.current && inspectTokenRef.current === token) setReading(false);
    }
  };

  const restore = async () => {
    if (!repository || !result?.valid || !result.backup || !understood || restoreInFlightRef.current) return;
    const actionRepository = repository;
    const actionBackup = result.backup;
    const token = ++restoreTokenRef.current;
    restoreInFlightRef.current = true;
    setRestoring(true);
    setRestoreProgress(undefined);
    const isCurrentAction = () => mountedRef.current
      && repositoryRef.current === actionRepository
      && restoreTokenRef.current === token;
    try {
      // Only attempts carrying an export-time receipt can possibly be skipped.
      // Missing receipts and lookup failures stay unsynced, which is the safe
      // fallback for another account or an empty/recreated server database.
      const receiptCandidates = [...new Set(
        actionBackup.attempts.filter((attempt) => Boolean(attempt.syncedAt)).map((attempt) => attempt.attemptId),
      )];
      const confirmedAttemptIds = new Set<string>();
      let receiptServerTime: string | undefined;
      if (receiptCandidates.length > 0) setRestoreProgress({ checked: 0, total: receiptCandidates.length });
      for (let offset = 0; offset < receiptCandidates.length; offset += MEMORY_ATTEMPT_RECEIPT_BATCH_SIZE) {
        const batch = receiptCandidates.slice(offset, offset + MEMORY_ATTEMPT_RECEIPT_BATCH_SIZE);
        try {
          const receipt = await apiExistingMemoryAttemptIds(batch);
          if (!isCurrentAction()) return;
          receipt.existingAttemptIds.forEach((attemptId) => confirmedAttemptIds.add(attemptId));
          receiptServerTime = receipt.serverTime;
        } catch (caught) {
          // Do not block restoration when the server cannot be checked. Every
          // unconfirmed attempt is intentionally re-sent through normal sync.
          console.warn('暗記バックアップの回答receipt確認に失敗したため安全側で再送します', caught);
          break;
        }
        if (isCurrentAction()) {
          setRestoreProgress({
            checked: Math.min(offset + batch.length, receiptCandidates.length),
            total: receiptCandidates.length,
          });
        }
      }

      await actionRepository.replaceFromBackup({
        snapshot: {
          sets: actionBackup.sets,
          setMembers: actionBackup.setMembers,
          items: actionBackup.items,
          senses: actionBackup.senses,
          answers: actionBackup.answers,
          examples: actionBackup.examples,
          exercises: actionBackup.exercises,
          stats: actionBackup.stats,
        },
        attempts: actionBackup.attempts,
        sessions: actionBackup.sessions,
      });
      if (!isCurrentAction()) return;

      if (confirmedAttemptIds.size > 0 && receiptServerTime) {
        const acceptedAttemptIds = [...confirmedAttemptIds];
        await actionRepository.commitSyncResponse({
          serverTime: receiptServerTime,
          cursor: '0',
          acceptedMutationIds: [],
          acceptedAttemptIds,
          sentAttemptIds: acceptedAttemptIds,
          conflicts: [],
          changes: {},
        });
      }
      if (!isCurrentAction()) return;
      try {
        await refresh();
      } catch (caught) {
        console.error('暗記バックアップ復元後の一覧更新に失敗しました', caught);
      }
      if (!isCurrentAction()) return;
      void requestSync(true).catch((caught) => {
        console.error('暗記バックアップ復元後の同期要求に失敗しました', caught);
      });
      const skipped = confirmedAttemptIds.size;
      toast(skipped > 0
        ? `完全バックアップを復元しました（既存の回答${skipped}件は再送を省略）`
        : '完全バックアップを復元しました');
      navigate({ name: 'home' });
    } catch (caught) {
      if (isCurrentAction()) toast(caught instanceof Error ? caught.message : 'バックアップを復元できませんでした');
    } finally {
      if (restoreTokenRef.current === token) {
        restoreInFlightRef.current = false;
        if (mountedRef.current) {
          setRestoring(false);
          setRestoreProgress(undefined);
        }
      }
    }
  };

  return (
    <article className="card memory-backup-restore" aria-busy={reading || restoring}>
      <RotateCcw size={24} />
      <h3>完全バックアップを復元</h3>
      <p>復元専用JSONを検証してから、端末内の暗記データ一式を置き換えます。</p>
      <label className="btn btn-ghost memory-file-button">
        <Upload size={18} />バックアップを選択
        <input
          type="file"
          accept=".json,application/json"
          aria-label="復元する完全バックアップを選択"
          disabled={reading || restoring}
          onChange={(event) => void inspect(event.target.files?.[0])}
        />
      </label>
      {fileName && <small className="memory-backup-file">{fileName}</small>}
      <div aria-live="polite">
        {reading && <p className="muted">安全性と参照関係を検証中…</p>}
        {restoring && restoreProgress && restoreProgress.total > 0 && (
          <p className="muted">回答履歴の同期状況を確認中… {restoreProgress.checked}/{restoreProgress.total}</p>
        )}
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
              <button type="button" className="btn btn-ghost" disabled={reading || restoring} onClick={() => setConfirming(true)}>
                復元確認へ進む
              </button>
            ) : (
              <div className="memory-backup-final" role="alert">
                <div><AlertTriangle size={19} /><b>現在の端末内の暗記データは、この内容に置き換わります。</b></div>
                <label>
                  <input
                    type="checkbox"
                    checked={understood}
                    disabled={restoring}
                    onChange={(event) => setUnderstood(event.target.checked)}
                  />
                  内容と置き換えを確認しました
                </label>
                <div className="memory-backup-actions">
                  <button type="button" className="btn btn-ghost" disabled={restoring} onClick={() => { setConfirming(false); setUnderstood(false); }}>戻る</button>
                  <button type="button" className="btn btn-danger" aria-busy={restoring} disabled={!understood || restoring} onClick={() => void restore()}>
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
