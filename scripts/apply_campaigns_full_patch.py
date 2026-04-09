# UTF-8: merge Purchase/phantom/GA logic into CampaignsPage.tsx (run once; delete after)
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "src/components/campaigns/CampaignsPage.tsx"
t = p.read_text(encoding="utf-8")

if "import { BudgetOpportunitySection }" not in t:
    t = t.replace(
        "import { formatCurrency, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';\nimport type { Campaign } from '../../types';",
        "import { formatCurrency, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';\n"
        "import { BudgetOpportunitySection } from '../roi/BudgetOpportunitySection';\n"
        "import { bucketOverlapFraction } from '../../utils/roiUtils';\n"
        "import type { Campaign } from '../../types';",
        1,
    )

t = re.sub(
    r"\n// Returns true if a dailyMetrics bucket overlaps[\s\S]*?^function sumConversionActions",
    "\nfunction sumConversionActions",
    t,
    count=1,
    flags=re.MULTILINE,
)

HELPERS = r'''

/**
 * PMax / store-visit campaigns: GA may label the action as Purchase with ~1€ per conversion.
 */
function isPhantomStoreVisitPurchaseRow(
  actionName: string,
  row: { conversions?: number; value?: number },
  campaignName?: string
): boolean {
  const conv = row.conversions ?? 0;
  const val = row.value ?? 0;
  const avgPerConv = conv > 0 ? val / conv : val;

  const cn = (campaignName || '').toLowerCase();
  if (
    (/store\s*visits?|shop\s*visits?/i.test(cn) || (/visit/i.test(cn) && /store|shop/i.test(cn))) &&
    avgPerConv >= 0.99 &&
    avgPerConv <= 1.01
  ) {
    return true;
  }

  if (val < 0.99 || val > 1.01) return false;
  const n = actionName.toLowerCase();
  if (/store\s*visits?|shop\s*visits?/i.test(n)) return true;
  if (/visit/i.test(n) && /store|shop/i.test(n)) return true;
  const gEp = '\u03b5\u03c0\u03af\u03c3\u03ba\u03b5\u03c8\u03b7';
  const gEp2 = '\u03b5\u03c0\u03b9\u03c3\u03ba\u03b5\u03c8\u03b7';
  const gKat = '\u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b7\u03bc\u03b1';
  const gKat2 = '\u03ba\u03b1\u03c4\u03b1\u03c3\u03c4\u03b7\u03bc\u03b1';
  if ((n.includes(gEp) || n.includes(gEp2)) && (n.includes(gKat) || n.includes(gKat2))) return true;
  return false;
}

function isGoogleAnalyticsImportLabel(name: string): boolean {
  const n = name.toLowerCase();
  if (/imported?\s+from\s+google\s+analytics/.test(n)) return true;
  if (/from\s+google\s+analytics/.test(n)) return true;
  if (/\bgoogle\s+analytics\s*(\(4\)|4)?\b/.test(n)) return true;
  if (/\bga4\b/.test(n)) return true;
  if (/\bga\s*\(?4\)?\b/.test(n)) return true;
  if (/import.*\b(ga4|google\s+analytics)\b/.test(n)) return true;
  return false;
}

function pickPrimaryGoogleAdsPurchaseKey(
  purchaseKeys: string[],
  ca: Record<string, { conversions: number; value: number }>,
  campaignName: string
): string | null {
  const ok = purchaseKeys.filter(k => {
    const row = ca[k];
    if (!row) return false;
    return !isPhantomStoreVisitPurchaseRow(k, row, campaignName);
  });
  if (ok.length === 0) return null;
  if (ok.length === 1) return ok[0];
  const lower = (s: string) => s.trim().toLowerCase();
  const hasData = (k: string) => (ca[k]?.conversions ?? 0) > 0 || (ca[k]?.value ?? 0) > 0;

  const gaImport = ok.find(k => isGoogleAnalyticsImportLabel(k) && hasData(k));
  if (gaImport) return gaImport;

  const exact = ok.find(k => lower(k) === 'purchase');
  if (exact && hasData(exact)) return exact;

  const paren = ok.find(k => /^purchase\s*\(/i.test(k.trim()) && hasData(k));
  if (paren) return paren;

  const web = ok.find(k => /website|web\s*store|ecommerce|shopify|woocommerce/i.test(k) && hasData(k));
  if (web) return web;

  const byConv = [...ok].sort((a, b) => (ca[b]?.conversions ?? 0) - (ca[a]?.conversions ?? 0));
  return byConv[0] ?? null;
}

function isGoogleAdsLikeChannel(channel: string | undefined): boolean {
  const ch = (channel || '').trim().toLowerCase();
  return ch === 'google ads' || ch === 'google shopping' || /^google\s*ads\b/.test(ch);
}

/**
 * Display conversions / value. When a conversion-action filter is active, `c` is already
 * narrowed by applyConvFilter — do not fall back to sumConversionActions.
 */
function getDisplayConversions(c: Campaign, convFilterActive: boolean): number {
  const raw = c.conversions;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  if (convFilterActive) {
    return Number.isNaN(n) ? 0 : n;
  }
  const fromActions = sumConversionActions(c.conversionActions).conv;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

function getDisplayConversionValue(c: Campaign, convFilterActive: boolean): number {
  const any = c as Campaign & { conversionValue?: number };
  const raw = c.conversion_value ?? any.conversionValue;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  if (convFilterActive) {
    return Number.isNaN(n) ? 0 : n;
  }
  const fromActions = sumConversionActions(c.conversionActions).value;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

function formatConvCount(n: number): string {
  const dec = Math.abs(n % 1) > 1e-6 ? 2 : 0;
  return formatNumber(n, dec);
}
'''

