import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { AuthProvider, useAuth } from './state/AuthContext';
import { TimerProvider } from './components/timer/TimerContext';
import { ToastProvider } from './components/ui/Toast';
import { TodayScreen } from './screens/TodayScreen';
import { PlanScreen } from './screens/PlanScreen';
import { MaterialsScreen } from './screens/MaterialsScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { SettingsSheet } from './screens/SettingsSheet';
import { LoginScreen } from './screens/LoginScreen';
import { TimerOverlay } from './components/timer/TimerOverlay';

import { Target } from 'lucide-react';
import { IconHome, IconPlan, IconBook, IconTimer, IconChart } from './components/navigation/NavIcons';
import { InstallGate } from './components/pwa/InstallGate';
import { InstallBanner } from './components/pwa/InstallBanner';
import { shouldShowInstallGate } from './lib/pwa';

type Tab = 'today' | 'plan' | 'materials' | 'records' | 'analytics';

const TABS: { id: Tab; label: string; Icon: (p: { active: boolean }) => JSX.Element }[] = [
  { id: 'today', label: '今日', Icon: IconHome },
  { id: 'plan', label: '計画', Icon: IconPlan },
  { id: 'materials', label: '教材', Icon: IconBook },
  { id: 'records', label: '記録', Icon: IconTimer },
  { id: 'analytics', label: '分析', Icon: IconChart },
];

function Shell() {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // テーマ適用
  useEffect(() => {
    const apply = () => {
      const pref = state.settings.theme;
      const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0b0f1a' : '#eef1f8');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [state.settings.theme]);

  if (!state.onboarded) {
    return (
      <div className="app-shell">
        <OnboardingScreen />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {tab === 'today' && <TodayScreen onOpenSettings={() => setSettingsOpen(true)} />}
      {tab === 'plan' && <PlanScreen />}
      {tab === 'materials' && <MaterialsScreen />}
      {tab === 'records' && <RecordsScreen />}
      {tab === 'analytics' && <AnalyticsScreen />}

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
            aria-label={item.label}
            aria-current={tab === item.id ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              <item.Icon active={tab === item.id} />
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TimerOverlay />
    </div>
  );
}

function AuthGate({ children }: { children: JSX.Element }) {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <div className="auth-shell" aria-hidden="true">
        <div className="auth-logo-block">
          <div className="auth-logo boot-pulse">
            <Target size={32} strokeWidth={2} color="#fff" />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <LoginScreen />;
  }

  return children;
}

export default function App() {
  // standalone起動かどうかはページ読み込み中に変わらないため初回判定のみでよい
  const [gated] = useState(() => shouldShowInstallGate());

  if (gated) {
    return <InstallGate />;
  }

  return (
    <AuthProvider>
      <InstallBanner />
      <AuthGate>
        <AppProvider>
          <TimerProvider>
            <ToastProvider>
              <Shell />
            </ToastProvider>
          </TimerProvider>
        </AppProvider>
      </AuthGate>
    </AuthProvider>
  );
}
