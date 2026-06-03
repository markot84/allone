import { useState, useEffect, useCallback, useRef, useMemo, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand } from '../../hooks/useBrand';
import { useAuth } from '../../hooks/useAuth';
import { useBrandMembers } from '../../hooks/useCoordination';
import { useModules } from '../../hooks/useModules';
import { auth, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../../config/firebase';
import { getLastImportMeta, type LastImportMeta } from '../../services/import';
import { coerceToDate } from '../../utils/coerceDate';
import { clearOAuthSession, readOAuthSessionPayload } from '../../utils/oauthSession';
import { FirestoreService } from '../../services/firestore';
import { refreshProductIntelligenceOnServer } from '../../services/productIntelligenceAggregate';
import { Card, Button, Spinner, useToast, PageHeader } from '../common';
import type { ModuleId } from '../../types';
import {
  Link2,
  Unlink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Building2,
  X,
  Eye,
  EyeOff,
  Megaphone,
  BarChart3,
  ShoppingBag,
  Boxes,
  ChevronDown,
  type LucideProps,
} from 'lucide-react';
import { RevenueSourceSettings } from './RevenueSourceSettings';
import { SalesChannelRulesEditor } from './SalesChannelRulesEditor';

interface AdAccount {
  id: string;
  name: string;
}

interface ConnectorState {
  connected: boolean;
  pendingAccountSelection?: boolean;
  /** Firebase uid of the admin who started the last OAuth (must match to use account picker). */
  oauthInitiatedByUid?: string;
  availableAccounts?: AdAccount[];
  connectedAt?: any;
  // Google Ads
  customerId?: string;
  customerName?: string;
  // Search Console
  siteUrl?: string;
  siteName?: string;
  // Meta
  adAccountIds?: string[];
  adAccountNames?: string[];
  expiresAt?: number;
  // Magento / commerce
  shopName?: string;
  shopDomain?: string;
  storeCode?: string;
  storeName?: string;
  // Megaventory
  accountName?: string;
  currency?: string;
  lastSyncAt?: any;
  lastOrdersSyncAt?: any;
  lastProductsSyncAt?: any;
  lastSyncAttemptAt?: any;
  lastSyncStatus?: string;
  lastSyncError?: string;
  productsSyncPageCursor?: string;
  ordersSyncPageCursor?: string;
  lastSyncImported?: number;
  lastSyncOrders?: number;
  lastSyncProducts?: number;
}

type ConnectorId = 'google_ads' | 'meta' | 'tiktok' | 'merchant' | 'ga4' | 'search_console' | 'shopify' | 'woocommerce' | 'opencart' | 'magento' | 'megaventory' | 'softone' | 'epsilon_net' | 'entersoft';

const CONNECTOR_GROUP_ORDER = ['marketing', 'analytics', 'commerce', 'operations'] as const;
type ConnectorGroupId = (typeof CONNECTOR_GROUP_ORDER)[number];

type GroupIcon = ComponentType<LucideProps>;

function newestDate(...values: unknown[]): Date | null {
  let newest: Date | null = null;
  for (const value of values) {
    const d = coerceToDate(value);
    if (d && (!newest || d > newest)) newest = d;
  }
  return newest;
}

const ECOMMERCE_CONNECTOR_IDS = new Set<ConnectorId>(['shopify', 'woocommerce', 'opencart', 'magento']);

function ecommerceSyncHealth(
  state: {
    lastOrdersSyncAt?: unknown;
    lastProductsSyncAt?: unknown;
    productsSyncPageCursor?: unknown;
    ordersSyncPageCursor?: unknown;
    lastSyncStatus?: unknown;
  },
  importMeta?: LastImportMeta | null
): 'full' | 'partial' | 'none' {
  if (state.productsSyncPageCursor || state.ordersSyncPageCursor) return 'partial';
  const ordersAt = coerceToDate(state.lastOrdersSyncAt);
  const productsAt = coerceToDate(state.lastProductsSyncAt);
  if (ordersAt && productsAt) return 'full';
  if (ordersAt || productsAt) return 'partial';
  if (state.lastSyncStatus === 'partial') return 'partial';
  if (importMeta?.status === 'partial') return 'partial';
  if (importMeta?.date) return 'partial';
  return 'none';
}

/** Normalize React Query cache (v1 flat dates vs v2 { dates, meta }). */
function normalizeLastSyncQuery(data: unknown): {
  dates: Record<string, Date>;
  meta: Record<string, LastImportMeta>;
} {
  if (!data || typeof data !== 'object') return { dates: {}, meta: {} };
  const record = data as Record<string, unknown>;
  if (record.dates && typeof record.dates === 'object') {
    return {
      dates: record.dates as Record<string, Date>,
      meta: (record.meta as Record<string, LastImportMeta>) || {},
    };
  }
  const dates: Record<string, Date> = {};
  for (const [key, value] of Object.entries(record)) {
    const d = coerceToDate(value);
    if (d) dates[key] = d;
  }
  return { dates, meta: {} };
}

/** Όλες οι ομάδες: ίδια διακριτική πράσινη παλέτα (χωρίς μπλε/πορτοκαλί ανά section). */
const CONNECTOR_GROUP_VISUAL = {
  blobA: 'bg-emerald-400/14',
  blobB: 'bg-green-300/10',
  blobC: 'bg-emerald-200/12',
  stripe: 'border-emerald-500',
  iconGradient: 'bg-gradient-to-br from-emerald-600 to-green-700',
  iconShadow: 'shadow-lg shadow-emerald-600/15',
  countChip: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/90',
} as const;

const CONNECTOR_GROUP_META: Record<
  ConnectorGroupId,
  {
    title: string;
    Icon: GroupIcon;
    blobA: string;
    blobB: string;
    blobC: string;
    stripe: string;
    iconGradient: string;
    iconShadow: string;
    countChip: string;
  }
> = {
  marketing: {
    title: 'Διαφήμιση & ανάπτυξη',
    Icon: Megaphone,
    ...CONNECTOR_GROUP_VISUAL,
  },
  analytics: {
    title: 'Analytics & organic',
    Icon: BarChart3,
    ...CONNECTOR_GROUP_VISUAL,
  },
  commerce: {
    title: 'E-commerce & κανάλια πωλήσεων',
    Icon: ShoppingBag,
    ...CONNECTOR_GROUP_VISUAL,
  },
  operations: {
    title: 'ERP & λειτουργίες',
    Icon: Boxes,
    ...CONNECTOR_GROUP_VISUAL,
  },
};

function getConnectorGroupDescription(id: ConnectorGroupId, isB2B: boolean): string {
  switch (id) {
    case 'marketing':
      return isB2B
        ? 'Paid media, benchmarks και growth signals για B2B pipeline και demand.'
        : 'Διαφημιστικές πλατφόρμες και εργαλεία ανάπτυξης (ROAS, spend, competitive pricing).';
    case 'analytics':
      return isB2B
        ? 'Μετρήσεις ιστοτόπου και organic visibility για account-based και inbound.'
        : 'GA4, Search Console — sessions, funnels, organic queries & CTR.';
    case 'commerce':
      return isB2B
        ? 'Σύνδεση e-shop / καναλιών πώλησης για κατάλογο, παραγγελίες και απόθεμα.'
        : 'Shopify, WooCommerce, OpenCart, Magento — προϊόντα, παραγγελίες, stock.';
    case 'operations':
      return 'Megaventory, SoftOne, Epsilon Net, Entersoft — ERP & λειτουργικά δεδομένα.';
    default:
      return '';
  }
}

function formatConnectorDate(date: Date): string {
  return date.toLocaleDateString('el-GR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getConnectorIdentityLines(id: ConnectorId, state: ConnectorState): string[] {
  const s = state as ConnectorState & Record<string, any>;

  switch (id) {
    case 'google_ads':
      return s.customerName ? [`${s.customerName} (${s.customerId || 'χωρίς ID'})`] : [];
    case 'meta':
    case 'tiktok':
      return Array.isArray(s.adAccountNames) && s.adAccountNames.length ? [s.adAccountNames.join(', ')] : [];
    case 'merchant':
      return s.merchantName ? [`${s.merchantName} (${s.merchantId || 'χωρίς ID'})`] : [];
    case 'ga4':
      return s.propertyName ? [`${s.propertyName} (${s.propertyId || 'χωρίς ID'})`] : [];
    case 'search_console':
      return s.siteName ? [s.siteName] : [];
    case 'shopify':
      return s.shopName ? [`${s.shopName}${s.shopDomain ? ` (${s.shopDomain})` : ''}`] : [];
    case 'woocommerce':
    case 'opencart':
      return s.shopName ? [s.shopName] : [];
    case 'magento': {
      if (!s.shopName) return [];
      const head = `${s.shopName}${s.storeCode ? ` (${s.storeCode})` : ''}`;
      if (s.syncAllStores)
        return [head, 'Παραγγελίες: όλα τα Magento stores (συγκεντρωτικός τζίρος πολλαπλών fronts)'];
      return [head];
    }
    case 'megaventory':
      return s.accountName || s.currency ? [`${s.accountName || 'Megaventory'}${s.currency ? ` · ${s.currency}` : ''}`] : [];
    case 'softone':
      return s.company ? [`Εταιρεία: ${s.company}`] : [];
    case 'epsilon_net':
      return s.email ? [s.email] : [];
    case 'entersoft':
      return s.userId ? [`User: ${s.userId}`] : [];
    default:
      return [];
  }
}

interface ConnectorConfig {
  id: ConnectorId;
  name: string;
  description: string;
  icon: string;
  color: string;
  syncLabel?: string;
  authType?: 'oauth' | 'credentials';
  readOnlyNotice?: string;
  comingSoon?: boolean;
  moduleId?: ModuleId;
  /** Ομαδοποίηση στη σελίδα συνδέσεων */
  group: ConnectorGroupId;
}

const CONNECTORS: ConnectorConfig[] = [
  {
    id: 'google_ads',
    name: 'Google Ads',
    description: 'Αυτόματη εισαγωγή campaigns, impressions, clicks, ROAS',
    icon: '🔍',
    color: '#4285F4',
    readOnlyNotice: 'Αποκλειστικά ανάγνωση δεδομένων — δεν τροποποιούμε τον λογαριασμό σας',
    moduleId: 'campaigns',
    group: 'marketing',
  },
  {
    id: 'meta',
    name: 'Meta (Facebook / Instagram)',
    description: 'Αυτόματη εισαγωγή campaigns, spend, conversions, ROAS',
    icon: '📘',
    color: '#1877F2',
    readOnlyNotice: 'Αποκλειστικά ανάγνωση δεδομένων — δεν τροποποιούμε τον λογαριασμό σας',
    moduleId: 'campaigns',
    group: 'marketing',
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    description: 'Αυτόματη εισαγωγή campaigns, spend, conversions και revenue metrics',
    icon: '🎵',
    color: '#111111',
    readOnlyNotice: 'Αποκλειστικά ανάγνωση δεδομένων — δεν τροποποιούμε τον λογαριασμό σας',
    moduleId: 'campaigns',
    group: 'marketing',
  },
  {
    id: 'merchant',
    name: 'Google Merchant Center',
    description: 'Price benchmarking — σύγκριση τιμών σας vs αγορά ανά SKU',
    icon: '🛒',
    color: '#0D652D',
    syncLabel: 'benchmarks',
    readOnlyNotice: 'Read-only — αποκλειστικά ανάγνωση αναφορών τιμών',
    moduleId: 'competitive',
    group: 'marketing',
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    description: 'Sessions, users, traffic sources, top pages, bounce rate',
    icon: '📊',
    color: '#E37400',
    syncLabel: 'days',
    readOnlyNotice: 'Read-only — analytics.readonly scope',
    moduleId: 'analytics',
    group: 'analytics',
  },
  {
    id: 'search_console',
    name: 'Google Search Console',
    description: 'Organic queries, clicks, impressions, CTR και average position',
    icon: '🔎',
    color: '#0F9D58',
    syncLabel: 'queries',
    readOnlyNotice: 'Read-only — webmasters.readonly scope',
    moduleId: 'analytics',
    group: 'analytics',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Σύνδεση e-shop — products, orders, customers, inventory',
    icon: '🟢',
    color: '#96BF48',
    syncLabel: 'items',
    moduleId: 'ecommerce',
    group: 'commerce',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Σύνδεση WordPress e-shop — products, orders, customers',
    icon: '🟣',
    color: '#7F54B3',
    syncLabel: 'items',
    authType: 'credentials',
    moduleId: 'ecommerce',
    group: 'commerce',
  },
  {
    id: 'opencart',
    name: 'OpenCart',
    description: 'Σύνδεση OpenCart e-shop — products, orders, customers',
    icon: '🛍️',
    color: '#23AFFE',
    syncLabel: 'items',
    authType: 'credentials',
    moduleId: 'ecommerce',
    group: 'commerce',
  },
  {
    id: 'magento',
    name: 'Magento / Adobe Commerce',
    description: 'Σύνδεση Magento e-shop — products, orders, customers',
    icon: '🔶',
    color: '#F46F25',
    syncLabel: 'items',
    authType: 'credentials',
    moduleId: 'ecommerce',
    group: 'commerce',
  },
  {
    id: 'megaventory',
    name: 'Megaventory ERP',
    description: 'Τιμολόγια, παραγγελίες, αποθέματα, προμηθευτές από το Megaventory',
    icon: '📦',
    color: '#0EA5E9',
    syncLabel: 'records',
    authType: 'credentials',
    moduleId: 'finances',
    group: 'operations',
  },
  {
    id: 'softone',
    name: 'SoftOne (Soft1)',
    description: 'Web Services — πελάτες, είδη, προαιρετικά πωλήσεις/αγορές (ανά εγκατάσταση)',
    icon: '🏛️',
    color: '#2563EB',
    syncLabel: 'records',
    authType: 'credentials',
    moduleId: 'finances',
    group: 'operations',
  },
  {
    id: 'epsilon_net',
    name: 'Epsilon Net (e-Shop API)',
    description: 'Epsilon Smart e-Shop API — είδη & υπόλοιπα (myAccount + smartUrl)',
    icon: '🔷',
    color: '#0369A1',
    syncLabel: 'records',
    authType: 'credentials',
    moduleId: 'finances',
    group: 'operations',
  },
  {
    id: 'entersoft',
    name: 'Entersoft Web API',
    description: 'Σύνδεση Entersoft Web API · προαιρετική Public Query για custom datasets',
    icon: '🧩',
    color: '#7C3AED',
    syncLabel: 'records',
    authType: 'credentials',
    moduleId: 'finances',
    group: 'operations',
  },
];

/** Απευθείας cloudfunctions.net ώστε μεγάλα sync (Megaventory) να μην κόβονται από όριο Hosting ~60s. */
const FUNCTIONS_BASE = FUNCTIONS_BASE_URL.replace(/\/$/, '');
const CONNECTOR_SYNC_URLS = [
  `${FUNCTIONS_BASE}/connectorSync`,
  'https://connectorsync-edvzr6unva-ew.a.run.app',
];

async function connectorRequestHeaders(idToken: string): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
    ...(await getAppCheckHeader()),
  };
}

