import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { AuthProvider, useAuth } from './state/AuthContext';
import { MainStateBootstrap, MainStatePersistence } from './state/MainStatePersistence';
import { TimerProvider } from './components/timer/TimerContext';
import { ToastProvider } from './components/ui/Toast';
import { TodayScreen } from './screens/TodayScreen';
import { PlanScreen } from './screens/PlanScreen';
import { MaterialsScreen } from './screens/MaterialsScreen';
import type { MaterialsPane } from './screens/MaterialsScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { SettingsSheet } from './screens/SettingsSheet';
import { LoginScreen } from './screens/LoginScreen';
import { TimerOverlay } from './components/timer/TimerOverlay';
import { MainStateMergeBridge } from './components/MainStateMergeBridge';
import { MainStateWriterLeaseBridge } from './components/MainStateWriterLeaseBridge';
import { MaterialProgressIntegrityBridge } from './components/MaterialProgressIntegrityBridge';
import { SchemaCompatibilityGate } from './components/SchemaCompatibilityGate';
import { SyncStatusBanner } from './components/SyncStatusBanner';

import { Target } from 'lucide-react';
import { IconHome, IconPlan, IconBook, IconTimer, IconChart } from './components/navigation/NavIcons';
import { InstallGate } from './components/pwa/InstallGate';
import { InstallBanner } from './components/pwa/InstallBanner';
import { shouldShowInstallGate } from './lib/pwa';
import { MemoryProvider, useMemory } from './features/memory/ui/MemoryContext';
import { resolveAppOwnerIdentity } from './state/ownerIdentity';
import {
  readShellRoute,
  readStoredShellTab,
  shellRouteHref,
  storeShellTab,
  type ShellTab,
} from './lib/shellNavigation';

type Tab = ShellTab;

const TABS: { id: Tab; label: string; Icon: (p: { active: boolean }) => JSX.Element }[] = [
  { id: 'today', label: '今日', Icon: IconHome },
  { id: 'plan', label: '計画', Icon: IconPlan },
  { id: 'materials', label: '教材', Icon: IconBook },
  { id: 'records', label: '記録', Icon: IconTimer },
  { id: 'analytics', label: '分析', Icon: IconChart },
];

