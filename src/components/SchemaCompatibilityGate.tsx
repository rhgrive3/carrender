import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DatabaseZap, RefreshCw, Target } from 'lucide-react';
import {
  checkSchemaCompatibility,
  type SchemaCompatibilityResponse,
} from '../lib/schemaCompatibility';

type GateState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'incompatible'; response: SchemaCompatibilityResponse };

export function SchemaCompatibilityGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'checking' });

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    const result = await checkSchemaCompatibility();
    // Offline/PWA cached use must remain available. Only a positive server-side
    // incompatibility response blocks startup.
    if (result.status === 'incompatible') {
      setState({ status: 'incompatible', response: result.response });
      return;
    }
    setState({ status: 'ready' });
  }, []);

  useEffect(() => { void check(); }, [check]);

  if (state.status === 'ready') return children;

  if (state.status === 'checking') {
    return (
      <div className="auth-shell" aria-live="polite">
        <div className="auth-logo-block">
          <div className="auth-logo boot-pulse">
            <Target size={32} strokeWidth={2} color="#fff" />
          </div>
          <p className="muted" style={{ marginTop: 16 }}>データベース互換性を確認中…</p>
        </div>
      </div>
    );
  }

  const { response } = state;
  const current = response.currentVersion === null ? '未設定' : `v${response.currentVersion}`;
  const required = response.requiredVersion === null ? '不明' : `v${response.requiredVersion}`;
  const missing = response.missingMigrations.length > 0
    ? response.missingMigrations.map((version) => String(version).padStart(4, '0')).join(', ')
    : 'schema version migration';

  return (
    <div className="auth-shell">
      <div className="card" style={{ width: 'min(92vw, 520px)', textAlign: 'left' }}>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <DatabaseZap size={28} strokeWidth={2.2} aria-hidden="true" />
          <div>
            <h1 style={{ fontSize: 20, margin: 0 }}>D1 migrationが不足しています</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>アプリ本体は起動を停止しました。データは変更していません。</p>
          </div>
        </div>
        <div className="card mt-12" style={{ background: 'var(--bg-elev2)' }}>
          <div>現在: <b>{current}</b> / 必要: <b>{required}</b></div>
          <div className="mt-8">不足: <code>{missing}</code></div>
          <div className="mt-8">実行: <code>npm run d1:migrate</code></div>
        </div>
        <button type="button" className="btn btn-primary btn-block mt-12" onClick={() => void check()}>
          <RefreshCw size={16} strokeWidth={2.3} aria-hidden="true" /> 再確認
        </button>
      </div>
    </div>
  );
}
