import { Compass, Globe2, MapPinned, Radar, Rocket } from 'lucide-react';
import { Button, Card, KPICard, PageHeader } from '../common';
import { MarketBriefExplorer } from './MarketBriefExplorer';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useProductSource } from '../../hooks/useProductSource';
import { useSuppliers } from '../../hooks/useSuppliers';

interface MarketExplorationPageProps {
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
}

export function MarketExplorationPage({ onSectionChange }: MarketExplorationPageProps = {}) {
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  const { count: productsCount } = useProductSource();
  const { suppliers } = useSuppliers();
  const { count: campaignsCount } = useCampaigns();
  const ga4 = useGA4Data();

  const readinessChecks = [
    productsCount > 0,
    suppliers.length > 0,
    campaignsCount > 0,
    ga4.hasData,
    Boolean(activeStrategy),
  ];
  const readinessScore = Math.round((readinessChecks.filter(Boolean).length / readinessChecks.length) * 100);

  const expansionLanes = [
    {
      title: 'Explore',
      icon: Compass,
      bullets: [
        'Sizing ανά γεωγραφία, vertical ή distributor network',
        'Εντοπισμός demand signals από campaigns, organic search και field feedback',
        'Check εμπορικού fit με διαθέσιμο assortment',
      ],
    },
    {
      title: 'Validate',
      icon: Radar,
      bullets: [
        'Pilot offers ανά account cluster ή αγορά',
        'Margin, lead time και supplier resilience check',
        'Commercial brief προς πωλήσεις και marketing',
      ],
    },
    {
      title: 'Launch',
      icon: Rocket,
      bullets: [
        'Channel plan, owner, weekly KPI review',
        'Demand generation + sales follow-up cadence',
        'Tracking για win rate, forecast και stock exposure',
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[var(--text-heading)] sm:text-2xl">Market Exploration</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Workspace για νέα markets, νέα verticals και channel rollouts με έμφαση σε margin, stock risk και sales readiness.
          </p>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          index={0}
          kpi={{
            label: 'Expansion readiness',
            value: `${readinessScore}%`,
            changeLabel: 'go-to-market',
            tooltip: 'Συνδυασμός assortment, suppliers, campaigns, analytics και στρατηγικής.',
          }}
          onClick={() => onSectionChange?.('strategy')}
        />
        <KPICard
          index={1}
          kpi={{
            label: 'Assortment fit',
            value: `${productsCount}`,
            changeLabel: 'active SKUs',
            tooltip: 'Προϊόντα που μπορούν να στηρίξουν νέο market entry.',
          }}
          onClick={() => onSectionChange?.('products')}
        />
        <KPICard
          index={2}
          kpi={{
            label: 'Supplier cover',
            value: `${suppliers.length}`,
            changeLabel: 'supplier nodes',
            tooltip: 'Προμηθευτές που επηρεάζουν lead times και launch reliability.',
          }}
          onClick={() => onSectionChange?.('suppliers')}
        />
        <KPICard
          index={3}
          kpi={{
            label: 'Digital validation',
            value: ga4.hasData || campaignsCount > 0 ? 'Active' : 'Pending',
            changeLabel: campaignsCount > 0 ? `${campaignsCount} campaigns` : 'needs setup',
            tooltip: 'Demand validation από campaigns και web analytics πριν από μεγάλο rollout.',
          }}
          onClick={() => onSectionChange?.('campaigns')}
        />
      </div>

      <MarketBriefExplorer />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {expansionLanes.map((lane) => (
          <Card key={lane.title}>
            <div className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <lane.icon size={18} className="text-[var(--nts-accent-text)]" />
                <h3 className="font-semibold text-[#1A1A1A]">{lane.title}</h3>
              </div>
              <div className="space-y-2">
                {lane.bullets.map((bullet) => (
                  <div key={bullet} className="rounded-lg border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2 text-sm text-[#6B7280]">
                    {bullet}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <div className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Globe2 size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Go-to-market blueprint</h3>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Market thesis</p>
                <p className="mt-1 text-sm text-[#6B7280]">Ποιο πρόβλημα λύνεις, σε ποιο ICP, με ποιο margin και ποιο service promise.</p>
              </div>
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Route to market</p>
                <p className="mt-1 text-sm text-[#6B7280]">Direct sales, distributor, digital demand gen ή υβριδικό μοντέλο ανά αγορά.</p>
              </div>
              <div className="rounded-lg border border-[#E5E5E5] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Execution constraints</p>
                <p className="mt-1 text-sm text-[#6B7280]">Stock availability, local compliance, pricing logic και sales enablement assets.</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <MapPinned size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Suggested next steps</h3>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Commercial strategy</p>
                <p className="mt-1 text-sm text-[#6B7280]">
                  {activeStrategy ? `Active motion: ${getStrategyName(activeStrategy.scenarioId)}.` : 'Ορισμός strategy package για το νέο market motion.'}
                </p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('strategy')}>
                  Open Strategy
                </Button>
              </div>
              <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Field execution</p>
                <p className="mt-1 text-sm text-[#6B7280]">Μετέφερε το rollout σε tasks, briefings και owners ώστε να μην μείνει η αγορά στο επίπεδο ιδέας.</p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('coordination')}>
                  Open Coordination
                </Button>
              </div>
              <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
                <p className="text-sm font-semibold text-[#1A1A1A]">Demand validation</p>
                <p className="mt-1 text-sm text-[#6B7280]">Τρέξε pilot demand capture και measurement πριν από full-scale market launch.</p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('campaigns')}>
                  Open Campaigns
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
