import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ToastProvider, ErrorBoundary } from './components/common';
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
  const [activeSection, setActiveSection] = useState('dashboard');
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(false);

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

  const renderContent = () => {
    switch (activeSection) {
      case 'brands':
        return <BrandsPage onNavigateToDashboard={() => handleSectionChange('dashboard')} />;
      case 'dashboard':
        return <DashboardOverview onSectionChange={handleSectionChange} onOpenInsights={() => setInsightsPanelOpen(true)} />;
      case 'strategy':
        return <WeightConfigurator />;
      case 'rfm':
        return <RFMAnalysis />;
      case 'products':
        return <ProductIntelligence />;
      case 'channels':
        return <ChannelActivation onSectionChange={handleSectionChange} />;
      case 'campaigns':
        return <CampaignsPage />;
      case 'calendar':
        return <ContentStrategy />;
      case 'reports':
        return <Reports />;
      case 'roi':
        return <ROIAttribution />;
      case 'data':
        return <DataImport />;
      case 'invite':
        return <InviteUserSection />;
      case 'concept':
        return <Concept onNavigateToStrategy={() => handleSectionChange('strategy')} />;
      case 'help':
        return <Help />;
      default:
        return <DashboardOverview />;
    }
  };

  const handleSectionChange = (section: string) => {
    if (section === 'insights') {
      setInsightsPanelOpen(true);
    } else {
      setActiveSection(section);
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
          <ErrorBoundary key={activeSection}>
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