old_block = re.search(
    r"\n/\*\*[\s\S]*?function formatConvCount\(n: number\): string \{[\s\S]*?\n\}\n\ninterface CampaignsPageProps",
    t,
)
if not old_block:
    raise SystemExit("old getDisplay block not found")
t = t[: old_block.start()] + HELPERS + "\ninterface CampaignsPageProps" + t[old_block.end() - len("interface CampaignsPageProps") :]

t = t.replace(
    "  const [convActionFilter, setConvActionFilter] = useState<string[]>(() => {\n"
    "    try { return JSON.parse(localStorage.getItem(LS_CONV) || '[]'); } catch { return []; }\n"
    "  });\n  const [showConvDropdown, setShowConvDropdown] = useState(false);",
    "  const [convActionFilter, setConvActionFilter] = useState<string[]>(() => {\n"
    "    try { return JSON.parse(localStorage.getItem(LS_CONV) || '[]'); } catch { return []; }\n"
    "  });\n  const convFilterActive = convActionFilter.length > 0;\n  const [showConvDropdown, setShowConvDropdown] = useState(false);",
    1,
)

DATE_BLOCK = """  // Compute date-range-aware metrics per campaign
  const campaignsWithDateMetrics = useMemo(() => {
    const useDateFilter = !!(dateFrom || dateTo);
    if (!useDateFilter) return filteredCampaigns;

    const fromDate = dateFrom || '0000-00-00';
    const toDate = dateTo || '9999-99-99';

    return filteredCampaigns.map(c => {
      if (!c.dailyMetrics || Object.keys(c.dailyMetrics).length === 0) return c;
      const metaMonthBuckets = (c.channel || '').toLowerCase() === 'meta';
      let impressions = 0, clicks = 0, conversions = 0, amount_spent = 0, conversion_value = 0;
      const dateConvActions: Record<string, { conversions: number; value: number }> = {};
      const countedConvMonths = new Set<string>();

      for (const [date, m] of Object.entries(c.dailyMetrics)) {
        const frac = bucketOverlapFraction(date, fromDate, toDate, { metaMonthBuckets });
        if (frac <= 0) continue;

        impressions += Math.round((m.impressions || 0) * frac);
        clicks += Math.round((m.clicks || 0) * frac);
        conversions += (m.conversions || 0) * frac;
        amount_spent += (m.amount_spent || 0) * frac;
        conversion_value += (m.conversion_value || 0) * frac;

        const mAny = m as Record<string, any>;
        if (mAny.conversionActions && typeof mAny.conversionActions === 'object') {
          const monthKey = date.slice(0, 7);
          if (!countedConvMonths.has(monthKey)) {
            countedConvMonths.add(monthKey);
            for (const [label, vals] of Object.entries(mAny.conversionActions as Record<string, { conversions: number; value: number }>)) {
              if (!dateConvActions[label]) dateConvActions[label] = { conversions: 0, value: 0 };
              dateConvActions[label].conversions += (vals.conversions || 0) * frac;
              dateConvActions[label].value += (vals.value || 0) * frac;
            }
          }
        }
      }

      const conversionActions = dateConvActions;

      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
      const roas = amount_spent > 0 ? Math.round((conversion_value / amount_spent) * 100) / 100 : 0;
      amount_spent = Math.round(amount_spent * 100) / 100;
      return { ...c, impressions, clicks, conversions, amount_spent, conversion_value, ctr, roas, conversionActions };
    });
  }, [filteredCampaigns, dateFrom, dateTo]);"""