async function postConnectorSync(
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  let lastNetworkError: unknown = null;
  for (const url of CONNECTOR_SYNC_URLS) {
    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      lastNetworkError = err;
      console.warn(`[ConnectorsPanel] connectorSync network failed via ${url}; trying fallback if available`, err);
    }
  }
  throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Failed to fetch');
}

type ConnectorSyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

type ConnectorSyncJobDoc = {
  id?: string;
  brandId?: string;
  provider?: string;
  status?: ConnectorSyncJobStatus;
  mode?: string;
  error?: string;
  requestedAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  updatedAt?: unknown;
};

function connectorSyncJobId(provider: string, brandId: string): string {
  return `${provider}_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function syncJobLabel(job?: ConnectorSyncJobDoc | null): { label: string; className: string } | null {
  if (!job?.status) return null;
  if (job.status === 'pending') {
    return { label: 'Sync σε αναμονή', className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' };
  }
  if (job.status === 'running') {
    return { label: 'Sync σε εξέλιξη', className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' };
  }
  if (job.status === 'failed') {
    return { label: 'Αποτυχία sync', className: 'bg-red-50 text-red-700 ring-1 ring-red-200' };
  }
  return { label: 'Sync ολοκληρώθηκε', className: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' };
}

// ─── Account Picker Modal ────────────────────────────────────────

function AccountPickerModal({
  accounts,
  brandName,
  provider,
  onConfirm,
  onCancel,
  loading,
}: {
  accounts: AdAccount[];
  brandName: string;
  provider: string;
  onConfirm: (account: AdAccount) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<AdAccount | null>(accounts[0] ?? null);
  const [manualId, setManualId] = useState('');
  const manualMode = accounts.length === 0;

  const isMerchant = provider === 'merchant';
  const isGA4 = provider === 'ga4';
  const isSearchConsole = provider === 'search_console';
  const isTikTok = provider === 'tiktok';
  const modalTitle = isGA4
    ? 'Επιλογή GA4 Property'
    : isSearchConsole
      ? 'Επιλογή Search Console Property'
    : isMerchant
      ? 'Επιλογή Merchant Center Account'
      : 'Επιλογή Διαφημιστικού Λογαριασμού';
  const manualHint = isGA4
    ? 'Εισάγετε το GA4 Property ID σας.'
    : isSearchConsole
      ? 'Εισάγετε το Search Console property URL σας.'
    : isMerchant
      ? 'Εισάγετε το Merchant Center ID σας.'
      : isTikTok
        ? 'Εισάγετε το TikTok Advertiser ID σας.'
        : 'Εισάγετε το ID του διαφημιστικού sub-account, όχι του Manager Account (MCC).';
  const manualHelp = isGA4
    ? 'GA4 → Admin → Property Settings → Property ID'
    : isSearchConsole
      ? 'Search Console → Επιλογή property URL ή sc-domain property'
    : isMerchant
      ? 'Merchant Center → Ρυθμίσεις → Account ID'
      : isTikTok
        ? 'TikTok Ads Manager → Advertiser ID'
        : 'Google Ads → επιλογή sub-account → Ρυθμίσεις → Customer ID';
  const manualPlaceholder = isGA4 ? 'π.χ. 123456789' : isSearchConsole ? 'π.χ. https://www.example.com/' : isMerchant ? 'π.χ. 123456789' : isTikTok ? 'π.χ. 7123456789012345678' : 'π.χ. 123-456-7890';

  const handleConfirm = () => {
    if (manualMode) {
      const id = manualId.trim().replace(/-/g, '');
      if (id) onConfirm({ id, name: `Account ${id}` });
    } else if (selected) {
      onConfirm(selected);
    }
  };

  const S = {
    overlay: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' },
    card: { maxWidth: '420px', width: '100%', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' },
    header: { display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' },
    iconWrap: { flexShrink: 0, width: '40px', height: '40px', borderRadius: '10px', backgroundColor: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    body: { padding: '20px 24px' },
    warning: { display: 'flex', gap: '8px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' },
    input: { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const },
    footer: { display: 'flex', gap: '10px', padding: '0 24px 20px' },
    btnSecondary: { flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: '#374151' },
    btnPrimary: (disabled: boolean) => ({ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: disabled ? '#FCA868' : '#F97316', fontSize: '13px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }),
  };

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.iconWrap}>
            <Building2 size={18} color="#4F46E5" />
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>{modalTitle}</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>για το brand <strong>{brandName}</strong></p>
          </div>
        </div>

        {/* Body */}
        <div style={S.body}>
          {manualMode ? (
            <div>
              <div style={S.warning}>
                <span style={{ fontSize: '14px', color: '#D97706', flexShrink: 0 }}>⚠</span>
                <p style={{ margin: 0, fontSize: '12px', color: '#92400E', lineHeight: '1.5' }}>
                  {manualHint}
                </p>
              </div>
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder={manualPlaceholder}
                style={S.input}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              />
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9CA3AF' }}>
                {manualHelp}
              </p>
            </div>
          ) : (
            <div>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#6B7280' }}>
                Επίλεξε τον λογαριασμό για το brand:
              </p>
              <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {accounts.map((acc) => (
                  <label
                    key={acc.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                      border: `2px solid ${selected?.id === acc.id ? '#6366F1' : '#E5E7EB'}`,
                      backgroundColor: selected?.id === acc.id ? '#EEF2FF' : '#fff',
                    }}
                  >
                    <input type="radio" name="adAccount" value={acc.id} checked={selected?.id === acc.id} onChange={() => setSelected(acc)} style={{ accentColor: '#6366F1', flexShrink: 0 }} />
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#111827' }}>{acc.name}</p>
                      <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF' }}>{acc.id}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button style={S.btnSecondary} onClick={onCancel} type="button">
            Άκυρο
          </button>
          <button
            style={S.btnPrimary((manualMode ? !manualId.trim() : !selected) || loading)}
            onClick={handleConfirm}
            disabled={(manualMode ? !manualId.trim() : !selected) || loading}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Αποθήκευση...' : 'Επιβεβαίωση'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shop Domain Modal (Shopify) ──────────────────────────────────

function ShopDomainModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: (domain: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [domain, setDomain] = useState('');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '420px', width: '100%', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>🟢</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση Shopify</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Εισάγετε το domain του καταστήματός σας</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Shop Domain</label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="mystore.myshopify.com"
            style={{ width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' }}
            onKeyDown={(e) => e.key === 'Enter' && domain.trim() && onConfirm(domain.trim())}
          />
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9CA3AF' }}>
            Μπορείτε να γράψετε μόνο το store name (π.χ. "mystore") ή ολόκληρο το domain.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: '#374151' }}
          >
            Άκυρο
          </button>
          <button
            onClick={() => domain.trim() && onConfirm(domain.trim())}
            disabled={!domain.trim() || loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: !domain.trim() || loading ? '#A7F3D0' : '#10B981', fontSize: '13px', fontWeight: 600, cursor: !domain.trim() || loading ? 'not-allowed' : 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Σύνδεση...' : 'Συνέχεια με OAuth'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WooCommerce Credentials Modal ────────────────────────────────

function WooCredentialsModal({
  brandId,
  onSuccess,
  onCancel,
}: {
  brandId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleConnect = async () => {
    if (!storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim()) return;
    setLoading(true);
    setError('');

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(idToken),
        body: JSON.stringify({
          brandId,
          provider: 'woocommerce',
          storeUrl: storeUrl.trim(),
          consumerKey: consumerKey.trim(),
          consumerSecret: consumerSecret.trim(),
        }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success(`WooCommerce συνδέθηκε: ${result.shopName || storeUrl}`);
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '460px', width: '100%', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>🟣</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση WooCommerce</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>REST API credentials από το WordPress Admin</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>e-shop URL</label>
            <input type="text" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://mystore.com" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Consumer Key</label>
            <input type="text" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder="ck_..." style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Consumer Secret</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showSecret ? 'text' : 'password'}
                value={consumerSecret}
                onChange={(e) => setConsumerSecret(e.target.value)}
                placeholder="cs_..."
                style={{ ...inputStyle, paddingRight: '40px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px' }}
              >
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5' }}>
            WordPress Admin → WooCommerce → Settings → Advanced → REST API → Add Key (Read permissions)
          </p>

          {error && (
            <div style={{ display: 'flex', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <AlertTriangle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: '1px' }} />
              <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: '#374151' }}
          >
            Άκυρο
          </button>
          <button
            onClick={handleConnect}
            disabled={!storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim() || loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: (!storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim() || loading) ? '#C4B5FD' : '#7C3AED', fontSize: '13px', fontWeight: 600, cursor: (!storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim() || loading) ? 'not-allowed' : 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Σύνδεση...' : 'Σύνδεση & Επαλήθευση'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Magento: consolidated revenue (all store views) ─────────────

function MagentoConsolidatedRevenueToggle({
  brandId,
  syncAllStores,
  canManage,
  onSaved,
}: {
  brandId: string;
  syncAllStores: boolean;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const persist = async (next: boolean) => {
    if (!canManage || busy || next === syncAllStores) return;
    setBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'magento',
          magentoSettingsOnly: true,
          syncAllStores: next,
        }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) throw new Error(j.error || 'Αποτυχία αποθήκευσης');
      toast.success(
        next
          ? 'Ενεργοποιήθηκε συγκεντρωτική μέτρηση για όλα τα Magento store views · ενημερώθηκε η σύνοψη e-shop.'
          : 'Επανήλθε η μέτρηση μόνο για το store view της σύνδεσης · ενημερώθηκε η σύνοψη e-shop. Τρέξτε Sync αν χρειάζονται νέες παραγγελίες.'
      );
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Σφάλμα');
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-emerald-200 bg-white p-3 text-xs leading-relaxed text-[#374151]">
      <input
        type="checkbox"
        checked={syncAllStores}
        disabled={!canManage || busy}
        onChange={(e) => void persist(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="font-semibold text-[#1A1A1A] block mb-1">Όλα τα Magento store views (συγκεντρωτικά KPIs)</span>
        Όταν ένα Magento installation έχει πολλαπλά storefronts / store views, η ενεργοποίηση ενοποιεί τις παραγγελίες όλων των views στα αθροίσματα εσόδων — χρήσιμο για πολλές αγορές ή ξεχωριστά e-shops που μοιράζονται το ίδιο backend.
        <span className="block mt-1 text-[#6B7280]">
          Αν είναι off, τα KPIs βασίζονται μόνο στο store view που αντιστοιχεί στο store code της σύνδεσης. Για εξαίρεση συγκεκριμένου eshop (hostname) ενώ το συγκεντρωτικό είναι on, ορίστε κανόνα στο μπλοκ <strong>Sales Channel Rules</strong> → πεδίο <strong>Domain eshop (hostname)</strong> μετά από Magento sync.
        </span>
      </span>
    </label>
  );
}

// ─── Magento Credentials Modal ─────────────────────────────────────

function MagentoCredentialsModal({
  brandId,
  onSuccess,
  onCancel,
}: {
  brandId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [storeUrl, setStoreUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncAllStores, setSyncAllStores] = useState(false);
  const [storeCandidates, setStoreCandidates] = useState<
    { id?: number; code: string; storeName: string; baseUrl: string }[]
  >([]);
  const toast = useToast();

  const handleConnect = async () => {
    if (!storeUrl.trim() || !accessToken.trim()) return;
    setLoading(true);
    setError('');
    setStoreCandidates([]);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'magento',
          storeUrl: storeUrl.trim(),
          accessToken: accessToken.trim(),
          storeCode: storeCode.trim() || undefined,
          syncAllStores,
        }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success(`Magento συνδέθηκε: ${result.shopName || storeUrl}`);
        if (result.warning) toast.info(result.warning);
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
        if (Array.isArray(result.storeCandidates)) {
          setStoreCandidates(result.storeCandidates);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };
  const isValid = storeUrl.trim() && accessToken.trim();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '460px', width: '100%', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>🔶</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση Magento</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Integration Access Token από το Magento Admin</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>e-shop URL</label>
            <input type="text" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://mymagentostore.com" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Access Token</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Integration access token"
                style={{ ...inputStyle, paddingRight: '40px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px' }}
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3 text-xs leading-relaxed text-[#374151]">
            <input
              type="checkbox"
              checked={syncAllStores}
              onChange={(e) => setSyncAllStores(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-[#111827]">Να συμπεριληφθούν όλα τα Magento store views στον τζίρο</span>
              <span className="block text-[#6B7280] mt-1">
                Για πολλαπλά storefronts στο ίδιο installation (διαφορετικές αγορές, γλώσσες ή ξεχωριστά e-shops): ενοποιεί τις παραγγελίες σε ένα κοινό σύνολο KPIs αντί να μετρά μόνο το store view της σύνδεσης.
              </span>
            </span>
          </label>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Store Code (προαιρετικό)</label>
            <input
              type="text"
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              placeholder="π.χ. base, default, b2b"
              style={inputStyle}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#9CA3AF', lineHeight: '1.45' }}>
              Αν το Magento installation έχει πολλά store views, βάλε εδώ το σωστό code. Αν μείνει κενό,
              το σύστημα προσπαθεί πρώτα να βρει το σωστό store από το URL του e-shop.
            </p>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5' }}>
            <strong style={{ color: '#6B7280' }}>Magento:</strong> αν εμφανίζεται «Integration not secure», συνήθως τα πεδία{' '}
            <strong>Callback URL</strong> / <strong>Identity Link URL</strong> είναι κενά — το Magento 2.4 το θεωρεί «μη ασφαλές».
            Συμπληρώστε και τα δύο με το <strong>HTTPS base URL του e-shop</strong> (π.χ. https://www.toshop.gr/) και Save.
            Το Performance+ χρησιμοποιεί μόνο το <strong>Access Token</strong> (Bearer) — όχι OAuth redirect. Μετά: Activate → αντιγράψτε το Access Token από τα 4 keys.
            Permissions: Sales, Catalog, Stores και Performance+ Search Terms αν έχει εγκατασταθεί το Magento module.
          </p>

          {error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <AlertTriangle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: '1px' }} />
                <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
              </div>
              {storeCandidates.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '24px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: '#7F1D1D' }}>
                    Διαθέσιμα stores — κάνε κλικ για να επιλέξεις store_code και ξανα-σύνδεση:
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {storeCandidates.map((c) => (
                      <button
                        key={`${c.id ?? ''}-${c.code}`}
                        type="button"
                        onClick={() => { setStoreCode(c.code); setError(''); }}
                        title={c.baseUrl}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '999px',
                          border: '1px solid #FCA5A5',
                          background: storeCode === c.code ? '#DC2626' : '#FFF',
                          color: storeCode === c.code ? '#FFF' : '#991B1B',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {c.code}
                        {typeof c.id === 'number' && Number.isFinite(c.id) ? ` (#${c.id})` : ''}
                        {c.storeName ? ` · ${c.storeName}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: '#374151' }}
          >
            Άκυρο
          </button>
          <button
            onClick={handleConnect}
            disabled={!isValid || loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: (!isValid || loading) ? '#FDBA74' : '#F97316', fontSize: '13px', fontWeight: 600, cursor: (!isValid || loading) ? 'not-allowed' : 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Σύνδεση...' : 'Σύνδεση & Επαλήθευση'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Megaventory Credentials Modal ─────────────────────────────────

function MegaventoryCredentialsModal({
  brandId,
  onSuccess,
  onCancel,
  initialCustomReportId,
  initialCustomReportEnabled,
}: {
  brandId: string;
  onSuccess: () => void;
  onCancel: () => void;
  initialCustomReportId?: string | null;
  initialCustomReportEnabled?: boolean | null;
}) {
  const [apiKey, setApiKey] = useState('');
  const [customReportId, setCustomReportId] = useState(
    initialCustomReportId != null && String(initialCustomReportId).trim()
      ? String(initialCustomReportId).trim()
      : '4919'
  );
  const [customReportEnabled, setCustomReportEnabled] = useState<boolean>(
    initialCustomReportEnabled === undefined || initialCustomReportEnabled === null ? true : Boolean(initialCustomReportEnabled)
  );
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError('');

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'megaventory',
          apiKey: apiKey.trim(),
          customReportId: customReportId.trim(),
          customReportEnabled,
        }),
      });

      const result = await res.json();
      if (res.ok && result.success !== false && !result.error) {
        toast.success(`Megaventory συνδέθηκε${result.accountName ? `: ${result.accountName}` : ''}`);
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };
  const isValid = apiKey.trim().length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '460px', width: '100%', maxHeight: '90vh', overflow: 'auto', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>📦</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση Megaventory</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>API key από Megaventory → My Profile</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>API Key</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="π.χ. 8b5f6c... (32+ χαρακτήρες)"
                style={{ ...inputStyle, paddingRight: '40px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px' }}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
              Custom Report ID <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(Performance+)</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={customReportId}
              onChange={(e) => setCustomReportId(e.target.value)}
              placeholder="π.χ. 4919"
              style={inputStyle}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={customReportEnabled}
                onChange={(e) => setCustomReportEnabled(e.target.checked)}
              />
              Σύγχρονη λήψη custom report στο sync (ανά brand)
            </label>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5' }}>
            <strong style={{ color: '#6B7280' }}>Πού θα το βρεις:</strong> Megaventory → επάνω δεξιά (avatar) → <strong>My Profile</strong> →
            καρτέλα <strong>API Access</strong> → Generate / Copy <strong>API key</strong>.
            Χρειάζονται δικαιώματα ανάγνωσης σε Sales, Purchases, Documents, Products, Inventory & Suppliers.
          </p>

          {error && (
            <div style={{ display: 'flex', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <AlertTriangle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: '1px' }} />
              <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: '#374151' }}
          >
            Άκυρο
          </button>
          <button
            onClick={handleConnect}
            disabled={!isValid || loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: (!isValid || loading) ? '#7DD3FC' : '#0EA5E9', fontSize: '13px', fontWeight: 600, cursor: (!isValid || loading) ? 'not-allowed' : 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Σύνδεση...' : 'Σύνδεση & Επαλήθευση'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SoftOneCredentialsModal({
  brandId,
  onSuccess,
  onCancel,
}: {
  brandId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [serviceUrl, setServiceUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [appId, setAppId] = useState('');
  const [company, setCompany] = useState('');
  const [branch, setBranch] = useState('');
  const [module, setModule] = useState('');
  const [refId, setRefId] = useState('');
  const [syncSalesDocs, setSyncSalesDocs] = useState(false);
  const [syncPurchaseDocs, setSyncPurchaseDocs] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };

  const handleConnect = async () => {
    if (!serviceUrl.trim() || !username.trim() || !password || !appId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'softone',
          serviceUrl: serviceUrl.trim(),
          username: username.trim(),
          password,
          appId: appId.trim(),
          company: company.trim() || undefined,
          branch: branch.trim() || undefined,
          module: module.trim() || undefined,
          refId: refId.trim() || undefined,
          syncSalesDocs,
          syncPurchaseDocs,
        }),
      });
      const result = await res.json();
      if (res.ok && result.success !== false && !result.error) {
        toast.success(`SoftOne συνδέθηκε${result.company ? `: ${result.company}` : ''}`);
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '480px', width: '100%', maxHeight: '90vh', overflow: 'auto', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση SoftOne</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Web Services URL (…/s1services) — βλ. softone.gr/ws</p>
          </div>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Service URL</label>
            <input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://xxx.oncloud.gr/s1services" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Username / AppId</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Χρήστης Web Service" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, paddingRight: '40px' }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>AppId</label>
            <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="π.χ. 2001" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>COMPANY (προαιρ.)</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>BRANCH (προαιρ.)</label>
              <input value={branch} onChange={(e) => setBranch(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>MODULE (προαιρ.)</label>
              <input value={module} onChange={(e) => setModule(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>REFID (προαιρ.)</label>
              <input value={refId} onChange={(e) => setRefId(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={syncSalesDocs} onChange={(e) => setSyncSalesDocs(e.target.checked)} />
            Συγχρονισμός SALDOC (τελευταία 90 ημέρες) — απαιτεί ανάλογα δικαιώματα
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={syncPurchaseDocs} onChange={(e) => setSyncPurchaseDocs(e.target.checked)} />
            Συγχρονισμός PURDOC (τελευταία 90 ημέρες)
          </label>
          {error && (
            <div style={{ display: 'flex', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
              <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button type="button" onClick={onCancel} disabled={loading} style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>
            Άκυρο
          </button>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={loading || !serviceUrl.trim() || !username.trim() || !password || !appId.trim()}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#2563EB', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            {loading ? '...' : 'Σύνδεση'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EpsilonNetCredentialsModal({ brandId, onSuccess, onCancel }: { brandId: string; onSuccess: () => void; onCancel: () => void }) {
  const [subscriptionKey, setSubscriptionKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };

  const handleConnect = async () => {
    if (!subscriptionKey.trim() || !email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'epsilon_net',
          subscriptionKey: subscriptionKey.trim(),
          email: email.trim(),
          password,
        }),
      });
      const result = await res.json();
      if (res.ok && result.success !== false && !result.error) {
        toast.success(`Epsilon Net συνδέθηκε${result.smartHost ? ` (${result.smartHost})` : ''}`);
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '460px', width: '100%', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Epsilon Net e-Shop API</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Κλειδί συνδρομής + διαπιστευτήρια (myaccount.epsilonnet.gr)</p>
          </div>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Subscription key</label>
            <input value={subscriptionKey} onChange={(e) => setSubscriptionKey(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Email (χρήστης Smart)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, paddingRight: '40px' }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && (
            <div style={{ display: 'flex', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
              <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button type="button" onClick={onCancel} disabled={loading} style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px' }}>
            Άκυρο
          </button>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={loading || !subscriptionKey.trim() || !email.trim() || !password}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#0369A1', color: '#fff', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            Σύνδεση
          </button>
        </div>
      </div>
    </div>
  );
}

function EntersoftCredentialsModal({ brandId, onSuccess, onCancel }: { brandId: string; onSuccess: () => void; onCancel: () => void }) {
  const [webApiBaseUrl, setWebApiBaseUrl] = useState('');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState('-');
  const [langId, setLangId] = useState('el-GR');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [subscriptionPassword, setSubscriptionPassword] = useState('');
  const [bridgeId, setBridgeId] = useState('');
  const [publicQueryGroupId, setPublicQueryGroupId] = useState('');
  const [publicQueryFilterId, setPublicQueryFilterId] = useState('');
  const [publicQueryMethod, setPublicQueryMethod] = useState<'GET' | 'POST'>('GET');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };

  const handleConnect = async () => {
    if (!webApiBaseUrl.trim() || !userId.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'entersoft',
          webApiBaseUrl: webApiBaseUrl.trim(),
          userId: userId.trim(),
          password,
          branchId: branchId.trim() || undefined,
          langId: langId.trim() || undefined,
          subscriptionId: subscriptionId.trim() || undefined,
          subscriptionPassword: subscriptionPassword || undefined,
          bridgeId: bridgeId.trim() || undefined,
          publicQueryGroupId: publicQueryGroupId.trim() || undefined,
          publicQueryFilterId: publicQueryFilterId.trim() || undefined,
          publicQueryMethod,
        }),
      });
      const result = await res.json();
      if (res.ok && result.success !== false && !result.error) {
        toast.success('Entersoft συνδέθηκε');
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '480px', width: '100%', maxHeight: '90vh', overflow: 'auto', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Entersoft Web API</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Βάση URL (με / στο τέλος) · api/Login/Login</p>
          </div>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>Web API base URL</label>
            <input value={webApiBaseUrl} onChange={(e) => setWebApiBaseUrl(e.target.value)} placeholder="https://host/EntersoftWEBAPI/" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>UserID</label>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, paddingRight: '40px' }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>BranchID</label>
              <input value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>LangID</label>
              <input value={langId} onChange={(e) => setLangId(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>SubscriptionID (προαιρ.)</label>
            <input value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>Subscription password (προαιρ.)</label>
            <input value={subscriptionPassword} onChange={(e) => setSubscriptionPassword(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>BridgeID (προαιρ.)</label>
            <input value={bridgeId} onChange={(e) => setBridgeId(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>Public Query — Group ID</label>
            <input value={publicQueryGroupId} onChange={(e) => setPublicQueryGroupId(e.target.value)} placeholder="Για sync εγγραφών (προαιρ.)" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>Public Query — Filter ID</label>
            <input value={publicQueryFilterId} onChange={(e) => setPublicQueryFilterId(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500 }}>Μέθοδος PQ</label>
            <select value={publicQueryMethod} onChange={(e) => setPublicQueryMethod(e.target.value as 'GET' | 'POST')} style={inputStyle}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </div>
          {error && (
            <div style={{ display: 'flex', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
              <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button type="button" onClick={onCancel} disabled={loading} style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff' }}>
            Άκυρο
          </button>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={loading || !webApiBaseUrl.trim() || !userId.trim() || !password}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#7C3AED', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            Σύνδεση
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ρυθμίσεις saved custom report χωρίς επανείσοδο API key · γράφει στο connectors doc. */
function MegaventoryCustomReportSettingsInline({
  brandId,
  initialReportId,
  initialEnabled,
  canManage,
  onSaved,
}: {
  brandId: string;
  initialReportId: string;
  initialEnabled: boolean;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [reportId, setReportId] = useState(initialReportId);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setReportId(initialReportId);
    setEnabled(initialEnabled);
  }, [initialReportId, initialEnabled]);

  const handleSaveSettings = async () => {
    if (!canManage || saving) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: 'megaventory',
          megaventorySettingsOnly: true,
          customReportId: reportId.trim(),
          customReportEnabled: enabled,
        }),
      });

      const result = await res.json();
      if (res.ok && !result.error) {
        toast.success('Οι ρυθμίσεις custom report αποθηκεύτηκαν.');
        onSaved();
      } else {
        toast.error(result.error || 'Αποτυχία αποθήκευσης');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Αποτυχία');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3 shadow-sm">
      <p className="mb-2 text-sm font-semibold text-[#111827]">Custom report (Performance+)</p>
      <p className="mb-1 text-xs text-[#6B7280]">Τα δεδομένα του αποθηκευμένου report στο Megaventory συγχρονίζονται στο Firestore ανά brand.</p>
      <label htmlFor={`mv-cr-id-${brandId}`} className="mb-1 block text-xs font-medium text-[#374151]">
        Report ID
      </label>
      <input
        id={`mv-cr-id-${brandId}`}
        type="text"
        inputMode="numeric"
        value={reportId}
        onChange={(e) => setReportId(e.target.value)}
        disabled={!canManage || saving}
        placeholder="4919"
        className="mb-3 max-w-[220px] rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm text-[#111827] shadow-sm disabled:opacity-50"
      />
      <label className="mb-3 flex cursor-pointer items-start gap-3 text-sm leading-snug text-[#374151]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={!canManage || saving}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-2 border-[#D1D5DB] text-[var(--nts-accent,#f97316)] accent-[var(--nts-accent,#f97316)] disabled:opacity-50"
        />
        <span>Να συμπεριλαμβάνεται το custom report στο Sync (χειροκίνητο / νυχτερινό)</span>
      </label>
      <button
        type="button"
        onClick={() => void handleSaveSettings()}
        disabled={!canManage || saving}
        className="rounded-md bg-[#0EA5E9] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0284C7] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
      >
        {saving ? 'Αποθήκευση...' : 'Αποθήκευση ρυθμίσεων'}
      </button>
    </div>
  );
}

// ─── OpenCart Credentials Modal ────────────────────────────────────

function OpenCartCredentialsModal({
  brandId,
  onSuccess,
  onCancel,
}: {
  brandId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [storeUrl, setStoreUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleConnect = async () => {
    if (!storeUrl.trim() || !clientId.trim() || !clientSecret.trim() || !token.trim() || !username.trim() || !password.trim()) return;
    setLoading(true);
    setError('');

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: await connectorRequestHeaders(idToken),
        body: JSON.stringify({
          brandId,
          provider: 'opencart',
          storeUrl: storeUrl.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          token: token.trim(),
          username: username.trim(),
          password: password.trim(),
        }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success(`OpenCart συνδέθηκε: ${result.shopName || storeUrl}`);
        onSuccess();
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '10px 12px', fontSize: '14px', backgroundColor: '#F9FAFB', outline: 'none', boxSizing: 'border-box' as const };
  const isValid = storeUrl.trim() && clientId.trim() && clientSecret.trim() && token.trim() && username.trim() && password.trim();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '520px', width: '100%', maxHeight: 'calc(100vh - 32px)', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>🛍️</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση OpenCart</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>OAuth credentials από το OpenCart REST Admin API</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>e-shop URL</label>
            <input type="text" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://myopencartstore.com" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Client ID</label>
            <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth client_id" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Client Secret</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showSecrets ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="OAuth client_secret"
                style={{ ...inputStyle, paddingRight: '40px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                type="button"
                onClick={() => setShowSecrets(!showSecrets)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px' }}
              >
                {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Token</label>
            <input
              type={showSecrets ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer/access token από το REST API extension"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Admin/API username" style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Password</label>
              <input
                type={showSecrets ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                style={inputStyle}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5' }}>
            Χρησιμοποίησε τα OAuth στοιχεία από το OpenCart REST Admin API extension. Το token αποθηκεύεται κρυπτογραφημένο και στέλνεται ως Bearer token στα REST endpoints.
          </p>

          {error && (
            <div style={{ display: 'flex', gap: '8px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px' }}>
              <AlertTriangle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: '1px' }} />
              <p style={{ margin: 0, fontSize: '12px', color: '#991B1B' }}>{error}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '0 24px 20px' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', backgroundColor: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: '#374151' }}
          >
            Άκυρο
          </button>
          <button
            onClick={handleConnect}
            disabled={!isValid || loading}
            style={{ flex: 1, padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: (!isValid || loading) ? '#7DD3FC' : '#0EA5E9', fontSize: '13px', fontWeight: 600, cursor: (!isValid || loading) ? 'not-allowed' : 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Σύνδεση...' : 'Σύνδεση & Επαλήθευση'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function ConnectorsPanel() {
  const { currentBrand } = useBrand();
  const { isB2B, enabledModules } = useModules();
  const { user, isSuperAdmin } = useAuth();
  const { members } = useBrandMembers();
  const queryClient = useQueryClient();
  const brandId = currentBrand?.id ?? null;
  const brandName = currentBrand?.name ?? 'Brand';
  const toast = useToast();
  const connectorGroups = useMemo(() => {
    const visible = CONNECTORS.filter((connector) => !connector.moduleId || enabledModules[connector.moduleId]);
    return CONNECTOR_GROUP_ORDER.map((id) => ({
      id,
      meta: CONNECTOR_GROUP_META[id],
      description: getConnectorGroupDescription(id, isB2B),
      connectors: visible.filter((c) => c.group === id),
    })).filter((g) => g.connectors.length > 0);
  }, [enabledModules, isB2B]);

  const myRole = members.find((m) => m.userId === user?.uid)?.role ?? 'member';
  const canManageConnectors =
    Boolean(isSuperAdmin) ||
    (Boolean(user?.uid && currentBrand?.createdBy === user.uid)) ||
    myRole === 'owner' ||
    myRole === 'admin';

  const [syncingProviders, setSyncingProviders] = useState<Set<ConnectorConfig['id']>>(new Set());
  /** Τελευταία χειροκίνητη προσπάθεια sync ανά connector (ξεχωριστά από import_jobs). */
  const [syncAttempts, setSyncAttempts] = useState<
    Partial<Record<ConnectorId, { at: Date; success: boolean; error?: string }>>
  >({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  /** Prevents auto-reopen while Firestore still has pendingAccountSelection (user closed modal). */
  const dismissedAccountPickerRef = useRef<Set<string>>(new Set());
  const [confirmingAccount, setConfirmingAccount] = useState(false);
  const [shopDomainModal, setShopDomainModal] = useState(false);
  const [wooModal, setWooModal] = useState(false);
  const [opencartModal, setOpencartModal] = useState(false);
  const [magentoModal, setMagentoModal] = useState(false);
  const [megaventoryModal, setMegaventoryModal] = useState(false);
  const [softoneModal, setSoftoneModal] = useState(false);
  const [epsilonNetModal, setEpsilonNetModal] = useState(false);
  const [entersoftModal, setEntersoftModal] = useState(false);
  const [expandedConnectorDetails, setExpandedConnectorDetails] = useState<Partial<Record<ConnectorId, boolean>>>({});
  const handledMegaventoryJobRef = useRef<string | null>(null);
  const previousMegaventoryJobStatusRef = useRef<ConnectorSyncJobStatus | null>(null);
  const handledOpenCartJobRef = useRef<string | null>(null);
  const previousOpenCartJobStatusRef = useRef<ConnectorSyncJobStatus | null>(null);
  const opencartAutoResumeRef = useRef<string | null>(null);

  const emptyStates: Record<string, ConnectorState> = {
    google_ads: { connected: false },
    meta: { connected: false },
    tiktok: { connected: false },
    merchant: { connected: false },
    ga4: { connected: false },
    search_console: { connected: false },
    shopify: { connected: false },
    woocommerce: { connected: false },
    opencart: { connected: false },
    magento: { connected: false },
    megaventory: { connected: false },
    softone: { connected: false },
    epsilon_net: { connected: false },
    entersoft: { connected: false },
  };

  // Connectors doc — cached, refetch only after sync/connect/disconnect
  const { data: connectorsData, isPending: loading, isError: connectorsLoadError, refetch: refetchConnectors } = useQuery({
    // Include Firebase uid so switching app users never shows another user's cached connector doc (same brand).
    queryKey: ['connectorsPanel', brandId, user?.uid ?? ''],
    queryFn: async () => {
      if (!brandId) return null;
      const doc = await FirestoreService.getDocumentWithTimeout<Record<string, any>>('connectors', brandId, 25000);
      return doc;
    },
    enabled: !!brandId && !!user?.uid,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
    retryDelay: 3000,
  });

  const states: Record<string, ConnectorState> = connectorsData
    ? {
        google_ads: connectorsData.google_ads || { connected: false },
        meta: connectorsData.meta || { connected: false },
        tiktok: connectorsData.tiktok || { connected: false },
        merchant: connectorsData.merchant || { connected: false },
        ga4: connectorsData.ga4 || { connected: false },
        search_console: connectorsData.search_console || { connected: false },
        shopify: connectorsData.shopify || { connected: false },
        woocommerce: connectorsData.woocommerce || { connected: false },
        opencart: connectorsData.opencart || { connected: false },
        magento: connectorsData.magento || { connected: false },
        megaventory: connectorsData.megaventory || { connected: false },
        softone: connectorsData.softone || { connected: false },
        epsilon_net: connectorsData.epsilon_net || { connected: false },
        entersoft: connectorsData.entersoft || { connected: false },
      }
    : emptyStates;

  const opencartState = states.opencart || { connected: false };
  const opencartBackfillNeedsResume =
    opencartState.connected &&
    (Boolean(opencartState.productsSyncPageCursor || opencartState.ordersSyncPageCursor) ||
      opencartState.lastSyncStatus === 'partial' ||
      (typeof opencartState.lastSyncError === 'string' &&
        (opencartState.lastSyncError.includes('page cap') ||
          opencartState.lastSyncError.includes('sync incomplete'))));

  // Last sync dates — secondary, loaded once, cached
  const { data: lastSyncQueryRaw } = useQuery({
    queryKey: ['lastSyncDates', brandId, 'v2'],
    queryFn: async () => {
      if (!brandId) return { dates: {} as Record<string, Date>, meta: {} as Record<string, LastImportMeta> };
      const metaBySource = await getLastImportMeta(brandId);
      const pick = (sourceKey: string, connectorKey: ConnectorId) => {
        const m = metaBySource[sourceKey];
        return {
          date: m?.date,
          meta: m,
          connectorKey,
        };
      };
      const rows = [
        pick('google_ads_api', 'google_ads'),
        pick('meta_api', 'meta'),
        pick('tiktok_api', 'tiktok'),
        pick('merchant_center_api', 'merchant'),
        pick('price_benchmarks', 'merchant'),
        pick('ga4_api', 'ga4'),
        pick('ga4', 'ga4'),
        pick('search_console_api', 'search_console'),
        pick('shopify_api', 'shopify'),
        pick('woocommerce_api', 'woocommerce'),
        pick('opencart_api', 'opencart'),
        pick('magento_api', 'magento'),
        pick('megaventory_api', 'megaventory'),
        pick('softone_api', 'softone'),
        pick('epsilon_net_eshop_api', 'epsilon_net'),
        pick('entersoft_web_api', 'entersoft'),
      ];
      const dates: Record<string, Date> = {};
      const meta: Record<string, LastImportMeta> = {};
      for (const row of rows) {
        if (!row.date) continue;
        const prev = dates[row.connectorKey];
        if (!prev || row.date > prev) dates[row.connectorKey] = row.date;
        const prevMeta = meta[row.connectorKey];
        if (!prevMeta || row.date > prevMeta.date) {
          if (row.meta) meta[row.connectorKey] = row.meta;
        }
      }
      return { dates, meta };
    },
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    // Ανανέωση όταν ανοίγει η σελίδα: μετά από βραδινό auto-sync ο χρήστης πρέπει να βλέπει το
    // φρέσκο timestamp, όχι το persisted cache της προηγούμενης μέρας.
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });
  const { dates: lastSyncDates, meta: lastImportMeta } = normalizeLastSyncQuery(lastSyncQueryRaw);

  const { data: megaventorySyncJob } = useQuery({
    queryKey: ['connectorSyncJob', brandId, 'megaventory'],
    queryFn: async () => {
      if (!brandId) return null;
      return FirestoreService.getDocument<ConnectorSyncJobDoc>(
        'connector_sync_jobs',
        connectorSyncJobId('megaventory', brandId),
      );
    },
    enabled: !!brandId && !!user?.uid,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });

  const { data: opencartSyncJob } = useQuery({
    queryKey: ['connectorSyncJob', brandId, 'opencart'],
    queryFn: async () => {
      if (!brandId) return null;
      return FirestoreService.getDocument<ConnectorSyncJobDoc>(
        'connector_sync_jobs',
        connectorSyncJobId('opencart', brandId),
      );
    },
    enabled: !!brandId && !!user?.uid,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });

  useEffect(() => {
    handledMegaventoryJobRef.current = null;
    previousMegaventoryJobStatusRef.current = null;
    handledOpenCartJobRef.current = null;
    previousOpenCartJobStatusRef.current = null;
  }, [brandId]);

  const refreshCommerceRfmProductCaches = useCallback(() => {
    if (!brandId) return;
    queryClient.removeQueries({ queryKey: ['brandSyncVersion', brandId] });
    queryClient.removeQueries({ queryKey: ['ecommerce_summary', brandId] });
    queryClient.removeQueries({ queryKey: ['business_revenue_summary', brandId] });
    queryClient.removeQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
    queryClient.removeQueries({ queryKey: ['dataAnalysisOrdersRaw', brandId] });
    queryClient.removeQueries({ queryKey: ['catalogAlignmentDataAnalysis', brandId] });
    queryClient.removeQueries({ queryKey: ['products', brandId] });
    queryClient.removeQueries({ queryKey: ['products_paginated', brandId] });
    queryClient.removeQueries({ queryKey: ['productIntelligenceAggregate', brandId] });
    queryClient.removeQueries({ queryKey: ['productIntelligencePage', brandId] });
    queryClient.invalidateQueries({ queryKey: ['brandSyncVersion', brandId] });
    queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] });
    queryClient.invalidateQueries({ queryKey: ['business_revenue_summary', brandId] });
    queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
    queryClient.invalidateQueries({ queryKey: ['dataAnalysisOrdersRaw', brandId] });
    queryClient.invalidateQueries({ queryKey: ['catalogAlignmentDataAnalysis', brandId] });
    queryClient.invalidateQueries({ queryKey: ['products', brandId] });
    queryClient.invalidateQueries({ queryKey: ['products_paginated', brandId] });
    queryClient.invalidateQueries({ queryKey: ['productIntelligenceAggregate', brandId] });
    queryClient.invalidateQueries({ queryKey: ['productIntelligencePage', brandId] });
    queryClient.invalidateQueries({ queryKey: ['lastSyncDates', brandId, 'v2'] });
  }, [brandId, queryClient]);

  // Keep fetchStates for OAuth callback compatibility (force refetch after OAuth redirect)
  const fetchStates = useCallback(async () => {
    await refetchConnectors();
    queryClient.removeQueries({ queryKey: ['lastSyncDates', brandId, 'v2'] });
  }, [brandId, refetchConnectors, queryClient]);

  useEffect(() => {
    if (!brandId || !megaventorySyncJob || megaventorySyncJob.provider !== 'megaventory') return;
    const status = megaventorySyncJob.status ?? null;
    const previousStatus = previousMegaventoryJobStatusRef.current;
    previousMegaventoryJobStatusRef.current = status;
    if (status !== 'completed' && status !== 'failed') return;
    if (previousStatus !== 'pending' && previousStatus !== 'running') return;
    setSyncingProviders((prev) => {
      const next = new Set(prev);
      next.delete('megaventory');
      return next;
    });
    const completedAt = coerceToDate(megaventorySyncJob.completedAt)?.toISOString() || '';
    const handledKey = `${brandId}:${status}:${completedAt}`;
    if (handledMegaventoryJobRef.current === handledKey) return;
    handledMegaventoryJobRef.current = handledKey;
    if (status === 'completed') {
      toast.success('Megaventory sync ολοκληρώθηκε.');
    } else {
      toast.error(megaventorySyncJob.error || 'Megaventory sync απέτυχε.');
    }
    refreshCommerceRfmProductCaches();
    void fetchStates();
  }, [brandId, fetchStates, megaventorySyncJob, refreshCommerceRfmProductCaches, toast]);

  useEffect(() => {
    if (!brandId || !opencartSyncJob || opencartSyncJob.provider !== 'opencart') return;
    const status = opencartSyncJob.status ?? null;
    const previousStatus = previousOpenCartJobStatusRef.current;
    previousOpenCartJobStatusRef.current = status;
    if (status !== 'completed' && status !== 'failed') return;
    if (previousStatus !== 'pending' && previousStatus !== 'running') return;
    setSyncingProviders((prev) => {
      const next = new Set(prev);
      next.delete('opencart');
      return next;
    });
    const completedAt = coerceToDate(opencartSyncJob.completedAt)?.toISOString() || '';
    const handledKey = `${brandId}:${status}:${completedAt}`;
    if (handledOpenCartJobRef.current === handledKey) return;
    handledOpenCartJobRef.current = handledKey;
    if (status === 'completed') {
      toast.success('OpenCart sync ολοκληρώθηκε.');
      void refreshProductIntelligenceOnServer(brandId)
        .then(() => refreshCommerceRfmProductCaches())
        .catch((err: unknown) => console.warn('[ConnectorsPanel] PI refresh after OpenCart job:', err));
    } else {
      toast.error(opencartSyncJob.error || 'OpenCart sync απέτυχε.');
    }
    refreshCommerceRfmProductCaches();
    void fetchStates();
  }, [brandId, fetchStates, opencartSyncJob, refreshCommerceRfmProductCaches, toast]);

  const refreshMagentoEcommerceCaches = useCallback(() => {
    if (!brandId) return;
    queryClient.removeQueries({ queryKey: ['brandSyncVersion', brandId] });
    queryClient.removeQueries({ queryKey: ['ecommerce_summary', brandId] });
    queryClient.removeQueries({ queryKey: ['business_revenue_summary', brandId] });
    queryClient.removeQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
    queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] });
    queryClient.invalidateQueries({ queryKey: ['business_revenue_summary', brandId] });
    queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
  }, [brandId, queryClient]);

  const onMagentoConnectorSettingsSaved = useCallback(() => {
    refreshMagentoEcommerceCaches();
    void fetchStates();
  }, [refreshMagentoEcommerceCaches, fetchStates]);

  const runOAuthSuccessFlow = useCallback(
    async (connectorKey: string) => {
      await fetchStates();
      queryClient.invalidateQueries({ queryKey: ['connectorsSummary', brandId] });
      const label =
        connectorKey === 'meta'
          ? 'Το Meta συνδέθηκε επιτυχώς.'
          : connectorKey === 'tiktok'
            ? 'Το TikTok Ads συνδέθηκε επιτυχώς.'
            : connectorKey === 'google_ads'
              ? 'Το Google Ads συνδέθηκε επιτυχώς.'
              : connectorKey === 'ga4'
                ? 'Το GA4 συνδέθηκε επιτυχώς.'
                : connectorKey === 'search_console'
                  ? 'Το Google Search Console συνδέθηκε επιτυχώς.'
                  : connectorKey === 'merchant'
                    ? 'Το Merchant Center συνδέθηκε επιτυχώς.'
                    : connectorKey === 'shopify'
                      ? 'Το Shopify συνδέθηκε επιτυχώς.'
                      : connectorKey === 'opencart'
                        ? 'Το OpenCart συνδέθηκε επιτυχώς.'
                        : connectorKey === 'magento'
                          ? 'Το Magento συνδέθηκε επιτυχώς.'
                          : connectorKey === 'megaventory'
                            ? 'Το Megaventory συνδέθηκε επιτυχώς.'
                            : connectorKey === 'softone'
                              ? 'Το SoftOne συνδέθηκε επιτυχώς.'
                              : connectorKey === 'epsilon_net'
                                ? 'Το Epsilon Net συνδέθηκε επιτυχώς.'
                                : connectorKey === 'entersoft'
                                  ? 'Το Entersoft συνδέθηκε επιτυχώς.'
                                  : 'Η σύνδεση ολοκληρώθηκε.';
      toast.success(label);
    },
    [brandId, fetchStates, queryClient, toast]
  );

  // OAuth payload αποθηκεύεται στο App (useLayoutEffect + oauthSession) πριν χαθεί το hash.
  useEffect(() => {
    const payload = readOAuthSessionPayload();
    if (!payload) return;

    if (payload.status === 'error') {
      let msg = payload.message || 'Unknown';
      try {
        msg = decodeURIComponent(msg);
      } catch {
        /* keep raw */
      }
      toast.error(`Σφάλμα σύνδεσης: ${msg}`);
      clearOAuthSession();
      return;
    }

    if (payload.status === 'success' && !brandId) {
      return;
    }

    if (payload.status === 'success' && brandId) {
      clearOAuthSession();
      void runOAuthSuccessFlow(payload.connector);
    }
  }, [brandId, toast, runOAuthSuccessFlow]);

  // Drop dismiss flags when server clears pending (επιτυχής επιλογή / αποσύνδεση αλλού)
  useEffect(() => {
    for (const id of [...dismissedAccountPickerRef.current]) {
      if (!states[id]?.pendingAccountSelection) {
        dismissedAccountPickerRef.current.delete(id);
      }
    }
  }, [states]);

  // Auto-open picker μόνο αν το pending OAuth ανήκει στον τρέχοντα χρήστη (όχι άλλου admin / παλιά δεδομένα)
  useEffect(() => {
    const uid = user?.uid;
    const pendingProvider = Object.entries(states).find(
      ([, s]) =>
        s.pendingAccountSelection && uid && (s as ConnectorState).oauthInitiatedByUid === uid
    )?.[0];
    if (
      pendingProvider &&
      canManageConnectors &&
      !dismissedAccountPickerRef.current.has(pendingProvider)
    ) {
      setAccountPickerFor(pendingProvider);
    }
  }, [states, canManageConnectors, user?.uid]);

  useEffect(() => {
    if (!canManageConnectors) setAccountPickerFor(null);
  }, [canManageConnectors]);

  const markSyncStart = useCallback((provider: ConnectorConfig['id']) => {
    setSyncingProviders((prev) => {
      const next = new Set(prev);
      next.add(provider);
      return next;
    });
  }, []);

  const markSyncEnd = useCallback((provider: ConnectorConfig['id']) => {
    setSyncingProviders((prev) => {
      const next = new Set(prev);
      next.delete(provider);
      return next;
    });
  }, []);

  const recordSyncAttempt = useCallback(
    (provider: ConnectorId, success: boolean, error?: string) => {
      setSyncAttempts((prev) => ({
        ...prev,
        [provider]: { at: new Date(), success, error: error?.slice(0, 280) },
      }));
    },
    []
  );

  const refreshAfterSyncAttempt = useCallback(async () => {
    if (!brandId) return;
    queryClient.invalidateQueries({ queryKey: ['lastSyncDates', brandId, 'v2'] });
    await refetchConnectors();
  }, [brandId, queryClient, refetchConnectors]);

  const handleConnect = async (provider: ConnectorConfig['id'], shopDomain?: string) => {
    if (!brandId || !user) return;
    if (!canManageConnectors) {
      toast.error('Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να συνδέσει πλατφόρμες.');
      return;
    }

    if (provider === 'shopify' && !shopDomain) {
      setShopDomainModal(true);
      return;
    }
    if (provider === 'woocommerce') {
      setWooModal(true);
      return;
    }
    if (provider === 'opencart') {
      setOpencartModal(true);
      return;
    }
    if (provider === 'magento') {
      setMagentoModal(true);
      return;
    }
    if (provider === 'megaventory') {
      setMegaventoryModal(true);
      return;
    }
    if (provider === 'softone') {
      setSoftoneModal(true);
      return;
    }
    if (provider === 'epsilon_net') {
      setEpsilonNetModal(true);
      return;
    }
    if (provider === 'entersoft') {
      setEntersoftModal(true);
      return;
    }

    setConnecting(provider);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      // OAuth redirect must match Cloud Functions host (same as connectorAuth), not SPA origin — avoids redirect_uri_mismatch on custom domains / web.app.
      const callbackUrl = `${FUNCTIONS_BASE}/connectorCallback`;

      const body: Record<string, string> = {
        brandId,
        provider,
        redirectUri: callbackUrl,
        returnOrigin: typeof window !== 'undefined' ? window.location.origin : '',
      };
      if (provider === 'shopify' && shopDomain) body.shopDomain = shopDomain;

      const res = await fetch(`${FUNCTIONS_BASE}/connectorAuth`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Σφάλμα σύνδεσης: ${msg}`);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: ConnectorConfig['id']) => {
    if (!brandId || !user) return;
    if (!canManageConnectors) {
      toast.error('Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να αποσυνδέσει.');
      return;
    }
    if (!confirm('Αποσύνδεση; Δεν θα γίνεται πλέον αυτόματη εισαγωγή.')) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorDisconnect`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({ brandId, provider }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => null as { error?: string } | null);
        throw new Error(errPayload?.error || `HTTP ${res.status}`);
      }
      toast.success('Αποσυνδέθηκε');
      await fetchStates();
    } catch (err) {
      toast.error('Σφάλμα αποσύνδεσης');
      console.error(err);
    }
  };

  const handleSync = async (provider: ConnectorConfig['id'], opts?: { forceFullSync?: boolean }) => {
    if (!brandId || !user) return;
    if (!canManageConnectors) {
      toast.error('Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να κάνει sync.');
      return;
    }
    if (syncingProviders.has(provider)) {
      toast.info('Το συγκεκριμένο connector κάνει ήδη sync.');
      return;
    }
    markSyncStart(provider);

    const syncAbort = new AbortController();
    const syncTimer = window.setTimeout(() => syncAbort.abort(), 1_260_000);
    let keepSyncingUntilBackgroundJobFinishes = false;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const payload: Record<string, unknown> = { brandId, provider };
      if (opts?.forceFullSync) payload.forceFullSync = true;

      const res = await postConnectorSync(payload, await connectorRequestHeaders(token), syncAbort.signal);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const result = await res.json();
      if (result.success) {
        const syncedConnector = CONNECTORS.find((c) => c.id === provider);
        const label = syncedConnector?.syncLabel || 'campaigns';
        // Optimistic last-sync UI update (prevents stale date display while background queries refresh)
        queryClient.setQueryData<{ dates: Record<string, Date>; meta: Record<string, LastImportMeta> }>(
          ['lastSyncDates', brandId, 'v2'],
          (prev) => ({
            dates: { ...(prev?.dates || {}), [provider]: new Date() },
            meta: {
              ...(prev?.meta || {}),
              [provider]: { date: new Date(), status: 'completed' },
            },
          })
        );
        if (provider === 'megaventory' && result.queued) {
          keepSyncingUntilBackgroundJobFinishes = true;
          toast.success('Megaventory sync ξεκίνησε στο background. Μπορείς να συνεχίσεις κανονικά.');
          queryClient.invalidateQueries({ queryKey: ['connectorSyncJob', brandId, 'megaventory'] });
        } else if (provider === 'opencart' && result.queued) {
          keepSyncingUntilBackgroundJobFinishes = true;
          toast.success(
            result.message ||
              'OpenCart sync ξεκίνησε στο background. Θα ολοκληρωθεί αυτόματα — δεν χρειάζεται να περιμένεις.'
          );
          queryClient.invalidateQueries({ queryKey: ['connectorSyncJob', brandId, 'opencart'] });
        } else if (provider === 'merchant') {
          const imp = result.imported ?? 0;
          const wm = typeof result.withMarketBenchmark === 'number' ? result.withMarketBenchmark : undefined;
          if (imp === 0) {
            toast.info('GMC: 0 προϊόντα από ProductView — έλεγξε ότι ο λογαριασμός GMC έχει ενεργό κατάλογο.');
          } else if (wm === 0) {
            toast.info(
              `GMC: ${imp} SKUs στο catalog — κανένα με benchmark τιμάς αγοράς ακόμα. Έλεγξε GTIN στο feed και Growth › Price competitiveness.`
            );
          } else {
            toast.success(`GMC: ${imp} SKUs (${wm} με benchmark αγοράς)`);
          }
        } else if (provider === 'megaventory') {
          const total = result.imported ?? 0;
          const bits = [
            typeof result.invoices === 'number' ? `τιμολ. ${result.invoices}` : '',
            typeof result.salesOrders === 'number' ? `πωλ. παραγγ. ${result.salesOrders}` : '',
            typeof result.purchaseOrders === 'number' ? `αγορ. παραγγ. ${result.purchaseOrders}` : '',
            typeof result.products === 'number' ? `προϊόντα ${result.products}` : '',
            typeof result.stock === 'number' ? `απόθεμα ${result.stock}` : '',
            typeof result.suppliers === 'number' ? `προμηθ. ${result.suppliers}` : '',
            typeof result.customReportRows === 'number' && result.customReportRows > 0
              ? `custom report ${result.customReportRows}`
              : '',
          ].filter(Boolean);
          toast.success(
            bits.length
              ? `Megaventory: ${total} εγγραφές συνολικά (${bits.join(' · ')})`
              : `Megaventory: ${total} εγγραφές`
          );
        } else if (provider === 'softone') {
          const t = result.imported ?? 0;
          const bits = [
            typeof result.customers === 'number' ? `πελάτες ${result.customers}` : '',
            typeof result.items === 'number' ? `είδη ${result.items}` : '',
            typeof result.salesDocs === 'number' && result.salesDocs > 0 ? `πωλ. παραστ. ${result.salesDocs}` : '',
            typeof result.purchaseDocs === 'number' && result.purchaseDocs > 0 ? `αγορ. παραστ. ${result.purchaseDocs}` : '',
          ].filter(Boolean);
          toast.success(bits.length ? `SoftOne: ${t} (${bits.join(' · ')})` : `SoftOne: ${t} εγγραφές`);
        } else if (provider === 'epsilon_net') {
          const t = result.imported ?? 0;
          toast.success(
            `Epsilon Net: ${t} εγγραφές` +
              (typeof result.items === 'number' ? ` · είδη ${result.items}` : '') +
              (typeof result.balances === 'number' ? ` · υπόλοιπα ${result.balances}` : '')
          );
        } else if (provider === 'entersoft') {
          const t = result.imported ?? 0;
          toast.success(
            typeof result.publicQueryRows === 'number'
              ? `Entersoft: ${t} εγγραφές (PQ ${result.publicQueryRows})`
              : `Entersoft: ${t} εγγραφές`
          );
        } else if (provider === 'opencart' && (result.backfillContinuing || result.partial)) {
          toast.info(
            result.message ||
              `OpenCart: εισήχθησαν ${result.imported ?? 0} εγγραφές — συνεχίζει στο background.`
          );
        } else if (result.warning) {
          // Degraded αλλά επιτυχές (π.χ. orders OK, product-catalog ACL denied) — info, όχι error.
          toast.info(result.warning);
        } else {
          toast.success(`Εισήχθησαν ${result.imported} ${label}`);
        }
        queryClient.invalidateQueries({ queryKey: ['campaigns', brandId] });
        queryClient.invalidateQueries({ queryKey: ['connectorsSummary', brandId] });
        queryClient.invalidateQueries({ queryKey: ['lastSyncDates', brandId, 'v2'] });
        queryClient.removeQueries({ queryKey: ['brandSyncVersion', brandId] });
        queryClient.invalidateQueries({ queryKey: ['brandSyncVersion', brandId] });
        if (provider === 'google_ads') {
          queryClient.invalidateQueries({ queryKey: ['search_intelligence', brandId] });
        }
        if (provider === 'ga4' || provider === 'search_console') {
          queryClient.removeQueries({ queryKey: ['ga4_data', brandId] });
          queryClient.invalidateQueries({ queryKey: ['ga4_data', brandId] });
        }
        if (provider === 'search_console') {
          queryClient.removeQueries({ queryKey: ['search_console_data', brandId] });
          queryClient.invalidateQueries({ queryKey: ['search_console_data', brandId] });
        }
        if (provider === 'merchant') queryClient.invalidateQueries({ queryKey: ['priceBenchmarks', brandId] });
        if (['shopify', 'woocommerce', 'opencart', 'magento'].includes(provider)) {
          queryClient.removeQueries({ queryKey: ['ecommerce_summary', brandId] });
          queryClient.removeQueries({ queryKey: ['business_revenue_summary', brandId] });
          queryClient.removeQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
          queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] });
          queryClient.invalidateQueries({ queryKey: ['business_revenue_summary', brandId] });
          queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
        }
        if (['megaventory', 'softone', 'epsilon_net', 'entersoft'].includes(provider)) {
          queryClient.removeQueries({ queryKey: ['products', brandId] });
          queryClient.removeQueries({ queryKey: ['products_paginated', brandId] });
          queryClient.removeQueries({ queryKey: ['procurement', brandId] });
          queryClient.removeQueries({ queryKey: ['procurement_signals', brandId] });
          queryClient.removeQueries({ queryKey: ['ecommerce_summary', brandId] });
          queryClient.removeQueries({ queryKey: ['business_revenue_summary', brandId] });
          queryClient.removeQueries({ queryKey: ['segments', brandId] });
          queryClient.removeQueries({ queryKey: ['segmentCustomerSummaries', brandId] });
          queryClient.invalidateQueries({ queryKey: ['products', brandId] });
          queryClient.invalidateQueries({ queryKey: ['products_paginated', brandId] });
          queryClient.invalidateQueries({ queryKey: ['procurement', brandId] });
          queryClient.invalidateQueries({ queryKey: ['procurement_signals', brandId] });
          queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] });
          queryClient.invalidateQueries({ queryKey: ['business_revenue_summary', brandId] });
          queryClient.invalidateQueries({ queryKey: ['segments', brandId] });
          queryClient.invalidateQueries({ queryKey: ['segmentCustomerSummaries', brandId] });
          queryClient.invalidateQueries({ queryKey: ['aggregates'] });
        }
        if (
          ['shopify', 'woocommerce', 'opencart', 'magento', 'megaventory', 'softone', 'epsilon_net', 'entersoft'].includes(provider) &&
          result.queued !== true
        ) {
          refreshCommerceRfmProductCaches();
        }
        if (provider === 'magento') {
          queryClient.invalidateQueries({ queryKey: ['magento_popular_searches', brandId] });
        }
        recordSyncAttempt(provider, true);
        fetchStates();
      } else {
        const errMsg = String(result.error || 'Sync failed');
        recordSyncAttempt(provider, false, errMsg);
        await refreshAfterSyncAttempt();
        toast.error(errMsg);
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Σφάλμα sync';
      if (err instanceof Error && err.name === 'AbortError') {
        msg =
          provider === 'opencart'
            ? 'Το sync OpenCart ξεπέρασε το χρονικό όριο του browser — μπορεί να συνεχίζει στο server. Ανανέωσε τη σελίδα σε 1–2 λεπτά και πάτα Sync ξανά αν χρειάζεται.'
            : 'Το sync δεν ολοκληρώθηκε εντός του διαθέσιμου χρόνου. Δοκιμάστε ξανά ή ελέγξτε τα logs της function.';
        if (provider === 'opencart') {
          void refreshAfterSyncAttempt();
        }
      } else if (msg === 'Failed to fetch') {
        msg =
          'Αποτυχία δικτύου. Δοκίμασε ξανά σε 1 λεπτό ή από άλλο δίκτυο. Το σύστημα δοκίμασε αυτόματα και την εναλλακτική σύνδεση server.';
      }
      recordSyncAttempt(provider, false, msg);
      void refreshAfterSyncAttempt();
      toast.error(msg);
      console.error('[ConnectorsPanel] connectorSync failed:', err);
    } finally {
      window.clearTimeout(syncTimer);
      if (!keepSyncingUntilBackgroundJobFinishes) {
        markSyncEnd(provider);
      }
    }
  };

  const handleConfirmAccount = async (account: AdAccount) => {
    if (!brandId || !accountPickerFor) return;
    setConfirmingAccount(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSelectAccount`, {
        method: 'POST',
        headers: await connectorRequestHeaders(token),
        body: JSON.stringify({
          brandId,
          provider: accountPickerFor,
          accountId: account.id,
          accountName: account.name,
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }

      toast.success(`Λογαριασμός "${account.name}" επιλέχθηκε — γίνεται sync...`);
      const provider = accountPickerFor;
      setAccountPickerFor(null);
      await fetchStates();

      // Auto-trigger sync after account selection
      try {
        await handleSync(provider as ConnectorConfig['id']);
      } catch {
        // Non-blocking — user can retry via Sync button
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Σφάλμα επιλογής λογαριασμού';
      toast.error(m);
      console.error(err);
    } finally {
      setConfirmingAccount(false);
    }
  };

  useEffect(() => {
    if (!brandId || !canManageConnectors || !opencartBackfillNeedsResume) return;
    const jobStatus = opencartSyncJob?.status;
    if (jobStatus === 'pending' || jobStatus === 'running') return;
    const resumeKey = `${brandId}:${jobStatus ?? 'none'}:${String(opencartState.productsSyncPageCursor ?? '')}:${String(opencartState.ordersSyncPageCursor ?? '')}`;
    if (opencartAutoResumeRef.current === resumeKey) return;
    opencartAutoResumeRef.current = resumeKey;
    void handleSync('opencart');
  }, [
    brandId,
    canManageConnectors,
    handleSync,
    opencartBackfillNeedsResume,
    opencartState.ordersSyncPageCursor,
    opencartState.productsSyncPageCursor,
    opencartSyncJob?.status,
  ]);

  useEffect(() => {
    if (!accountPickerFor || !user?.uid) return;
    const s = states[accountPickerFor];
    if (s?.pendingAccountSelection && s.oauthInitiatedByUid !== user.uid) {
      setAccountPickerFor(null);
    }
  }, [accountPickerFor, states, user?.uid]);

  if (!brandId) return null;

  const pendingState = accountPickerFor ? states[accountPickerFor] : null;

  return (
    <>
      {accountPickerFor &&
        pendingState?.pendingAccountSelection &&
        user?.uid &&
        pendingState.oauthInitiatedByUid === user.uid && (
        <AccountPickerModal
          accounts={pendingState.availableAccounts || []}
          brandName={brandName}
          provider={accountPickerFor}
          onConfirm={handleConfirmAccount}
          onCancel={() => {
            if (accountPickerFor) dismissedAccountPickerRef.current.add(accountPickerFor);
            setAccountPickerFor(null);
          }}
          loading={confirmingAccount}
        />
      )}

      {shopDomainModal && (
        <ShopDomainModal
          loading={connecting === 'shopify'}
          onConfirm={(domain) => {
            setShopDomainModal(false);
            handleConnect('shopify', domain);
          }}
          onCancel={() => setShopDomainModal(false)}
        />
      )}

      {wooModal && brandId && (
        <WooCredentialsModal
          brandId={brandId}
          onSuccess={() => {
            setWooModal(false);
            fetchStates();
          }}
          onCancel={() => setWooModal(false)}
        />
      )}

      {opencartModal && brandId && (
        <OpenCartCredentialsModal
          brandId={brandId}
          onSuccess={() => {
            setOpencartModal(false);
            fetchStates();
            queryClient.invalidateQueries({ queryKey: ['connectorSyncJob', brandId, 'opencart'] });
            toast.info('Το αρχικό sync ξεκίνησε στο background.');
          }}
          onCancel={() => setOpencartModal(false)}
        />
      )}

      {magentoModal && brandId && (
        <MagentoCredentialsModal
          brandId={brandId}
          onSuccess={() => {
            setMagentoModal(false);
            fetchStates();
          }}
          onCancel={() => setMagentoModal(false)}
        />
      )}

      {megaventoryModal && brandId && (
        <MegaventoryCredentialsModal
          brandId={brandId}
          initialCustomReportId={connectorsData?.megaventory?.customReportId}
          initialCustomReportEnabled={connectorsData?.megaventory?.customReportEnabled}
          onSuccess={() => {
            setMegaventoryModal(false);
            fetchStates();
          }}
          onCancel={() => setMegaventoryModal(false)}
        />
      )}

      {softoneModal && brandId && (
        <SoftOneCredentialsModal
          brandId={brandId}
          onSuccess={() => {
            setSoftoneModal(false);
            fetchStates();
          }}
          onCancel={() => setSoftoneModal(false)}
        />
      )}

      {epsilonNetModal && brandId && (
        <EpsilonNetCredentialsModal
          brandId={brandId}
          onSuccess={() => {
            setEpsilonNetModal(false);
            fetchStates();
          }}
          onCancel={() => setEpsilonNetModal(false)}
        />
      )}

      {entersoftModal && brandId && (
        <EntersoftCredentialsModal
          brandId={brandId}
          onSuccess={() => {
            setEntersoftModal(false);
            fetchStates();
          }}
          onCancel={() => setEntersoftModal(false)}
        />
      )}

      <Card>
        <div className="p-6">
          <PageHeader
            className="mb-4"
            toolbarAriaLabel="Platform connectors"
            title={
              <h3 className="flex items-center gap-2 text-base font-semibold text-[#1A1A1A] sm:text-lg">
                <Link2 size={20} className="shrink-0 text-[var(--nts-accent)]" />
                Platform Connectors
              </h3>
            }
            description={
              <p className="text-sm text-[#6B7280]">
                {isB2B
                  ? 'Σύνδεσε demand, analytics και B2B-ready data sources. Τα disabled modules δεν εμφανίζονται.'
                  : 'Σύνδεσε Ad Platforms & E-shop για αυτόματη εισαγωγή δεδομένων (23:00)'}
              </p>
            }
            meta={
              !canManageConnectors ? (
                <p className="mt-3 max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Οι συνδέσεις διαχειρίζονται μόνο από <strong>ιδιοκτήτη</strong> ή <strong>διαχειριστή</strong> του brand.
                </p>
              ) : undefined
            }
          />

          {connectorsLoadError && (
            <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span>Δεν ήταν δυνατή η φόρτωση των connector. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.</span>
              <button
                onClick={() => refetchConnectors()}
                className="shrink-0 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-200 transition-colors"
              >
                Ανανέωση
              </button>
            </div>
          )}

          {canManageConnectors && !loading && (
            <div className="mb-6 space-y-6">
              <RevenueSourceSettings />
              <SalesChannelRulesEditor />
            </div>
          )}

          {loading ? (
            <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-4 py-8 text-center">
              <Spinner size="sm" className="mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#4B5563]">Ανάκτηση αποθηκευμένων συνδέσεων…</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Οι ρυθμίσεις παραμένουν ασφαλώς στη Firebase. Δεν γίνεται reset σε refresh.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {connectorGroups.map((group) => {
                const meta = group.meta;
                const GroupIcon = meta.Icon;
                return (
                <div
                  key={group.id}
                  className="relative overflow-hidden rounded-2xl border border-neutral-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                >
                  <div
                    className={`pointer-events-none absolute -right-20 -top-16 h-44 w-44 rounded-full blur-3xl ${meta.blobA}`}
                    aria-hidden
                  />
                  <div
                    className={`pointer-events-none absolute -left-16 top-1/2 h-36 w-36 -translate-y-1/2 rounded-full blur-3xl ${meta.blobB}`}
                    aria-hidden
                  />
                  <div
                    className={`pointer-events-none absolute bottom-0 right-1/4 h-28 w-28 rounded-full blur-2xl ${meta.blobC}`}
                    aria-hidden
                  />

                  <div className={`relative border-l-4 ${meta.stripe} bg-white/90 backdrop-blur-[2px] pl-4 pr-3 py-5 md:pl-5 md:pr-4 md:py-6`}>
                    <div className="mb-5 flex flex-wrap items-start gap-3 gap-y-2">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white ring-2 ring-white/90 ${meta.iconGradient} ${meta.iconShadow}`}
                      >
                        <GroupIcon size={22} strokeWidth={2} aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold tracking-tight text-[#1A1A1A]">{meta.title}</h4>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${meta.countChip}`}
                          >
                            {group.connectors.length === 1
                              ? '1 πλατφόρμα'
                              : `${group.connectors.length} πλατφόρμες`}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-[#6B7280]">{group.description}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {group.connectors.map((conn) => {
                const state = states[conn.id] || { connected: false };
                const isConnected = state.connected;
                const isPending = !!state.pendingAccountSelection;
                const pickerOwnerUid = state.oauthInitiatedByUid;
                const uid = user?.uid;
                const isPickerForMe = isPending && Boolean(uid) && pickerOwnerUid === uid;
                const isPickerForeign =
                  isPending &&
                  Boolean(uid) &&
                  (pickerOwnerUid === undefined || pickerOwnerUid !== uid);
                const opencartJobActive =
                  conn.id === 'opencart' &&
                  (opencartSyncJob?.status === 'pending' ||
                    opencartSyncJob?.status === 'running' ||
                    (opencartBackfillNeedsResume && opencartSyncJob?.status === 'completed'));
                const megaventoryJobActive =
                  conn.id === 'megaventory' &&
                  (megaventorySyncJob?.status === 'pending' || megaventorySyncJob?.status === 'running');
                const isSyncing =
                  syncingProviders.has(conn.id) || opencartJobActive || megaventoryJobActive;
                const isConnecting = connecting === conn.id;
                const importMeta = lastImportMeta[conn.id];
                const connectorAttemptAt = coerceToDate(state.lastSyncAttemptAt);
                const connectorSyncError =
                  typeof state.lastSyncError === 'string' ? state.lastSyncError.trim() : '';
                const ordersSyncAt = coerceToDate(state.lastOrdersSyncAt);
                const productsSyncAt = coerceToDate(state.lastProductsSyncAt);
                const ecommerceHealth = ECOMMERCE_CONNECTOR_IDS.has(conn.id)
                  ? ecommerceSyncHealth(state, importMeta)
                  : null;
                const lastSyncAt =
                  ecommerceHealth === 'full'
                    ? newestDate(ordersSyncAt, productsSyncAt)
                    : newestDate(
                        connectorAttemptAt,
                        lastSyncDates[conn.id],
                        state.lastSyncAt,
                        state.lastOrdersSyncAt,
                        state.lastProductsSyncAt,
                        importMeta?.date
                      );
                const connectorStatusPartial =
                  state.lastSyncStatus === 'partial' || (connectorSyncError.length > 0 && !ordersSyncAt && !productsSyncAt);
                const syncChipPartial =
                  connectorStatusPartial ||
                  ecommerceHealth === 'partial' ||
                  (ECOMMERCE_CONNECTOR_IDS.has(conn.id) &&
                    Boolean(lastSyncAt) &&
                    (!ordersSyncAt || !productsSyncAt));
                const lastAttempt = syncAttempts[conn.id];
                const opencartBackfillContinuing =
                  conn.id === 'opencart' &&
                  Boolean(state.productsSyncPageCursor || state.ordersSyncPageCursor);
                const recentFailedAttempt =
                  Boolean(lastAttempt) &&
                  !lastAttempt!.success &&
                  !opencartBackfillContinuing &&
                  opencartJobActive !== true &&
                  megaventoryJobActive !== true &&
                  (!lastSyncAt || lastAttempt!.at.getTime() > lastSyncAt.getTime() - 2000);
                const connectedAt = coerceToDate(state.connectedAt as unknown);
                const identityLines = getConnectorIdentityLines(conn.id, state);
                const usesCompactDetails = conn.id === 'magento' || conn.group === 'operations';
                const detailsExpanded = !usesCompactDetails || expandedConnectorDetails[conn.id] === true;
                const syncJob =
                  conn.id === 'megaventory'
                    ? megaventorySyncJob
                    : conn.id === 'opencart'
                      ? opencartSyncJob
                      : null;
                const syncJobBadge = syncJobLabel(syncJob);

                return (
                  <div
                    key={conn.id}
                    className={`rounded-xl border-2 p-5 transition-all ${
                      conn.comingSoon
                        ? 'bg-neutral-50 border-neutral-200 opacity-70'
                        : isConnected
                        ? 'bg-emerald-50/90 border-emerald-200'
                        : isPending
                        ? 'bg-white border-amber-300 ring-1 ring-amber-200/70'
                        : 'bg-white border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-[#1A1A1A]">{conn.name}</h4>
                            {conn.comingSoon && (
                              <span className="text-[10px] font-medium bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">Σύντομα</span>
                            )}
                          </div>
                          <p className="text-xs text-[#6B7280] mt-0.5">{conn.description}</p>
                          {conn.readOnlyNotice && (
                            <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                              {conn.readOnlyNotice}
                            </p>
                          )}
                        </div>
                      </div>
                      {isConnected && (
                        isSyncing ? (
                          <span
                            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-1 ring-sky-200"
                            title="Sync σε εξέλιξη"
                          >
                            <RefreshCw size={15} className="animate-spin" />
                          </span>
                        ) : (
                          <CheckCircle2 size={20} className="text-green-500 flex-shrink-0" />
                        )
                      )}
                      {isPending && (
                        <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
                      )}
                    </div>

                    {isPending && (
                      <p className="mb-3 text-xs text-amber-800 font-medium leading-relaxed">
                        {isPickerForMe
                          ? conn.id === 'ga4'
                            ? 'Απαιτείται επιλογή GA4 Property.'
                            : conn.id === 'search_console'
                              ? 'Απαιτείται επιλογή Search Console Property.'
                            : 'Απαιτείται επιλογή λογαριασμού.'
                          : 'Η εκκρεμής σύνδεση ανήκει σε άλλη συνεδρία. Πατήστε «Σύνδεση ξανά» για να επιλέξετε τον δικό σας λογαριασμό.'}
                      </p>
                    )}

                    {isConnected && (
                      <div className="mb-3 text-xs text-[#6B7280] space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 size={12} />
                            Συνδεδεμένο
                          </span>
                          {isSyncing ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
                              <RefreshCw size={11} className="animate-spin" />
                              Sync σε εξέλιξη…
                            </span>
                          ) : recentFailedAttempt ? (
                            <span
                              className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800 ring-1 ring-red-200"
                              title={lastAttempt?.error}
                            >
                              Αποτυχία: {formatConnectorDate(lastAttempt!.at)}
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                !lastSyncAt
                                  ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                  : syncChipPartial
                                    ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-300'
                                    : 'bg-white text-[#6B7280] ring-1 ring-emerald-200'
                              }`}
                              title={
                                syncChipPartial
                                  ? 'Τελευταία αποθηκευμένη εισαγωγή — όχι πλήρες sync. Κάντε ξανά sync.'
                                  : undefined
                              }
                            >
                              {lastSyncAt
                                ? syncChipPartial
                                  ? `Εισαγωγή: ${formatConnectorDate(lastSyncAt)} (μερικό)`
                                  : `Sync: ${formatConnectorDate(lastSyncAt)}`
                                : 'Δεν έχει γίνει sync'}
                            </span>
                          )}
                          {syncJobBadge && (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${syncJobBadge.className}`}
                              title={syncJob?.error || undefined}
                            >
                              {syncJobBadge.label}
                            </span>
                          )}
                          {usesCompactDetails && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedConnectorDetails((prev) => ({
                                  ...prev,
                                  [conn.id]: !prev[conn.id],
                                }))
                              }
                              className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#374151] hover:bg-white/80"
                            >
                              {detailsExpanded ? 'Σύμπτυξη' : 'Λεπτομέρειες'}
                              <ChevronDown
                                size={12}
                                className={`transition-transform ${detailsExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          )}
                        </div>
                        {detailsExpanded && (
                          <div className="pt-1">
                            {identityLines.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                            {connectedAt && <p className="text-[#9CA3AF]">Συνδέθηκε: {formatConnectorDate(connectedAt)}</p>}
                            {recentFailedAttempt && (
                              <p className="text-red-700/90">
                                Τελευταία προσπάθεια: {formatConnectorDate(lastAttempt!.at)} — αποτυχία
                                {lastAttempt?.error ? ` (${lastAttempt.error})` : ''}
                              </p>
                            )}
                            {lastSyncAt && (
                              <p className="text-[#9CA3AF]">
                                {syncChipPartial ? 'Τελευταία εισαγωγή (μερικό)' : 'Τελευταίο sync'}:{' '}
                                {formatConnectorDate(lastSyncAt)}
                                {recentFailedAttempt ? ' (παλαιότερη από την αποτυχημένη προσπάθεια)' : ''}
                              </p>
                            )}
                            {ECOMMERCE_CONNECTOR_IDS.has(conn.id) && isConnected && (
                              <>
                                <p className="text-[#9CA3AF]">
                                  Παραγγελίες: {ordersSyncAt ? formatConnectorDate(ordersSyncAt) : '—'} · Προϊόντα:{' '}
                                  {productsSyncAt ? formatConnectorDate(productsSyncAt) : '—'}
                                </p>
                                {(connectorSyncError || importMeta?.errors?.length) && (
                                  <p className="text-amber-800/90 break-words">
                                    {connectorSyncError ||
                                      importMeta?.errors?.join(' · ') ||
                                      'Μερική εισαγωγή — δοκιμάστε ξανά sync.'}
                                  </p>
                                )}
                                {typeof state.lastSyncImported === 'number' && state.lastSyncImported > 0 && (
                                  <p className="text-[#9CA3AF]">
                                    Τελευταία προσπάθεια: {state.lastSyncOrders ?? 0} παραγγελίες ·{' '}
                                    {state.lastSyncProducts ?? 0} προϊόντα
                                    {connectorAttemptAt ? ` (${formatConnectorDate(connectorAttemptAt)})` : ''}
                                  </p>
                                )}
                              </>
                            )}
                            {syncJob?.status && (
                              <p className="text-[#9CA3AF]">
                                Background job:{' '}
                                {opencartBackfillContinuing && syncJob.status === 'completed'
                                  ? 'backfill continuing (auto-resume)'
                                  : syncJob.status}
                                {coerceToDate(syncJob.updatedAt) ? ` · ${formatConnectorDate(coerceToDate(syncJob.updatedAt)!)} ` : ''}
                                {syncJob.error ? ` · ${syncJob.error}` : ''}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isConnected && conn.id === 'magento' && brandId && detailsExpanded && (
                      <div className="mb-3 w-full text-sm space-y-2">
                        <MagentoConsolidatedRevenueToggle
                          brandId={brandId}
                          syncAllStores={Boolean((state as { syncAllStores?: boolean }).syncAllStores)}
                          canManage={canManageConnectors}
                          onSaved={onMagentoConnectorSettingsSaved}
                        />
                      </div>
                    )}

                    {isConnected && conn.id === 'megaventory' && brandId && detailsExpanded && (
                      <div className="mb-3 w-full text-sm">
                        <MegaventoryCustomReportSettingsInline
                          brandId={brandId}
                          initialReportId={
                            String((state as any).customReportId ?? '4919').trim() || '4919'
                          }
                          initialEnabled={(state as any).customReportEnabled !== false}
                          canManage={canManageConnectors}
                          onSaved={() => {
                            void fetchStates();
                          }}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {conn.comingSoon ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled
                          className="w-full cursor-not-allowed"
                        >
                          Σύντομα διαθέσιμο
                        </Button>
                      ) : isPending && isPickerForMe ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            dismissedAccountPickerRef.current.delete(conn.id);
                            setAccountPickerFor(conn.id);
                          }}
                          disabled={!canManageConnectors}
                          className="w-full"
                          title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                        >
                          <Building2 size={14} className="mr-1" />
                          Επιλογή λογαριασμού
                        </Button>
                      ) : isPending && (isPickerForeign || !isPickerForMe) ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleConnect(conn.id)}
                          disabled={!canManageConnectors || isConnecting}
                          className="w-full"
                          title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                        >
                          {isConnecting ? (
                            <Spinner size="sm" className="mr-1" />
                          ) : (
                            <ExternalLink size={14} className="mr-1" />
                          )}
                          Σύνδεση ξανά
                        </Button>
                      ) : isConnected ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleSync(conn.id)}
                            disabled={isSyncing || !canManageConnectors}
                            title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                          >
                            {isSyncing ? (
                              <Spinner size="sm" className="mr-1" />
                            ) : (
                              <RefreshCw size={14} className="mr-1" />
                            )}
                            {isSyncing ? 'Syncing...' : 'Sync'}
                          </Button>
                          {conn.id === 'magento' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                if (window.confirm('Full Re-sync: θα ξανακατεβάσει όλο το ιστορικό παραγγελιών. Συνέχεια;')) {
                                  handleSync(conn.id, { forceFullSync: true });
                                }
                              }}
                              disabled={isSyncing || !canManageConnectors}
                              title="Ξανακατεβάζει όλες τις παραγγελίες από την αρχή"
                            >
                              <RefreshCw size={14} className="mr-1" />
                              Full Re-sync
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleDisconnect(conn.id)}
                            disabled={!canManageConnectors}
                            title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                          >
                            <Unlink size={14} className="mr-1" />
                            Αποσύνδεση
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleConnect(conn.id)}
                          disabled={isConnecting || !canManageConnectors}
                          className="w-full"
                          title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                        >
                          {isConnecting ? (
                            <Spinner size="sm" className="mr-1" />
                          ) : (
                            <ExternalLink size={14} className="mr-1" />
                          )}
                          {isConnecting ? 'Σύνδεση...' : `Σύνδεση ${conn.name}`}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {enabledModules.ecommerce && (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50/60 p-4">
            <div className="flex items-start gap-3">
              <span className="text-xl shrink-0" aria-hidden>🛍️</span>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[#1A1A1A]">Skroutz — XML κατάλογος</h4>
                <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
                  Δεν απαιτείται OAuth. Προσθέστε το δημόσιο URL του XML από το merchant panel του Skroutz στην ενότητα{' '}
                  <strong>Αποθηκευμένα Feed Sources</strong> (λειτουργία Feed) ή ανεβάστε αρχείο .xml με τύπο Skroutz.
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                  <a
                    href="https://developer.skroutz.gr/products/xml_feed/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--nts-accent)] hover:underline inline-flex items-center gap-1"
                  >
                    Τεκμηρίωση XML feed
                    <ExternalLink size={12} />
                  </a>
                  <button
                    type="button"
                    className="text-[var(--nts-accent)] hover:underline"
                    onClick={() => document.getElementById('feed-sources-section')?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    Μετάβαση στα Feed Sources
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}

          <p className="text-xs text-[#9CA3AF] mt-4">
            Κάθε brand συνδέεται με τους δικούς του λογαριασμούς. Τα credentials αποθηκεύονται ασφαλώς στο Firebase.
          </p>
        </div>
      </Card>

    </>
  );
}
