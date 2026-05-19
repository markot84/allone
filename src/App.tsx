import { useState, useEffect, useLayoutEffect, useCallback, lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ToastProvider, ErrorBoundary, Spinner } from './components/common';
import { auth } from './config/firebase';
import { AuthGuard, InviteAcceptPage, InviteUserSection } from './components/auth';
import { AppShell } from './components/layout';
import { AIInsightsTriggerWrapper } from './components/insights/AIInsightsPanel';
import { AuthActionPage } from './components/auth/AuthActionPage';
import { isSuperAdminEmail } from './config/superAdmins';
import { SharedPackageViewer } from './components/strategy/SharedPackageViewer';
import { EnterpriseBadge } from './components/common';
import { useModules } from './hooks/useModules';
import { usePlan } from './hooks/usePlan';
import { useAppWarmup } from './hooks/useAppWarmup';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import { TermsOfService } from './components/legal/TermsOfService';
import { captureOAuthParamsFromLocation } from './utils/oauthSession';
import { AttributionProvider } from './contexts/AttributionContext';
import { APP_SECTIONS } from './config/modules';

const CHUNK_RELOAD_ONCE_KEY = 'pp_chunk_reload_once';
const isChunkLoadError = (msg: string) =>
  /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Unexpected token|Importing a module script failed/i.test(msg);

type AnyComponent = ComponentType<any>;
function lazyNamedWithRetry<T extends Record<string, unknown>, K extends keyof T>(
  importer: () => Promise<T>,
  exportName: K
): LazyExoticComponent<Extract<T[K], AnyComponent>> {
  return lazy(async () => {
    try {
      const mod = await importer();
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(CHUNK_RELOAD_ONCE_KEY);
      }
      return { default: mod[exportName] as Extract<T[K], AnyComponent> };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (typeof window !== 'undefined' && isChunkLoadError(message)) {
        const alreadyRetried = window.sessionStorage.getItem(CHUNK_RELOAD_ONCE_KEY) === '1';
        if (!alreadyRetried) {
          window.sessionStorage.setItem(CHUNK_RELOAD_ONCE_KEY, '1');
          window.location.reload();
          await new Promise<never>(() => {});
        }
      }
      throw err;
    }
  });
}

const ProductIntelligence = lazyNamedWithRetry(() => import('./components/inventory'), 'ProductIntelligence');
const ROIAttribution = lazyNamedWithRetry(() => import('./components/roi'), 'ROIAttribution');
const CompetitorInsights = lazyNamedWithRetry(() => import('./components/competitive/CompetitorInsights'), 'CompetitorInsights');
const SuperAdminDashboard = lazyNamedWithRetry(() => import('./components/admin'), 'SuperAdminDashboard');
const WeightConfigurator = lazyNamedWithRetry(() => import('./components/strategy'), 'WeightConfigurator');
const PolicyImpactPage = lazyNamedWithRetry(() => import('./components/strategy/PolicyImpactPage'), 'PolicyImpactPage');
const MarketingPlanPage = lazyNamedWithRetry(() => import('./components/marketing/MarketingPlanPage'), 'MarketingPlanPage');
const Reports = lazyNamedWithRetry(() => import('./components/reports'), 'Reports');
const BusinessFinances = lazyNamedWithRetry(() => import('./components/finances'), 'BusinessFinances');
const ProcurementPage = lazyNamedWithRetry(() => import('./components/procurement/ProcurementPage'), 'ProcurementPage');
const EcommerceDashboard = lazyNamedWithRetry(() => import('./components/ecommerce/EcommerceDashboard'), 'EcommerceDashboard');
const SalesPipelinePage = lazyNamedWithRetry(() => import('./components/b2b/SalesPipelinePage'), 'SalesPipelinePage');
const AccountIntelligencePage = lazyNamedWithRetry(() => import('./components/b2b/AccountIntelligencePage'), 'AccountIntelligencePage');
const MarketExplorationPage = lazyNamedWithRetry(() => import('./components/b2b/MarketExplorationPage'), 'MarketExplorationPage');
const BrandsPage = lazyNamedWithRetry(() => import('./components/brands'), 'BrandsPage');
const DashboardOverview = lazyNamedWithRetry(() => import('./components/dashboard/DashboardOverview'), 'DashboardOverview');
const RFMAnalysis = lazyNamedWithRetry(() => import('./components/rfm'), 'RFMAnalysis');
const ChannelActivation = lazyNamedWithRetry(() => import('./components/channels'), 'ChannelActivation');
const CampaignsPage = lazyNamedWithRetry(() => import('./components/campaigns/CampaignsPage'), 'CampaignsPage');
const ContentStrategy = lazyNamedWithRetry(() => import('./components/content'), 'ContentStrategy');
const Help = lazyNamedWithRetry(() => import('./components/help'), 'Help');
const Concept = lazyNamedWithRetry(() => import('./components/concept'), 'Concept');
const AIInsightsPage = lazyNamedWithRetry(() => import('./components/insights/AIInsightsPage'), 'AIInsightsPage');
const DataImport = lazyNamedWithRetry(() => import('./components/data'), 'DataImport');
const SuppliersPage = lazyNamedWithRetry(() => import('./components/inventory/SuppliersPage'), 'SuppliersPage');
const CoordinationPage = lazyNamedWithRetry(() => import('./components/coordination'), 'CoordinationPage');
const AutomationSettingsPage = lazyNamedWithRetry(() => import('./components/settings'), 'AutomationSettingsPage');
const GA4Analytics = lazyNamedWithRetry(() => import('./components/analytics/GA4Analytics'), 'GA4Analytics');
const HRPage = lazyNamedWithRetry(() => import('./components/hr/HRPage'), 'HRPage');
const OfferBuilderPage = lazyNamedWithRetry(() => import('./components/offers/OfferBuilderPage'), 'OfferBuilderPage');
const TerritoryPage = lazyNamedWithRetry(() => import('./components/territories/TerritoryPage'), 'TerritoryPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 }
  }
});

