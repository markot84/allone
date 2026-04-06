import { useState, useEffect, useLayoutEffect, useCallback, lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ToastProvider, ErrorBoundary, Spinner } from './components/common';
import { auth } from './config/firebase';
import { AuthGuard, InviteAcceptPage, InviteUserSection } from './components/auth';
import { AppShell } from './components/layout';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { RFMAnalysis } from './components/rfm';
import { ChannelActivation } from './components/channels';
import { CampaignsPage } from './components/campaigns/CampaignsPage';
import { ContentStrategy } from './components/content';
import { Help } from './components/help';
import { Concept } from './components/concept';
import { AIInsightsPanel, AIInsightsTriggerWrapper } from './components/insights';
import { DataImport } from './components/data';
import { SuppliersPage } from './components/inventory/SuppliersPage';
import { BrandsPage } from './components/brands';
import { AuthActionPage } from './components/auth/AuthActionPage';
import { isSuperAdminEmail } from './config/superAdmins';
import { SharedPackageViewer } from './components/strategy/SharedPackageViewer';
import { CoordinationPage } from './components/coordination';
import { AutomationSettingsPage } from './components/settings';
import { GA4Analytics } from './components/analytics/GA4Analytics';
import { EnterpriseBadge } from './components/common';
import { usePlan } from './hooks/usePlan';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import { TermsOfService } from './components/legal/TermsOfService';
import { captureOAuthParamsFromLocation } from './utils/oauthSession';

const ProductIntelligence = lazy(() => import('./components/inventory').then(m => ({ default: m.ProductIntelligence })));
const ROIAttribution = lazy(() => import('./components/roi').then(m => ({ default: m.ROIAttribution })));
const CompetitorInsights = lazy(() => import('./components/competitive/CompetitorInsights').then(m => ({ default: m.CompetitorInsights })));
const SuperAdminDashboard = lazy(() => import('./components/admin').then(m => ({ default: m.SuperAdminDashboard })));
const WeightConfigurator = lazy(() => import('./components/strategy').then(m => ({ default: m.WeightConfigurator })));
const Reports = lazy(() => import('./components/reports').then(m => ({ default: m.Reports })));
const BusinessFinances = lazy(() => import('./components/finances').then(m => ({ default: m.BusinessFinances })));
const ProcurementPage = lazy(() => import('./components/procurement/ProcurementPage').then(m => ({ default: m.ProcurementPage })));
const EcommerceDashboard = lazy(() => import('./components/ecommerce/EcommerceDashboard').then(m => ({ default: m.EcommerceDashboard })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 }
  }
});

const persister = typeof window !== 'undefined'
  ? createSyncStoragePersister({
      storage: window.localStorage,
      key: 'PERF_PLUS_QUERY_CACHE',
      throttleTime: 1000
    })
  : undefined;