function Shell() {
  const { state } = useApp();
  const {
    immersive,
    navigate: navigateMemory,
    repository: memoryRepository,
    sets: memorySets,
    activeSession: activeMemorySession,
    pendingCount: memoryPendingCount,
  } = useMemory();
  const [initialRoute] = useState(() => {
    if (typeof window === 'undefined') return readShellRoute('', 'today');
    const storedTab = readStoredShellTab(window.sessionStorage);
    return readShellRoute(window.location.hash, storedTab);
  });
  const [tab, setTab] = useState<Tab>(initialRoute.tab);
  const [materialsPane, setMaterialsPane] = useState<MaterialsPane>(initialRoute.materialsPane);
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set([initialRoute.tab]));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollPositions = useRef<Partial<Record<Tab, number>>>({});
  const activeTabRef = useRef<Tab>(initialRoute.tab);
  const [memoryTodaySummary, setMemoryTodaySummary] = useState<{
    weakCount: number;
    recent?: { answerCount: number; needsReviewCount: number };
  }>({ weakCount: 0 });

  useEffect(() => {
    storeShellTab(typeof window === 'undefined' ? null : window.sessionStorage, tab);
    activeTabRef.current = tab;
  }, [tab]);

  const navigateShell = useCallback((nextTab: Tab, nextMaterialsPane: MaterialsPane = materialsPane) => {
    if (nextTab === tab && (nextTab !== 'materials' || nextMaterialsPane === materialsPane)) {
      // CSSのscroll-behaviorだけではJS APIのsmooth指定を無効化できない。
      // 動きを減らす設定では即時移動し、再選択によるスクロールアニメーションを発生させない。
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      window.scrollTo({ top: 0, behavior });
      scrollPositions.current[nextTab] = 0;
      return;
    }

    scrollPositions.current[tab] = window.scrollY;
    const pane = nextTab === 'materials' ? nextMaterialsPane : materialsPane;
    setTab(nextTab);
    setMaterialsPane(pane);
    setVisitedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
    window.history.pushState(
      { ...(window.history.state ?? {}), shellTab: nextTab, materialsPane: pane, overlay: null },
      '',
      shellRouteHref(nextTab, pane),
    );
    requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[nextTab] ?? 0 }));
  }, [materialsPane, tab]);

  const openSettings = useCallback(() => {
    if (!settingsOpen) {
      window.history.pushState(
        { ...(window.history.state ?? {}), shellTab: tab, materialsPane, overlay: 'settings' },
        '',
        window.location.href,
      );
    }
    setSettingsOpen(true);
  }, [materialsPane, settingsOpen, tab]);

  const closeSettings = useCallback(() => {
    if (window.history.state?.overlay === 'settings') {
      window.history.back();
      return;
    }
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    const currentRoute = readShellRoute(window.location.hash, tab);
    if (!window.location.hash || currentRoute.tab !== tab || currentRoute.materialsPane !== materialsPane) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), shellTab: tab, materialsPane, overlay: null },
        '',
        shellRouteHref(tab, materialsPane),
      );
    } else {
      window.history.replaceState(
        { ...(window.history.state ?? {}), shellTab: tab, materialsPane, overlay: null },
        '',
        window.location.href,
      );
    }

    const onPopState = (event: PopStateEvent) => {
      scrollPositions.current[activeTabRef.current] = window.scrollY;
      const route = readShellRoute(window.location.hash, 'today');
      setTab(route.tab);
      setMaterialsPane(route.materialsPane);
      setSettingsOpen(event.state?.overlay === 'settings');
      setVisitedTabs((current) => {
        if (current.has(route.tab)) return current;
        const next = new Set(current);
        next.add(route.tab);
        return next;
      });
      requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[route.tab] ?? 0 }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // Initial history setup and popstate subscription intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auth may replace a legacy username owner with the stable user ID after an
  // offline launch reconnects. AppProvider/Shell remounts at that boundary,
  // while the MemoryProvider deliberately keeps the active study view. Keep
  // the shell on the memory pane too, otherwise Today is rendered underneath
  // an invisible immersive session and the bottom navigation stays hidden.
  useEffect(() => {
    if (!immersive) return;
    setMaterialsPane('memory');
    setTab('materials');
    setVisitedTabs((current) => new Set(current).add('materials'));
    window.history.replaceState(
      { ...(window.history.state ?? {}), shellTab: 'materials', materialsPane: 'memory', overlay: null },
      '',
      shellRouteHref('materials', 'memory'),
    );
  }, [immersive]);

  useEffect(() => {
    if (tab !== 'today' || !memoryRepository) return;
    let cancelled = false;
    void Promise.all([memoryRepository.getStats(), memoryRepository.listSessions(20)]).then(([stats, sessions]) => {
      if (cancelled) return;
      const weakTargetIds = new Set(stats
        .filter((stat) => stat.manualWeak || stat.weaknessScore >= 60)
        .map((stat) => `${stat.targetType}:${stat.targetId}`));
      const latest = sessions.find((session) => session.status === 'completed');
      setMemoryTodaySummary({
        weakCount: weakTargetIds.size,
        recent: latest ? { answerCount: latest.answerCount, needsReviewCount: latest.needsReviewTargetIds.length } : undefined,
      });
    }).catch(() => {
      // Today remains usable when the optional memory overview cannot be read.
    });
    return () => { cancelled = true; };
  }, [activeMemorySession?.updatedAt, memoryPendingCount, memoryRepository, tab]);

  // テーマ適用
  useEffect(() => {
    const apply = () => {
      const pref = state.settings.theme;
      const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0c111d' : '#f5f6f9');
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
    <>
      <div className="app-shell">
        {!immersive && <SyncStatusBanner onOpenSettings={openSettings} />}
        <div className="shell-tab-panel" hidden={tab !== 'today'} aria-hidden={tab !== 'today'}>
        {visitedTabs.has('today') && <TodayScreen
          onOpenSettings={openSettings}
          memorySetCount={memorySets.length}
          hasActiveMemorySession={Boolean(activeMemorySession)}
          memoryWeakCount={memoryTodaySummary.weakCount}
          recentMemorySession={memoryTodaySummary.recent}
          onOpenMemory={() => {
            navigateMemory(activeMemorySession
              ? { name: 'study', sessionId: activeMemorySession.id }
              : { name: 'home' });
            navigateShell('materials', 'memory');
          }} />}
        </div>
        <div className="shell-tab-panel" hidden={tab !== 'plan'} aria-hidden={tab !== 'plan'}>
          {visitedTabs.has('plan') && <PlanScreen />}
        </div>
        <div className="shell-tab-panel" hidden={tab !== 'materials'} aria-hidden={tab !== 'materials'}>
          {visitedTabs.has('materials') && <MaterialsScreen pane={materialsPane} onPaneChange={(pane) => navigateShell('materials', pane)} />}
        </div>
        <div className="shell-tab-panel" hidden={tab !== 'records'} aria-hidden={tab !== 'records'}>
          {visitedTabs.has('records') && <RecordsScreen />}
        </div>
        <div className="shell-tab-panel" hidden={tab !== 'analytics'} aria-hidden={tab !== 'analytics'}>
          {visitedTabs.has('analytics') && <AnalyticsScreen onNavigate={navigateShell} />}
        </div>

        <SettingsSheet open={settingsOpen} onClose={closeSettings} />
        <TimerOverlay />
      </div>

      {/*
       * UX契約: ナビはスクロール対象の app-shell の外に置く。
       * iPadOS のスクロールコンテナや親の transform/overflow/contain が
       * position: fixed の基準を変えないよう、ここをビューポート直下に保つ。
       */}
      {!immersive && (
        <nav
          className="bottom-nav"
          data-layout-contract="fixed-bottom-navigation"
          aria-label="メインナビゲーション"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => navigateShell(item.id)}
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
      )}
    </>
  );
}

