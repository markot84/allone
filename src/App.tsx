import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/common';
import { AppShell } from './components/layout';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { WeightConfigurator } from './components/strategy';
import { RFMAnalysis } from './components/rfm';
import { ProductIntelligence } from './components/inventory';
import { ChannelActivation } from './components/channels';
import { ContentStrategy } from './components/content';
import { Reports } from './components/reports';
import { ROIAttribution } from './components/roi';
import { Help } from './components/help';
import { Concept } from './components/concept';
import { AIInsightsPanel, AIInsightsTrigger } from './components/insights';
import { DataImport } from './components/data';
import { aiInsights } from './data';

const queryClient = new QueryClient();

function App() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(false);

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardOverview />;
      case 'strategy':
        return <WeightConfigurator />;
      case 'rfm':
        return <RFMAnalysis />;
      case 'products':
        return <ProductIntelligence />;
      case 'channels':
        return <ChannelActivation />;
      case 'calendar':
        return <ContentStrategy />;
      case 'reports':
        return <Reports />;
      case 'roi':
        return <ROIAttribution />;
      case 'data':
        return <DataImport />;
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
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
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
          {renderContent()}
        </AppShell>

        {/* AI Insights Floating Button */}
        <AIInsightsTrigger
          onClick={() => setInsightsPanelOpen(true)}
          insightCount={aiInsights.filter(i => i.impact === 'high').length}
        />

        {/* AI Insights Panel */}
        <AIInsightsPanel
          isOpen={insightsPanelOpen}
          onClose={() => setInsightsPanelOpen(false)}
        />
      </div>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
