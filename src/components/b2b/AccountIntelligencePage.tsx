import { useState } from 'react';
import { BarChart3, Building2, FileSpreadsheet, Wallet, ShieldCheck, LayoutGrid } from 'lucide-react';
import { Button, Card, KPICard, PageHeader } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useOrganic } from '../../hooks/useOrganic';
import { useProductSource } from '../../hooks/useProductSource';
import { AccountHealthTab } from './AccountHealthTab';

type AccountTab = 'framework' | 'health';

interface AccountIntelligencePageProps {
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
}

export function AccountIntelligencePage({ onSectionChange }: AccountIntelligencePageProps = {}) {
  const [activeTab, setActiveTab] = useState<AccountTab>('framework');
  const { currentBrand } = useBrand();
  const { count: productsCount } = useProductSource();
  const { count: campaignsCount } = useCampaigns();
  const { totalOrganicRevenue, hasOrganicRevenue } = useOrganic();

  const readinessSignals = [
    { label: 'Catalog / assortment', ready: productsCount > 0 },
    { label: 'Revenue baseline', ready: hasOrganicRevenue || Boolean(currentBrand?.enterpriseTurnoverEUR) },
    { label: 'Demand generation', ready: campaignsCount > 0 },
    { label: 'Account data imports', ready: false },
  ];

  const readinessScore = Math.round((readinessSignals.filter((signal) => signal.ready).length / readinessSignals.length) * 100);
  const revenueBaseline = Math.max(currentBrand?.enterpriseTurnoverEUR ?? 0, totalOrganicRevenue ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Account Intelligence</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Το B2B replacement του retail RFM: health, priority και growth potential ανά πελάτη ή account cluster.
          </p>
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl border border-[#eef0f3] bg-[#f9fafb] p-1 w-fit">
        {([
          { id: 'framework' as AccountTab, label: 'Framework', icon: LayoutGrid },
          { id: 'health' as AccountTab, label: 'Account Health Score', icon: ShieldCheck },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              activeTab === id ? 'bg-white text-[var(--nts-charcoal)] shadow-sm' : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]',
            ].join(' ')}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'health' && <AccountHealthTab onSectionChange={onSectionChange} />}
      {activeTab === 'framework' && (<>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          index={0}
          kpi={{
            label: 'Readiness score',
            value: `${readinessScore}%`,
            changeLabel: 'account intelligence',
            tooltip: 'Πόσα από τα βασικά inputs υπάρχουν ήδη για να στηθεί account scoring.',
          }}
          onClick={() => onSectionChange?.('data')}
        />
        <KPICard
          index={1}
          kpi={{
            label: 'Assortment depth',
            value: `${productsCount}`,
            changeLabel: 'SKUs in catalog',
            tooltip: 'Το account intelligence ξεκινά από καθαρό product and margin map.',
          }}
          onClick={() => onSectionChange?.('products')}
        />
        <KPICard
          index={2}
          kpi={{
            label: 'Revenue baseline',
            value: revenueBaseline > 0 ? `€${Math.round(revenueBaseline).toLocaleString('el-GR')}` : 'Pending',
            changeLabel: revenueBaseline > 0 ? 'available' : 'import needed',
            tooltip: 'ERP / invoicing baseline για να μετράς account contribution, DSO και renewal risk.',
          }}
          onClick={() => onSectionChange?.('finances')}
        />
        <KPICard
          index={3}
          kpi={{
            label: 'Acquisition signals',
            value: `${campaignsCount}`,
            changeLabel: 'active campaigns',
            tooltip: 'Campaigns και content είναι το top-of-funnel layer πριν το account qualification.',
          }}
          onClick={() => onSectionChange?.('campaigns')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <div className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Building2 size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Account scoring model</h3>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Revenue quality</p>
                <p className="mt-1 text-sm text-[#6B7280]">Contract value, gross margin, payment consistency και ιστορικό repeat orders.</p>
              </div>
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Commercial momentum</p>
                <p className="mt-1 text-sm text-[#6B7280]">Recency of last deal, meeting cadence, response rate και probability to expand wallet share.</p>
              </div>
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Operational fit</p>
                <p className="mt-1 text-sm text-[#6B7280]">Availability, lead times, dependency on scarce SKUs και service complexity.</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Wallet size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Signals to import next</h3>
            </div>
            <div className="space-y-3 text-sm text-[#6B7280]">
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="font-semibold text-[#1A1A1A]">Invoices & receivables</p>
                <p className="mt-1">Για DSO, overdue exposure και πραγματική συνεισφορά κάθε account.</p>
              </div>
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="font-semibold text-[#1A1A1A]">Customer list / CRM export</p>
                <p className="mt-1">Για territory ownership, industry classification και stage-based follow-up.</p>
              </div>
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="font-semibold text-[#1A1A1A]">Quote history</p>
                <p className="mt-1">Για win/loss learnings, discount discipline και average deal cycle by segment.</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-[var(--nts-accent-text)]" />
            <h3 className="text-lg font-semibold text-[#1A1A1A]">Activation path</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">1. Define account tiers</p>
              <p className="mt-1 text-sm text-[#6B7280]">Strategic, growth, defend και opportunistic accounts ανά margin και opportunity size.</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('reports')}>
                Open Reports
              </Button>
            </div>
            <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">2. Connect finance truth</p>
              <p className="mt-1 text-sm text-[#6B7280]">ERP / invoicing imports για να συνδεθεί account score με πραγματικό revenue quality.</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('data')}>
                Open Data Import
              </Button>
            </div>
            <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">3. Operationalize actions</p>
              <p className="mt-1 text-sm text-[#6B7280]">Πέρασε renewals, cross-sell και rescue motions σε `Sales Pipeline` και `Coordination`.</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('sales')}>
                Open Sales Pipeline
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2 text-[#1A1A1A]">
            <FileSpreadsheet size={18} className="text-[var(--nts-accent-text)]" />
            <h3 className="font-semibold">B2B account dataset</h3>
          </div>
          <p className="text-sm leading-relaxed text-[#6B7280]">
            Το edition είναι έτοιμο να υποδεχθεί customer list, invoicing και quote history. Μέχρι να μπουν αυτά τα feeds,
            η σελίδα λειτουργεί σαν scoring framework για να ευθυγραμμίσεις διοίκηση, πωλήσεις και finance γύρω από τους
            σωστούς B2B λογαριασμούς.
          </p>
        </div>
      </Card>
      </>)}
    </div>
  );
}