t = re.sub(
    r"  // Compute date-range-aware metrics per campaign\n  const campaignsWithDateMetrics = useMemo\(\(\) => \{[\s\S]*?\}, \[filteredCampaigns, dateFrom, dateTo\]\);",
    DATE_BLOCK,
    t,
    count=1,
)

CONV_BLOCK = r"""  const applyConvFilter = (c: Campaign): Campaign => {
    if (convActionFilter.length === 0) return c;
    const ca = c.conversionActions;
    if (!ca || Object.keys(ca).length === 0) {
      return {
        ...c,
        conversions: 0,
        conversion_value: 0,
        roas: 0,
      };
    }
    let filteredConversions = 0;
    let filteredValue = 0;
    const purchaseSelected = convActionFilter.includes('Purchase');
    const campaignName = c.name || '';

    for (const action of convActionFilter) {
      if (action === 'Purchase') {
        let purchaseKeys = Object.keys(ca).filter(k => k.toLowerCase().includes('purchase'));
        const googleAdsLike = isGoogleAdsLikeChannel(c.channel);
        if (googleAdsLike) {
          const primary = pickPrimaryGoogleAdsPurchaseKey(purchaseKeys, ca, campaignName);
          purchaseKeys = primary ? [primary] : [];
        }
        for (const pk of purchaseKeys) {
          const row = ca[pk];
          if (!row) continue;
          if (isPhantomStoreVisitPurchaseRow(pk, row, campaignName)) continue;
          filteredConversions += row.conversions ?? 0;
          filteredValue += row.value ?? 0;
        }
      } else {
        if (purchaseSelected && action.toLowerCase().includes('purchase')) continue;
        const a = ca[action];
        if (
          a &&
          !(
            action.toLowerCase().includes('purchase') &&
            isPhantomStoreVisitPurchaseRow(action, a, campaignName)
          )
        ) {
          filteredConversions += a.conversions;
          filteredValue += a.value ?? 0;
        }
      }
    }

    const conversion_value = Math.round(filteredValue * 100) / 100;
    const roas = (c.amount_spent || 0) > 0 ? Math.round((conversion_value / (c.amount_spent || 1)) * 100) / 100 : 0;
    return { ...c, conversions: filteredConversions, conversion_value, roas };
  };

  const campaignsWithConvFilter = useMemo(() => {
    if (convActionFilter.length === 0) return campaignsWithDateMetrics;
    return campaignsWithDateMetrics.map(applyConvFilter);
  }, [campaignsWithDateMetrics, convActionFilter]);

  const campaignsInConvView = useMemo(() => {
    if (!convFilterActive) return campaignsWithConvFilter;
    return campaignsWithConvFilter.filter(
      c => getDisplayConversions(c, true) > 0 || getDisplayConversionValue(c, true) > 0
    );
  }, [campaignsWithConvFilter, convFilterActive]);

  const sortedCampaigns = useMemo(() => {
    if (!sortColumn) return campaignsInConvView;
    const sorted = [...campaignsInConvView].sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      switch (sortColumn) {
        case 'name': va = a.name || ''; vb = b.name || ''; break;
        case 'channel': va = a.channel || ''; vb = b.channel || ''; break;
        case 'period': va = a.period || ''; vb = b.period || ''; break;
        case 'status': va = a.status || ''; vb = b.status || ''; break;
        case 'spent': va = a.amount_spent || 0; vb = b.amount_spent || 0; break;
        case 'impressions': va = a.impressions || 0; vb = b.impressions || 0; break;
        case 'clicks': va = a.clicks || 0; vb = b.clicks || 0; break;
        case 'ctr': va = a.ctr || 0; vb = b.ctr || 0; break;
        case 'conversions': va = getDisplayConversions(a, convFilterActive); vb = getDisplayConversions(b, convFilterActive); break;
        case 'conversion_value': va = getDisplayConversionValue(a, convFilterActive); vb = getDisplayConversionValue(b, convFilterActive); break;
        case 'roas': va = a.roas || 0; vb = b.roas || 0; break;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDirection === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return sorted;
  }, [campaignsInConvView, sortColumn, sortDirection, convFilterActive]);"""

t = re.sub(
    r"  const applyConvFilter = \(c: Campaign\): Campaign => \{[\s\S]*?\}, \[campaignsWithDateMetrics, convActionFilter\]\);\n\n  const sortedCampaigns = useMemo\(\(\) => \{[\s\S]*?\}, \[campaignsWithConvFilter, sortColumn, sortDirection\]\);",
    CONV_BLOCK,
    t,
    count=1,
)

