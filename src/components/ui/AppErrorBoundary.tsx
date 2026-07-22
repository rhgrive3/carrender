import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { today } from '../../lib/date';
import { exportJSON, loadState } from '../../lib/storage';

interface Props { children: ReactNode }
interface State {
  error: Error | null;
  backupStatus: 'idle' | 'started' | 'failed';
  backupMessage: string;
}

const DOWNLOAD_CLEANUP_DELAY_MS = 1_000;

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, backupStatus: 'idle', backupMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, backupStatus: 'idle', backupMessage: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('アプリの描画に失敗しました', error, info);
  }

  private downloadLocalBackup = () => {
    let url: string | null = null;
    let link: HTMLAnchorElement | null = null;
    try {
      const state = loadState();
      if (!state) throw new Error('端末内データが見つかりません');
      const blob = new Blob([exportJSON(state)], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob);
      link = document.createElement('a');
      link.href = url;
      link.download = `studycommander-recovery-${today()}.json`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      this.setState({ backupStatus: 'started', backupMessage: '復旧用JSONの保存を開始しました。保存先を確認してから再読み込みしてください。' });
      const cleanupUrl = url;
      const cleanupLink = link;
      url = null;
      link = null;
      // iOS Safari/PWAではclick直後にURLを解放すると、ダウンロード開始前に参照が失われる場合がある。
      window.setTimeout(() => {
        cleanupLink.remove();
        URL.revokeObjectURL(cleanupUrl);
      }, DOWNLOAD_CLEANUP_DELAY_MS);
    } catch (caught) {
      link?.remove();
      if (url) URL.revokeObjectURL(url);
      this.setState({
        backupStatus: 'failed',
        backupMessage: caught instanceof Error ? `復旧用JSONを保存できませんでした: ${caught.message}` : '復旧用JSONを保存できませんでした',
      });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    let hasBackup = false;
    let backupAvailabilityError = '';
    try {
      hasBackup = loadState() !== null;
    } catch (caught) {
      backupAvailabilityError = caught instanceof Error ? caught.message : '端末内データを確認できませんでした';
    }
    return (
      <main className="screen" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 48 }}>
        <section className="card" role="alert">
          <h1 className="sheet-title">アプリを安全に開けませんでした</h1>
          <p className="muted mt-8">端末内データは削除していません。再読み込みしても直らない場合は、先に復旧用JSONを保存してください。</p>
          <div className="row mt-12" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>再読み込み</button>
            {hasBackup && <button type="button" className="btn btn-secondary" onClick={this.downloadLocalBackup}>端末データを保存</button>}
          </div>
          {backupAvailabilityError && <p className="muted mt-8" role="status">端末内データを確認できませんでした: {backupAvailabilityError}</p>}
          {this.state.backupMessage && (
            <p className="muted mt-8" role={this.state.backupStatus === 'failed' ? 'alert' : 'status'} aria-live="polite">
              {this.state.backupMessage}
            </p>
          )}
          <details className="mt-12">
            <summary>エラー詳細</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{this.state.error.message}</pre>
          </details>
        </section>
      </main>
    );
  }
}
