import { AlertTriangle, Info, X, Zap, ArrowRight } from 'lucide-react';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { AutomationAlertsService } from '../../services/automationSettings';
import type { AutomationAlert } from '../../types';

const SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; border: string }> = {
  critical: { icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  warning: { icon: AlertTriangle, color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A' },
  info: { icon: Info, color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' },
};

const TRIGGER_NAV: Record<string, string> = {
  // Trigger groups → sections
  inventory: 'products',
  campaigns: 'campaigns',
  customers: 'rfm',
  seasonal: 'calendar',
  analytics: 'analytics',
  competitive: 'competitive',
  procurement: 'procurement',
  // Specific trigger IDs for more precise navigation
  dead_stock_alert: 'products',
  excess_stock_alert: 'products',
  low_stock_critical: 'products',
  new_products_imported: 'products',
  stock_growth: 'products',
  campaign_high_roas: 'campaigns',
  campaign_underperform: 'campaigns',
  segment_churn_risk: 'rfm',
  segment_vip_growth: 'rfm',
  high_churn_ltv: 'rfm',
  upsell_opportunity: 'channels',
  engagement_drop: 'rfm',
  demand_declining: 'rfm',
  seasonal_approaching: 'calendar',
  price_above_benchmark: 'competitive',
  competitor_new_ads: 'competitive',
  organic_traffic_spike: 'analytics',
  new_visitors_surge: 'analytics',
  organic_conversion_drop: 'analytics',
  high_bounce_pages: 'analytics',
  procurement_low_coverage: 'procurement',
  procurement_high_surplus: 'procurement',
  procurement_new_brand: 'procurement',
  procurement_pricing_drift: 'procurement',
  procurement_supplier_delay: 'suppliers',
};

function getAlertTarget(alert: AutomationAlert): string {
  return TRIGGER_NAV[alert.triggerId] || TRIGGER_NAV[alert.triggerGroup || ''] || 'automation';
}

interface AlertsBannerProps {
  filterGroup?: string;
  maxAlerts?: number;
  compact?: boolean;
  onNavigate?: (section: string) => void;
}

export function AlertsBanner({ filterGroup, maxAlerts = 3, compact = false, onNavigate }: AlertsBannerProps) {
  const { newAlerts, invalidate } = useAutomationAlerts();

  const filtered = filterGroup
    ? newAlerts.filter(a => a.triggerGroup === filterGroup)
    : newAlerts;

  if (filtered.length === 0) return null;

  const handleDismiss = async (alert: AutomationAlert) => {
    await AutomationAlertsService.dismiss(alert.id);
    invalidate();
  };

  const displayed = filtered.slice(0, maxAlerts);
  const remaining = filtered.length - displayed.length;

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[var(--nts-accent)]" />
          <span className="text-sm font-semibold text-[#111827]">
            Ειδοποιήσεις
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 text-[10px] font-bold rounded-full bg-red-500 text-white px-1">
            {filtered.length}
          </span>
        </div>
      )}
      {displayed.map(alert => {
        const style = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info;
        const Icon = style.icon;
        const target = getAlertTarget(alert);
        return (
          <div
            key={alert.id}
            className="flex items-start gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer hover:shadow-sm"
            style={{ backgroundColor: style.bg, borderColor: style.border }}
            onClick={() => onNavigate?.(target)}
            role="button"
            tabIndex={0}
          >
            <Icon size={16} style={{ color: style.color }} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#111827]">{alert.title}</p>
              {!compact && (
                <p className="text-xs text-[#6B7280] mt-0.5">{alert.description}</p>
              )}
              {!compact && alert.suggestions && alert.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {alert.suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); onNavigate?.(target); }}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-white/80 text-[#374151] border border-[#E5E7EB] hover:bg-white cursor-pointer transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ArrowRight size={14} className="text-[#9CA3AF]" />
              <button
                onClick={(e) => { e.stopPropagation(); handleDismiss(alert); }}
                className="p-1 hover:bg-white/50 rounded transition-colors"
                title="Απόρριψη"
              >
                <X size={14} className="text-[#9CA3AF]" />
              </button>
            </div>
          </div>
        );
      })}
      {remaining > 0 && (
        <button
          onClick={() => onNavigate && onNavigate('automations')}
          className="text-xs text-[var(--nts-accent)] hover:underline font-medium pl-1"
        >
          +{remaining} ακόμα ειδοποιήσεις →
        </button>
      )}
    </div>
  );
}