function QueryProvider({ children }: { children: React.ReactNode }) {
  if (persister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              const key = query.queryKey[0];
              // AI queries: always fresh
              if (key === 'aiChannelRecommendations' || key === 'aiContentSuggestions') return false;
              // Large Firestore collections: served by Firestore's own IndexedDB cache —
              // keeping them out of localStorage prevents quota-exceeded errors that
              // silently wipe the entire persisted cache.
              if (key === 'campaigns' || key === 'search_intelligence') return false;
              // Don't persist empty / null results
              if (query.state.data === null || query.state.data === undefined) return false;
              return true;
            }
          }
        }}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function App() {
  const VALID_SECTIONS = ['brands', 'dashboard', 'strategy', 'rfm', 'products', 'suppliers', 'procurement', 'channels', 'campaigns', 'competitive', 'analytics', 'ecommerce', 'finances', 'calendar', 'reports', 'roi', 'data', 'data-products', 'data-segments', 'data-campaigns', 'data-organic', 'data-procurement', 'invite', 'concept', 'help', 'admin', 'coordination', 'automation'] as const;

  // Initialize from URL hash or default to dashboard (υποστηρίζει #products?stock=low)
  const getInitialSection = () => {
    if (typeof window === 'undefined') return 'dashboard';
    try {
      if (new URLSearchParams(window.location.search).get('pp_oauth') === '1') return 'data';
    } catch {
      /* ignore */
    }
    const hash = window.location.hash.replace('#', '');
    const baseSection = hash.split('?')[0];
    if (baseSection && VALID_SECTIONS.includes(baseSection as (typeof VALID_SECTIONS)[number])) return baseSection;
    return 'dashboard';
  };

  const [activeSection, setActiveSection] = useState(getInitialSection);
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(false);

  // Πριν από child effects: αποθήκευση OAuth query (connector/status) — αλλιώς χάνεται από hash sync ή race.
  useLayoutEffect(() => {
    captureOAuthParamsFromLocation();
  }, []);

  // Sync active section → hash (μόνο path — διατηρεί query όταν ήδη ταιριάζει το section)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    const base = hash.split('?')[0];
    if (hash.includes('connector=')) return;
    if (base !== activeSection && activeSection !== 'insights') {
      window.history.replaceState(null, '', `#${activeSection}`);
    }
  }, [activeSection]);

  // Browser back/forward — parse μόνο το path του hash
  useEffect(() => {
    const handleHashChange = () => {
      const full = window.location.hash.replace('#', '');
      const base = full.split('?')[0];
      if (!full) return;
      if (base === 'insights') {
        setInsightsPanelOpen(true);
        return;
      }
      if (VALID_SECTIONS.includes(base as (typeof VALID_SECTIONS)[number]) && base !== activeSection) {
        setActiveSection(base);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeSection]);

  // Listen for navigate-to-help events
  useEffect(() => {
    const handleNavigateToHelp = () => {
      setActiveSection('help');
      // The Help component will handle the articleId from hash
    };
    window.addEventListener('navigate-to-help' as any, handleNavigateToHelp);
    return () => {
      window.removeEventListener('navigate-to-help' as any, handleNavigateToHelp);
    };
  }, []);

  // Handle Firebase Auth action URLs (password reset, email verification)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const authMode = params.get('mode');
    const oobCode = params.get('oobCode');
    if (authMode && oobCode) {
      return (
        <QueryProvider>
          <ToastProvider>
            <AuthActionPage
              mode={authMode}
              oobCode={oobCode}
              onDone={() => { window.location.href = '/?auth=1'; }}
            />
          </ToastProvider>
        </QueryProvider>
      );
    }
  }

  // Handle /invite/:token route (no AuthGuard - page works for both logged-in and logged-out users)
  const pathMatch = typeof window !== 'undefined' && window.location.pathname.match(/^\/invite\/([^/]+)$/);
  if (pathMatch) {
    return (
      <QueryProvider>
        <ToastProvider>
          <InviteAcceptPage
            token={pathMatch[1]}
            onAccepted={() => {
              window.location.href = '/';
            }}
          />
        </ToastProvider>
      </QueryProvider>
    );
  }

  // Public legal pages (no auth required)
  if (typeof window !== 'undefined' && window.location.pathname === '/privacy') {
    return (
      <QueryProvider>
        <ToastProvider>
          <PrivacyPolicy />
        </ToastProvider>
      </QueryProvider>
    );
  }

  if (typeof window !== 'undefined' && window.location.pathname === '/terms') {
    return (
      <QueryProvider>
        <ToastProvider>
          <TermsOfService />
        </ToastProvider>
      </QueryProvider>
    );
  }

  // Handle #shared/ID route — public viewer for shared strategy packages
  const sharedMatch = typeof window !== 'undefined' && window.location.hash.match(/^#shared\/([a-zA-Z0-9]+)$/);
  if (sharedMatch) {
    return (
      <QueryProvider>
        <ToastProvider>
          <div style={{ minHeight: '100vh', backgroundColor: '#fff', padding: 24 }}>
            <SharedPackageViewer packageId={sharedMatch[1]} />
          </div>
        </ToastProvider>
      </QueryProvider>
    );
  }

  const handleSectionChange = useCallback((section: string, opts?: { hashQuery?: string }) => {
    requestAnimationFrame(() => {
      if (section === 'insights') {
        setInsightsPanelOpen(true);
      } else {
        setActiveSection(section);
        window.scrollTo({ top: 0 });
        if (typeof window !== 'undefined') {
          const q = opts?.hashQuery ? (opts.hashQuery.startsWith('?') ? opts.hashQuery : `?${opts.hashQuery}`) : '';
          window.history.pushState(null, '', `#${section}${q}`);
          // pushState δεν ενεργοποιεί πάντα hashchange — χρειάζεται για deep links (π.χ. Product Intelligence filters)
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      }
    });
  }, []);

  const renderContent = () => {
    switch (activeSection) {
      case 'brands':
        return <BrandsPage onNavigateToDashboard={() => handleSectionChange('dashboard')} />;
      case 'dashboard':
        return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => setInsightsPanelOpen(true)} />;
      case 'strategy':
        return <WeightConfigurator />;
      case 'rfm':
        return <RFMAnalysis onSectionChange={handleSectionChange} />;
      case 'products':
        return <ProductIntelligence onSectionChange={handleSectionChange} />;
      case 'suppliers':
        return <SuppliersPage />;
      case 'procurement':
        return <ProcurementGate onSectionChange={handleSectionChange} />;
      case 'channels':
        return <ChannelActivation onSectionChange={handleSectionChange} />;
      case 'campaigns':
        return <CampaignsPage onSectionChange={handleSectionChange} />;
      case 'coordination':
        return <CoordinationPage />;
      case 'automation':
        return <AutomationSettingsPage />;
      case 'competitive':
        return <CompetitorInsights />;
      case 'analytics':
        return <GA4Analytics />;
      case 'ecommerce':
        return <EcommerceDashboard />;
      case 'finances':
        return <BusinessFinances onSectionChange={handleSectionChange} />;
      case 'calendar':
        return <ContentStrategy />;
      case 'reports':
        return <Reports />;
      case 'roi':
        return <ROIAttribution />;
      case 'data':
      case 'data-products':
      case 'data-segments':
      case 'data-campaigns':
      case 'data-organic':
      case 'data-procurement':
        return <DataImport initialType={
          activeSection === 'data-products' ? 'products' :
          activeSection === 'data-segments' ? 'segments' :
          activeSection === 'data-campaigns' ? 'campaigns' :
          activeSection === 'data-organic' ? 'organic' :
          activeSection === 'data-procurement' ? 'procurement' : undefined
        } />;
      case 'invite':
        return <InviteUserSection />;
      case 'concept':
        return <Concept onNavigateToStrategy={() => handleSectionChange('strategy')} />;
      case 'help':
        return <Help />;
      case 'admin': {
        // Gate: only super admins can access this route
        const u = auth.currentUser;
        if (!isSuperAdminEmail(u?.email)) {
          handleSectionChange('dashboard');
          return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => setInsightsPanelOpen(true)} />;
        }
        return <SuperAdminDashboard />;
      }
      default:
        return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => setInsightsPanelOpen(true)} />;
    }
  };

  return (
    <QueryProvider>
      <ToastProvider>
      <AuthGuard>
      <div style={{ 
        height: '100vh', 
        width: '100vw',
        maxWidth: '100vw',
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        position: 'relative'
      }}>
        <AppShell
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        >
          <ErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>}>
              {renderContent()}
            </Suspense>
          </ErrorBoundary>
        </AppShell>

        {/* AI Insights Floating Button */}
        <AIInsightsTriggerWrapper onClick={() => setInsightsPanelOpen(true)} />

        {/* AI Insights Panel */}
        <AIInsightsPanel
          isOpen={insightsPanelOpen}
          onClose={() => setInsightsPanelOpen(false)}
          onNavigate={handleSectionChange}
        />
      </div>
      </AuthGuard>
      </ToastProvider>
    </QueryProvider>
  );
}

function ProcurementGate({ onSectionChange }: { onSectionChange: (s: string, opts?: { hashQuery?: string }) => void }) {
  const { isEnterprise } = usePlan();
  if (!isEnterprise) return <div className="max-w-xl mx-auto mt-12"><EnterpriseBadge /></div>;
  return <ProcurementPage onSectionChange={onSectionChange} />;
}

export default App;
