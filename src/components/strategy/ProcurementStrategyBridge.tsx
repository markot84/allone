/**
 * Συνδέει τις ειδοποιήσεις Product Intelligence (dead / excess από ERP)
 * με τις εμπορικές πολιτικές στη Στρατηγική — ίδια λογική priority_tag με useProductSource.
 */
import { useMemo } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, ExternalLink, Package } from 'lucide-react';
import { scenarios } from '../../data';
import type { Product } from '../../types';

const stockClearanceScenario = scenarios.find((s) => s.id === 'stock_clearance');
const stockClearanceTitle = stockClearanceScenario?.name ?? 'Stock Clearance';

export interface ProcurementStrategyBridgeProps {
  products: Product[];
  /** Enterprise feed από procurement inventory */
  enabled: boolean;
  onDeadToStockClearance: (args: {
    productIds: string[];
    skus: string[];
    tiedCapital: number;
    count: number;
  }) => void;
  onExcessToStockClearance: (args: {
    productIds: string[];
    skus: string[];
    tiedCapital: number;
    count: number;
  }) => void;
  /** Άνοιγμα #products (ίδιο feed) */
  onOpenProductIntelligence?: () => void;
}

function tiedFromProducts(list: Product[]): number {
  return list.reduce((s, p) => s + (p.cost_price ?? 0) * (p.stock_level ?? 0), 0);
}

export function ProcurementStrategyBridge({
  products,
  enabled,
  onDeadToStockClearance,
  onExcessToStockClearance,
  onOpenProductIntelligence,
}: ProcurementStrategyBridgeProps) {
  const { dead, excess } = useMemo(() => {
    const dead = products.filter((p) => p.priority_tag === 'dead');
    const excess = products.filter((p) => p.priority_tag === 'excess');
    return { dead, excess };
  }, [products]);

  const deadMeta = useMemo(() => {
    const skus = dead.map((p) => (p.sku || '').trim()).filter(Boolean);
    const productIds = dead.map((p) => p.id).filter(Boolean);
    return { count: dead.length, skus, productIds, tied: tiedFromProducts(dead) };
  }, [dead]);

  const excessMeta = useMemo(() => {
    const skus = excess.map((p) => (p.sku || '').trim()).filter(Boolean);
    const productIds = excess.map((p) => p.id).filter(Boolean);
    return { count: excess.length, skus, productIds, tied: tiedFromProducts(excess) };
  }, [excess]);

  if (!enabled || products.length === 0) return null;
  if (deadMeta.count === 0 && excessMeta.count === 0) return null;

  const fmtEur = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k€` : `${Math.round(n)}€`;

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-gradient-to-br from-[#FAFAFA] to-white overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-[#E8E8E8] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 p-1.5 rounded-lg bg-[#7C3AED]/10">
            <Package size={16} className="text-[#7C3AED]" aria-hidden />
          </div>
          <p className="min-w-0 text-[11px] text-[#6B7280] leading-snug">
            Ίδια κατάταξη με το Product Intelligence· για επόμενο βήμα χρησιμοποιούνται οι{' '}
            <strong>επίσημοι τίτλοι πολιτικών</strong> του συστήματος (π.χ. {stockClearanceTitle}).
          </p>
        </div>
        {onOpenProductIntelligence && (
          <button
            type="button"
            onClick={onOpenProductIntelligence}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--nts-accent)] hover:underline shrink-0"
          >
            <ExternalLink size={12} aria-hidden />
            Λεπτομέρειες στο Product Intelligence
          </button>
        )}
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {deadMeta.count > 0 && (
          <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle size={18} className="text-[#DC2626] shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#991B1B]">Dead Stock (ERP)</p>
                <p className="text-[11px] text-[#7F1D1D]/90 mt-0.5 leading-snug">
                  {deadMeta.count.toLocaleString('el-GR')} SKU(s) — ίδια λογική με την κάρτα Dead Stock στο Product
                  Intelligence (status / αξιολόγηση / απόθεμα).
                  {deadMeta.tied > 0 && (
                    <span className="block mt-0.5">Εκτιμώμενο κεφάλαιο: ~{fmtEur(deadMeta.tied)}</span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onDeadToStockClearance({
                  count: deadMeta.count,
                  productIds: deadMeta.productIds,
                  skus: deadMeta.skus,
                  tiedCapital: deadMeta.tied,
                })
              }
              className="mt-auto inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-[#DC2626] text-white text-xs font-semibold hover:bg-[#B91C1C] transition-colors"
            >
              {stockClearanceTitle}
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        )}
        {excessMeta.count > 0 && (
          <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-[#D97706] shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#92400E]">Excess Stock (ERP)</p>
                <p className="text-[11px] text-[#78350F]/90 mt-0.5 leading-snug">
                  {excessMeta.count.toLocaleString('el-GR')} SKU(s) — ίδια λογική με την κάρτα Excess Stock στο Product
                  Intelligence.
                  {excessMeta.tied > 0 && (
                    <span className="block mt-0.5">Εκτιμώμενο κεφάλαιο: ~{fmtEur(excessMeta.tied)}</span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onExcessToStockClearance({
                  count: excessMeta.count,
                  productIds: excessMeta.productIds,
                  skus: excessMeta.skus,
                  tiedCapital: excessMeta.tied,
                })
              }
              className="mt-auto inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-[#D97706] text-white text-xs font-semibold hover:bg-[#B45309] transition-colors"
            >
              {stockClearanceTitle}
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
