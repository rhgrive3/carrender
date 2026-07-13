import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { exportJSON, loadState } from '../../lib/storage';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('アプリの描画に失敗しました', error, info);
  }

  private downloadLocalBackup = () => {
    const state = loadState();
    if (!state) return;
    const blob = new Blob([exportJSON(state)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `studycommander-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  render() {
    if (!this.state.error) return this.props.children;
    const hasBackup = loadState() !== null;
    return (
      <main className="screen" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 48 }}>
        <section className="card" role="alert">
          <h1 className="sheet-title">アプリを安全に開けませんでした</h1>
          <p className="muted mt-8">端末内データは削除していません。再読み込みしても直らない場合は、先に復旧用JSONを保存してください。</p>
          <div className="row mt-12" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>再読み込み</button>
            {hasBackup && <button type="button" className="btn btn-secondary" onClick={this.downloadLocalBackup}>端末データを保存</button>}
          </div>
          <details className="mt-12">
            <summary>エラー詳細</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{this.state.error.message}</pre>
          </details>
        </section>
      </main>
    );
  }
}
