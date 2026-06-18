import { useMemo } from 'react';
import { useBrand } from '../../hooks/useBrand';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useProductIntelligenceAggregateDoc } from '../../hooks/useProductIntelligenceAggregate';
import { RevenueSourceSettings } from './RevenueSourceSettings';
import { SalesChannelRulesEditor } from './SalesChannelRulesEditor';
import { SourceRoleSettingCard, type SourceRoleOption } from './SourceRoleSettingCard';
import { resolveRevenuePerformanceSource } from '../../utils/revenueSource';
import { resolveStockSourceMode, type StockSourceMode } from '../../utils/stockSource';

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
          'Ο τζίρος του e-shop (Magento) με ημερομηνία παραγγελίας. Προτείνεται για brands με e-shop.',
        disabled: !hasEshopConnector,
      },
      {
        id: 'erp_document_date',
        label: 'ERP κατά ημ. παραστατικού',
        description:
          'Ο τζίρος όλης της επιχείρησης από το ERP, με ημερομηνία παραστατικού/τιμολογίου. Κατάλληλο για brands χωρίς e-shop.',
      },
    ],
    [hasEshopConnector]
  );

  const defaultLabel =
    revenuePerfOptions.find((o) => o.id === revenuePerfDefault)?.label ?? revenuePerfDefault;

  // Stock source: default reflects what Product Intelligence currently uses (its resolved authority),
  // falling back to the shared resolver when the aggregate hasn't been built yet.
  const { currentBrand } = useBrand();
  const { aggregate } = useProductIntelligenceAggregateDoc();
  const piKind = aggregate?.sourceKind;
  const stockDefault: StockSourceMode =
    piKind === 'erp'
      ? 'erp'
      : piKind === 'procurement'
        ? 'procurement'
        : piKind === 'connector_catalog'
          ? 'ecommerce'
          : resolveStockSourceMode(undefined, {
              plan: currentBrand?.plan,
              procurementModuleEnabled:
                (currentBrand?.enabledModules as Record<string, unknown> | undefined)?.procurement !== false,
              hasErpConnector: false,
            });

  const stockOptions = useMemo<SourceRoleOption[]>(
    () => [
      {
        id: 'erp',
        label: 'ERP (Megaventory/SoftOne)',
        description:
          'Κατάλογος & απόθεμα από το ERP. Κατάλληλο όταν το ERP είναι η κύρια πηγή αποθέματος.',
      },
      {
        id: 'ecommerce',
        label: 'E-shop πλατφόρμα',
        description:
          'Κατάλογος & απόθεμα από την πλατφόρμα e-shop (Magento/Shopify/WooCommerce/OpenCart).',
        disabled: !hasEshopConnector,
      },
      {
        id: 'procurement',
        label: 'Αρχείο procurement',
        description:
          'Κατάλογος & απόθεμα από το ανεβασμένο αρχείο procurement. Εφαρμόζεται στο επόμενο sync προϊόντων.',
      },
    ],
    [hasEshopConnector]
  );
  const stockDefaultLabel = stockOptions.find((o) => o.id === stockDefault)?.label ?? stockDefault;

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

      <SourceRoleSettingCard
        field="stockSourceMode"
        title="Πηγή αποθέματος & καταλόγου"
        tooltip="Καθορίζει ποια πηγή είναι υπεύθυνη για τον κατάλογο και το απόθεμα στο Product Intelligence (Stock Status / Stock Age). Εφαρμόζεται στο επόμενο sync προϊόντων."
        options={stockOptions}
        defaultId={stockDefault}
        defaultHint={`Προεπιλογή: ${stockDefaultLabel}`}
        invalidateKeys={(brandId) => [['productIntelligenceAggregate', brandId]]}
      />

      <RevenueSourceSettings />
      <SalesChannelRulesEditor />
    </div>
  );
}
