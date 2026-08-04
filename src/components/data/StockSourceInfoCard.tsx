import { Card, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { useProductIntelligenceAggregateDoc } from '../../hooks/useProductIntelligenceAggregate';
import { resolveStockSourceMode, type StockSourceMode } from '../../utils/stockSource';

/** Read-only statement of the stock/catalog source Product Intelligence actually uses. The source is
 *  resolved automatically (ERP when an ERP connector exists, otherwise the e-shop platform) — there is
 *  no per-brand choice to make here, so this card informs rather than asks. */
const SOURCE_LABELS: Record<StockSourceMode, string> = {
  erp: 'ERP (Megaventory / SoftOne)',
  procurement: 'Αρχείο procurement',
  ecommerce: 'Πλατφόρμα e-shop',
};

export function StockSourceInfoCard() {
  const { currentBrand } = useBrand();
  const { aggregate, isBuilding } = useProductIntelligenceAggregateDoc();

  if (!currentBrand) return null;

  // The aggregate's sourceKind is the source PI used on its last run (the truth). Before the first
  // build, fall back to the capability-based resolver and flag that it applies on the next sync.
  const piKind = aggregate?.sourceKind;
  const resolved: StockSourceMode =
    piKind === 'erp'
      ? 'erp'
      : piKind === 'procurement'
        ? 'procurement'
        : piKind === 'connector_catalog'
          ? 'ecommerce'
          : resolveStockSourceMode(undefined, {
              plan: currentBrand.plan,
              procurementModuleEnabled:
                (currentBrand.enabledModules as Record<string, unknown> | undefined)?.procurement !== false,
              hasErpConnector: false,
            });
  const isLive = Boolean(piKind);

  return (
    <Card padding="lg">
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Πηγή αποθέματος &amp; καταλόγου</h3>
          <Tooltip
            content="Καθορίζει ποια πηγή τροφοδοτεί τον κατάλογο και το απόθεμα στο Product Intelligence (Stock Status / Stock Age). Επιλέγεται αυτόματα και δεν χρειάζεται ρύθμιση."
            size={13}
          />
        </div>
        <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
          Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
        </p>
      </div>

      <div className="flex items-center gap-2 p-3 rounded-lg border border-[var(--nts-border-gray)] bg-white">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[12px] font-semibold text-[var(--nts-accent-text)] bg-[var(--nts-accent)]/10">
          {SOURCE_LABELS[resolved]}
        </span>
        {!isLive && (
          <span className="text-[11px] text-[var(--nts-medium-gray)]">
            {isBuilding ? 'υπολογίζεται…' : 'θα ισχύσει στο επόμενο sync'}
          </span>
        )}
      </div>

      {(() => {
        const labels = aggregate?.stockLocationLabels?.length
          ? aggregate.stockLocationLabels
          : aggregate?.stockLocations ?? [];
        if (!labels.length && !isBuilding) return null;
        return (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {labels.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-semibold text-[#0F766E] bg-[#0F766E]/10">
                Απόθεμα: {labels.join(', ')}
                <Tooltip
                  content="Τα νούμερα αποθέματος (Stock Status, αξία, ημέρες επάρκειας) αφορούν μόνο τις επιλεγμένες αποθήκες. Ρυθμίζεται στις ρυθμίσεις του Megaventory connector."
                  size={12}
                />
              </span>
            )}
            {isBuilding && (
              <span className="text-[11px] text-[var(--nts-medium-gray)]">Ενημέρωση δεδομένων…</span>
            )}
          </div>
        );
      })()}

      <p className="text-[12px] text-[var(--nts-medium-gray)] leading-relaxed mt-3">
        Αντλείται αυτόματα από το ERP όταν υπάρχει· διαφορετικά από την πλατφόρμα e-shop. Οι πωλήσεις
        (ταχύτητα/dead stock) υπολογίζονται από όλα τα κανάλια — φυσικά καταστήματα και e-shop.
      </p>
    </Card>
  );
}
