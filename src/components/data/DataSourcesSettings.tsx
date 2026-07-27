import { useMemo } from 'react';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { RevenueSourceSettings } from './RevenueSourceSettings';
import { SalesChannelRulesEditor } from './SalesChannelRulesEditor';
import { SourceRoleSettingCard, type SourceRoleOption } from './SourceRoleSettingCard';
import { StockSourceInfoCard } from './StockSourceInfoCard';
import { InventoryThresholdsCard } from './InventoryThresholdsCard';
import { resolveRevenuePerformanceSource } from '../../utils/revenueSource';

/** Per-brand "Data Sources" page: groups the source-role settings (revenue performance, e-shop
 *  classification, sales-channel rules). Add new source roles here as SourceRoleSettingCard cards. */
export function DataSourcesSettings() {
  // Period-independent: does this brand have an e-commerce connector with data?
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const hasEshopConnector = ecomm.connectedPlatforms.length > 0 || ecomm.hasData;

  const revenuePerfDefault = resolveRevenuePerformanceSource(undefined, hasEshopConnector);

  const revenuePerfOptions = useMemo<SourceRoleOption[]>(
    () => [
      {
        id: 'eshop_order_date',
        label: 'E-shop κατά ημ. παραγγελίας',
        description:
          'Ο τζίρος του e-shop με ημερομηνία παραγγελίας. Προτείνεται για brands με e-shop.',
        disabled: !hasEshopConnector,
      },
      {
        id: 'erp_document_date',
        label: 'ERP κατά ημ. παραστατικού',
        description:
          'Ο τζίρος όλης της επιχείρησης από το ERP, με ημερομηνία παραστατικού/τιμολογίου.',
      },
    ],
    [hasEshopConnector]
  );

  const defaultLabel =
    revenuePerfOptions.find((o) => o.id === revenuePerfDefault)?.label ?? revenuePerfDefault;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-[var(--nts-charcoal)]">Πηγές δεδομένων</h2>
        <p className="text-[12px] text-[var(--nts-medium-gray)] mt-0.5">
          Ρυθμίσεις ανά brand για το ποια πηγή είναι υπεύθυνη για κάθε μέγεθος (τζίρος, κανάλια). Οι αλλαγές
          εφαρμόζονται μόνο σε αυτό το brand.
        </p>
      </div>

      <SourceRoleSettingCard
        field="revenuePerformanceSource"
        title="Πηγή «Revenue Performance»"
        tooltip="Καθορίζει την πηγή και την ημερομηνία για το γράφημα «Revenue Performance» και το KPI συνολικού τζίρου στο Dashboard. Δεν επηρεάζει τα Οικονομικά (ERP) ή τη σελίδα E-commerce."
        options={revenuePerfOptions}
        defaultId={revenuePerfDefault}
        defaultHint={`Προεπιλογή: ${defaultLabel}`}
        invalidateKeys={(brandId) => [
          ['business_revenue_summary', brandId],
          ['ecommerce_summary', brandId],
        ]}
      />

      <StockSourceInfoCard />

      <InventoryThresholdsCard />

      <RevenueSourceSettings />
      <SalesChannelRulesEditor />
    </div>
  );
}