function AuthGate({ children }: { children: JSX.Element }) {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <div className="auth-shell" role="status" aria-live="polite" aria-busy="true">
        <div className="auth-logo-block">
          <div className="auth-logo boot-pulse" aria-hidden="true">
            <Target size={32} strokeWidth={2} color="#fff" />
          </div>
          <p className="auth-subtitle">アカウント情報を確認しています…</p>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <LoginScreen />;
  }

  return children;
}

/** owner が変わる時は AppProvider 以下を丸ごと作り直す。前ユーザーの reducer state を
 * 新しい owner 名で保存・同期する経路を持たせない。 */
function AuthenticatedApp() {
  const { user } = useAuth();
  const { memoryOwner, mainStateOwner, mainStateProviderKey } = resolveAppOwnerIdentity(user);
  return (
    <MemoryProvider owner={memoryOwner}>
      <MainStateBootstrap owner={mainStateOwner}>
        <AppProvider key={mainStateProviderKey}>
          <MainStatePersistence owner={mainStateOwner}>
            <TimerProvider>
              <ToastProvider>
                <MaterialProgressIntegrityBridge />
                <MainStateMergeBridge />
                <MainStateWriterLeaseBridge />
                <Shell />
              </ToastProvider>
            </TimerProvider>
          </MainStatePersistence>
        </AppProvider>
      </MainStateBootstrap>
    </MemoryProvider>
  );
}

export default function App() {
  // standalone起動かどうかはページ読み込み中に変わらないため初回判定のみでよい
  const [gated] = useState(() => shouldShowInstallGate());

  if (gated) {
    return <InstallGate />;
  }

  return (
    <SchemaCompatibilityGate>
      <AuthProvider>
        <InstallBanner />
        <AuthGate>
          <AuthenticatedApp />
        </AuthGate>
      </AuthProvider>
    </SchemaCompatibilityGate>
  );
}
