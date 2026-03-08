import { useState, useEffect, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ToastProvider, ErrorBoundary } from './components/common';
import { auth } from './config/firebase';
import { AuthGuard, InviteAcceptPage, InviteUserSection } from './components/auth';
import { AppShell } from './components/layout';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { WeightConfigurator } from './components/strategy';
import { RFMAnalysis } from './components/rfm';
import { ProductIntelligence } from './components/inventory';
import { ChannelActivation } from './components/channels';
import { CampaignsPage } from './components/campaigns/CampaignsPage';
import { ContentStrategy } from './components/content';
import { Reports } from './components/reports';
import { ROIAttribution } from './components/roi';
import { Help } from './components/help';
import { Concept } from './components/concept';
import { AIInsightsPanel, AIInsightsTriggerWrapper } from './components/insights';
import { DataImport } from './components/data';
import { BrandsPage } from './components/brands';
import { BusinessFinances } from './components/finances';
import { SuperAdminDashboard } from './components/admin';
import { isSuperAdminEmail } from './config/superAdmins';

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
          maxAge: 24 * 60 * 60 * 1000 // 24h
        }}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function App() {
  // Initialize from URL hash or default to dashboard
  const getInitialSection = () => {
    if (typeof window === 'undefined') return 'dashboard';
    const hash = window.location.hash.replace('#', '');
    const validSections = ['brands', 'dashboard', 'strategy', 'rfm', 'products', 'channels', 'campaigns', 'finances', 'calendar', 'reports', 'roi', 'data', 'data-products', 'data-segments', 'data-campaigns', 'data-organic', 'invite', 'concept', 'help', 'admin'];
    if (hash && validSections.includes(hash)) return hash;
    return 'dashboard';
  };

  const [activeSection, setActiveSection] = useState(getInitialSection);
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(false);

  // Sync URL hash with active section
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (hash !== activeSection && activeSection !== 'insights') {
      window.history.replaceState(null, '', `#${activeSection}`);
    }
  }, [activeSection]);

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && hash !== activeSection) {
        if (hash === 'insights') {
          setInsightsPanelOpen(true);
        } else {
          setActiveSection(hash);
        }
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

  const handleSectionChange = useCallback((section: string) => {
    // Use requestAnimationFrame for instant UI update
    requestAnimationFrame(() => {
      if (section === 'insights') {
        setInsightsPanelOpen(true);
      } else {
        setActiveSection(section);
        // Update URL hash for persistence
        if (typeof window !== 'undefined') {
          window.history.pushState(null, '', `#${section}`);
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
      case 'channels':
        return <ChannelActivation onSectionChange={handleSectionChange} />;
      case 'campaigns':
        return <CampaignsPage onSectionChange={handleSectionChange} />;
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
        return <DataImport initialType={
          activeSection === 'data-products' ? 'products' :
          activeSection === 'data-segments' ? 'segments' :
          activeSection === 'data-campaigns' ? 'campaigns' :
          activeSection === 'data-organic' ? 'organic' : undefined
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
            {renderContent()}
          </ErrorBoundary>
        </AppShell>

        {/* AI Insights Floating Button */}
        <AIInsightsTriggerWrapper onClick={() => setInsightsPanelOpen(true)} />

        {/* AI Insights Panel */}
        <AIInsightsPanel
          isOpen={insightsPanelOpen}
          onClose={() => setInsightsPanelOpen(false)}
        />
      </div>
      </AuthGuard>
      </ToastProvider>
    </QueryProvider>
  );
}

export default App;