SUMMARY = """  const summaryStats = useMemo(() => {
    const list = campaignsInConvView;
    const total = list.length;

    let totalSpent = 0;
    let totalConversions = 0;
    let totalConversionValue = 0;

    for (const c of list) {
      totalSpent += c.amount_spent || 0;
      totalConversions += getDisplayConversions(c, convFilterActive);
      totalConversionValue += getDisplayConversionValue(c, convFilterActive);
    }

    const avgROAS = totalSpent > 0 ? totalConversionValue / totalSpent : 0;

    const byChannel: Record<string, number> = {};
    list.forEach(c => {
      const channel = c.channel || 'Other';
      byChannel[channel] = (byChannel[channel] || 0) + 1;
    });

    return {
      total,
      totalSpent,
      totalConversions,
      totalConversionValue,
      avgROAS,
      byChannel,
    };
  }, [campaignsInConvView, convFilterActive]);"""

t = re.sub(
    r"  // Summary stats derived from the already-filtered pipeline\n  // \(campaignsWithConvFilter has date-filtered \+ conv-action-filtered metrics\)\n  const summaryStats = useMemo\(\(\) => \{[\s\S]*?\}, \[campaignsWithConvFilter\]\);",
    SUMMARY,
    t,
    count=1,
)

EXPORT = """  const handleExportCampaigns = useCallback(() => {
    const list = campaignsInConvView;
    if (list.length === 0) return;
    const headers = ['Name', 'Channel', 'Status', 'Impressions', 'Clicks', 'CTR %', 'Spend', 'Conversions', 'Conv. Value', 'ROAS', 'CPA', 'Start Date', 'End Date'];
    const rows = list.map(c => [
      c.name || '', c.channel || '', c.status || '',
      c.impressions ?? '', c.clicks ?? '',
      c.impressions ? ((c.clicks || 0) / c.impressions * 100).toFixed(2) : '',
      c.amount_spent ?? '', getDisplayConversions(c, convFilterActive), getDisplayConversionValue(c, convFilterActive),
      c.amount_spent ? (getDisplayConversionValue(c, convFilterActive) / c.amount_spent).toFixed(2) : '',
      getDisplayConversions(c, convFilterActive) ? ((c.amount_spent || 0) / getDisplayConversions(c, convFilterActive)).toFixed(2) : '',
      c.start_date || '', c.end_date || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\\n');
    const blob = new Blob(['\\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaigns_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [campaignsInConvView, convFilterActive]);"""

t = re.sub(
    r"  const handleExportCampaigns = useCallback\(\(\) => \{[\s\S]*?\}, \[filteredCampaigns\]\);",
    EXPORT,
    t,
    count=1,
)

# Table: display conversions
t = t.replace(
    "{formatConvCount(getDisplayConversions(campaign))}",
    "{formatConvCount(getDisplayConversions(campaign, convFilterActive))}",
)
t = t.replace(
    "€{formatCurrency(getDisplayConversionValue(campaign), 2)}",
    "€{formatCurrency(getDisplayConversionValue(campaign, convFilterActive), 2)}",
)

# Empty states + export
t = t.replace(
    "{filteredCampaigns.length === 0 ? (",
    "{filteredCampaigns.length === 0 ? (",
)
# replace table condition
t = t.replace(
    "{filteredCampaigns.length === 0 ? (\n          <div className=\"text-center py-12\">\n            <p className=\"text-[#4A4A4A]\">Δεν βρέθηκαν campaigns με τα επιλεγμένα filters.</p>\n          </div>\n        ) : (",
    "{filteredCampaigns.length === 0 ? (\n          <div className=\"text-center py-12\">\n            <p className=\"text-[#4A4A4A]\">Δεν βρέθηκαν campaigns με τα επιλεγμένα filters.</p>\n          </div>\n        ) : convFilterActive && sortedCampaigns.length === 0 ? (\n          <div className=\"text-center py-12\">\n            <p className=\"text-[#4A4A4A]\">Καμία καμπάνια με τις επιλεγμένες ενέργειες μετατροπής για αυτή την περίοδο (π.χ. καμπάνιες μόνο με επισκέψεις καταστήματος δεν εμφανίζονται όταν φιλτράρετε Purchase).</p>\n          </div>\n        ) : (",
    1,
)

t = t.replace(
    "disabled={filteredCampaigns.length === 0}",
    "disabled={campaignsInConvView.length === 0}",
)

# Budget opportunity after summary grid
if "<BudgetOpportunitySection" not in t:
    t = t.replace(
        "      </div>\n\n      {/* Filters */}\n      <Card padding=\"md\">",
        "      </div>\n\n      <BudgetOpportunitySection campaigns={(campaigns ?? []) as Campaign[]} />\n\n      {/* Filters */}\n      <Card padding=\"md\">",
        1,
    )

p.write_text(t, encoding="utf-8", newline="\n")
print("OK", p)