const QUERY_CACHE_KEY = 'PERF_PLUS_QUERY_CACHE_v15';

if (typeof window !== 'undefined') {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('PERF_PLUS_QUERY_CACHE_') && key !== QUERY_CACHE_KEY)
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* Storage can be unavailable in private mode; ignore. */
  }
}

const persister = typeof window !== 'undefined'
  ? createSyncStoragePersister({
      storage: window.localStorage,
      /** Bump when persisted query shapes change or old cache starts blocking first paint. */
      key: QUERY_CACHE_KEY,
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
              // Sensitive credentials/tokens should not be serialized into localStorage.
              if (key === 'apiKeys') return false;
              // Large Firestore collections: served by Firestore's own IndexedDB cache —
              // keeping them out of localStorage prevents quota-exceeded errors that
              // silently wipe the entire persisted cache.
              if (key === 'campaigns' || key === 'search_intelligence' || key === 'priceBenchmarks' || key === 'priceInsights') return false;
              // Product query shape changed during the rollback window; always refetch it from Firestore.
              if (key === 'products') return false;
              // Heavy raw order pulls stay out of localStorage; compact server summaries are persisted for fast first paint.
              if (
                key === 'ecommerceOrdersRaw' ||
                key === 'dataAnalysisOrdersRaw' ||
                key === 'segmentCustomerSummaries' ||
                /** Maps → broken `{}` after JSON; `.has()` crashes RFM. Heavy anyway — refetch like raw orders. */
                key === 'catalogAlignment' ||
                key === 'catalogAlignmentDataAnalysis'
              ) {
                return false;
              }
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

/** `#/section` → `section` ώστε να ταιριάζει σε VALID_SECTIONS και στο hashchange handler. */
function normalizeHashPath(segmentPart: string): string {
  const raw = segmentPart.trim();
  if (!raw) return '';
  return (raw.startsWith('/') ? raw.slice(1) : raw).trim();
}

/** Hash routing + AppShell — must render under AuthGuard → BrandProvider (useModules → useBrand). */
function AppMain() {
  const { isSectionEnabled, getFallbackSection } = useModules();
  useAppWarmup();
  const VALID_SECTIONS = APP_SECTIONS;

  // Initialize from URL hash or default to dashboard (υποστηρίζει #products?stock=low)
  const getInitialSection = () => {
    if (typeof window === 'undefined') return 'dashboard';
    try {
      if (new URLSearchParams(window.location.search).get('pp_oauth') === '1') return 'data';
    } catch {
      /* ignore */
    }
    const hash = window.location.hash.replace('#', '');
    const baseSection = normalizeHashPath(hash.split('?')[0]);
    if (baseSection && VALID_SECTIONS.includes(baseSection as (typeof VALID_SECTIONS)[number]) && isSectionEnabled(baseSection)) return baseSection;
    return getFallbackSection();
  };

  const [activeSection, setActiveSection] = useState(getInitialSection);

  // Πριν από child effects: αποθήκευση OAuth query (connector/status) — αλλιώς χάνεται από hash sync ή race.
  useLayoutEffect(() => {
    captureOAuthParamsFromLocation();
  }, []);

  // Sync active section → hash (μόνο path — διατηρεί query όταν ήδη ταιριάζει το section)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    const base = normalizeHashPath(hash.split('?')[0]);
    if (hash.includes('connector=')) return;
    if (base !== activeSection) {
      window.history.replaceState(null, '', `#${activeSection}`);
    }
  }, [activeSection]);

  // Browser back/forward — parse μόνο το path του hash
  useEffect(() => {
    const handleHashChange = () => {
      const full = window.location.hash.replace('#', '');
      const base = normalizeHashPath(full.split('?')[0]);
      if (!full) return;
      if (!isSectionEnabled(base)) {
        setActiveSection(getFallbackSection());
        return;
      }
      if (VALID_SECTIONS.includes(base as (typeof VALID_SECTIONS)[number]) && base !== activeSection) {
        setActiveSection(base);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeSection, getFallbackSection, isSectionEnabled]);

  useEffect(() => {
    if (isSectionEnabled(activeSection)) return;
    const fallback = getFallbackSection();
    setActiveSection(fallback);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${fallback}`);
    }
  }, [activeSection, getFallbackSection, isSectionEnabled]);

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

  const handleSectionChange = useCallback((section: string, opts?: { hashQuery?: string }) => {
    requestAnimationFrame(() => {
      const targetSection = isSectionEnabled(section) ? section : getFallbackSection();
      setActiveSection(targetSection);
      window.scrollTo({ top: 0 });
      if (typeof window !== 'undefined') {
        const q = targetSection === section && opts?.hashQuery ? (opts.hashQuery.startsWith('?') ? opts.hashQuery : `?${opts.hashQuery}`) : '';
        window.history.pushState(null, '', `#${targetSection}${q}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    });
  }, [getFallbackSection, isSectionEnabled]);

  const renderContent = () => {
    switch (activeSection) {
      case 'brands':
        return <BrandsPage onNavigateToDashboard={() => handleSectionChange('dashboard')} />;
      case 'dashboard':
        return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => handleSectionChange('insights')} />;
      case 'sales':
        return <SalesPipelinePage onSectionChange={handleSectionChange} />;
      case 'accounts':
        return <AccountIntelligencePage onSectionChange={handleSectionChange} />;
      case 'markets':
        return <MarketExplorationPage onSectionChange={handleSectionChange} />;
      case 'strategy':
        return <WeightConfigurator onSectionChange={handleSectionChange} />;
      case 'policy-impact':
        return <PolicyImpactPage onSectionChange={handleSectionChange} />;
      case 'marketing-plan':
        return <MarketingPlanPage onSectionChange={handleSectionChange} />;
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
      case 'hr':
        return <HRPage />;
      case 'offers':
        return <OfferBuilderPage onSectionChange={handleSectionChange} />;
      case 'territories':
        return <TerritoryPage onSectionChange={handleSectionChange} />;
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
      case 'insights':
        return <AIInsightsPage onSectionChange={handleSectionChange} />;
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
          return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => handleSectionChange('insights')} />;
        }
        return <SuperAdminDashboard />;
      }
      default:
        return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => handleSectionChange('insights')} />;
    }
  };

  return (
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

      {activeSection !== 'insights' && (
        <AIInsightsTriggerWrapper onClick={() => handleSectionChange('insights')} />
      )}
    </div>
  );
}

/**
 * Static / public routes first (no hooks). Main SPA uses AppMain only under AuthGuard → BrandProvider
 * so useModules() → useBrand() does not throw for logged-out users.
 */
function App() {
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

  const pathMatch =
    typeof window !== 'undefined' &&
    window.location.pathname.match(/^\/(?:invite|redeem)\/([^/]+)$/);
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

  return (
    <QueryProvider>
      <AttributionProvider>
        <ToastProvider>
          <AuthGuard>
            <AppMain />
          </AuthGuard>
        </ToastProvider>
      </AttributionProvider>
    </QueryProvider>
  );
}

function ProcurementGate({ onSectionChange }: { onSectionChange: (s: string, opts?: { hashQuery?: string }) => void }) {
  const { isEnterprise } = usePlan();
  if (!isEnterprise) return <div className="max-w-xl mx-auto mt-12"><EnterpriseBadge /></div>;
  return <ProcurementPage onSectionChange={onSectionChange} />;
}

export default App;
