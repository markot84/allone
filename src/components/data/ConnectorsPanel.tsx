import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand, useAuth, useBrandMembers } from '../../hooks';
import { auth } from '../../config/firebase';
import { getLastImportDates } from '../../services/import';
import { coerceToDate } from '../../utils/coerceDate';
import { clearOAuthSession, readOAuthSessionPayload } from '../../utils/oauthSession';
import { FirestoreService } from '../../services/firestore';
import { Card, Button, Spinner, useToast, PageHeader } from '../common';
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
} from 'lucide-react';

interface AdAccount {
  id: string;
  name: string;
}

interface ConnectorState {
  connected: boolean;
  pendingAccountSelection?: boolean;
  availableAccounts?: AdAccount[];
  connectedAt?: any;
  // Google Ads
  customerId?: string;
  customerName?: string;
  // Meta
  adAccountIds?: string[];
  adAccountNames?: string[];
  expiresAt?: number;
}

type ConnectorId = 'google_ads' | 'meta' | 'merchant' | 'ga4' | 'shopify' | 'woocommerce' | 'opencart' | 'magento';

interface ConnectorConfig {
  id: ConnectorId;
  name: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  syncLabel?: string;
  authType?: 'oauth' | 'credentials';
  readOnlyNotice?: string;
  comingSoon?: boolean;
}

const CONNECTORS: ConnectorConfig[] = [
  {
    id: 'google_ads',
    name: 'Google Ads',
    description: 'Αυτόματη εισαγωγή campaigns, impressions, clicks, ROAS',
    icon: '🔍',
    color: '#4285F4',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    readOnlyNotice: 'Αποκλειστικά ανάγνωση δεδομένων — δεν τροποποιούμε τον λογαριασμό σας',
  },
  {
    id: 'meta',
    name: 'Meta (Facebook / Instagram)',
    description: 'Αυτόματη εισαγωγή campaigns, spend, conversions, ROAS',
    icon: '📘',
    color: '#1877F2',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    readOnlyNotice: 'Αποκλειστικά ανάγνωση δεδομένων — δεν τροποποιούμε τον λογαριασμό σας',
  },
  {
    id: 'merchant',
    name: 'Google Merchant Center',
    description: 'Price benchmarking — σύγκριση τιμών σας vs αγορά ανά SKU',
    icon: '🛒',
    color: '#0D652D',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    syncLabel: 'benchmarks',
    readOnlyNotice: 'Read-only — αποκλειστικά ανάγνωση αναφορών τιμών',
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    description: 'Sessions, users, traffic sources, top pages, bounce rate',
    icon: '📊',
    color: '#E37400',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    syncLabel: 'days',
    readOnlyNotice: 'Read-only — analytics.readonly scope',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Σύνδεση e-shop — products, orders, customers, inventory',
    icon: '🟢',
    color: '#96BF48',
    bgColor: 'bg-lime-50',
    borderColor: 'border-lime-200',
    syncLabel: 'items',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Σύνδεση WordPress e-shop — products, orders, customers',
    icon: '🟣',
    color: '#7F54B3',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    syncLabel: 'items',
    authType: 'credentials',
  },
  {
    id: 'opencart',
    name: 'OpenCart',
    description: 'Σύνδεση OpenCart e-shop — products, orders, customers',
    icon: '🛍️',
    color: '#23AFFE',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    syncLabel: 'items',
    authType: 'credentials',
  },
  {
    id: 'magento',
    name: 'Magento / Adobe Commerce',
    description: 'Σύνδεση Magento e-shop — products, orders, customers',
    icon: '🔶',
    color: '#F46F25',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    syncLabel: 'items',
    authType: 'credentials',
  },
];

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_URL ||
  'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net';

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
  const modalTitle = isGA4
    ? 'Επιλογή GA4 Property'
    : isMerchant
      ? 'Επιλογή Merchant Center Account'
      : 'Επιλογή Διαφημιστικού Λογαριασμού';
  const manualHint = isGA4
    ? 'Εισάγετε το GA4 Property ID σας.'
    : isMerchant
      ? 'Εισάγετε το Merchant Center ID σας.'
      : 'Εισάγετε το ID του διαφημιστικού sub-account, όχι του Manager Account (MCC).';
  const manualHelp = isGA4
    ? 'GA4 → Admin → Property Settings → Property ID'
    : isMerchant
      ? 'Merchant Center → Ρυθμίσεις → Account ID'
      : 'Google Ads → επιλογή sub-account → Ρυθμίσεις → Customer ID';
  const manualPlaceholder = isGA4 ? 'π.χ. 123456789' : isMerchant ? 'π.χ. 123456789' : 'π.χ. 123-456-7890';

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
          <button style={S.btnSecondary} onClick={onCancel} disabled={loading}>Άκυρο</button>
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
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleConnect = async () => {
    if (!storeUrl.trim() || !accessToken.trim()) return;
    setLoading(true);
    setError('');

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          brandId,
          provider: 'magento',
          storeUrl: storeUrl.trim(),
          accessToken: accessToken.trim(),
        }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success(`Magento συνδέθηκε: ${result.shopName || storeUrl}`);
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

          <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5' }}>
            Magento Admin → System → Integrations → Add New → Activate. Αντιγράψτε το Access Token. Χρειάζονται permissions: Sales, Catalog, και ρυθμίσεις e-shop (στο Magento admin: μενού «Stores»).
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
  const [apiUsername, setApiUsername] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleConnect = async () => {
    if (!storeUrl.trim() || !apiUsername.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError('');

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSaveCredentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          brandId,
          provider: 'opencart',
          storeUrl: storeUrl.trim(),
          apiUsername: apiUsername.trim(),
          apiKey: apiKey.trim(),
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
  const isValid = storeUrl.trim() && apiUsername.trim() && apiKey.trim();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', padding: '16px' }}>
      <div style={{ maxWidth: '460px', width: '100%', backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>🛍️</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: '#111827' }}>Σύνδεση OpenCart</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>API credentials από το OpenCart Admin</p>
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
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>API Username</label>
            <input type="text" value={apiUsername} onChange={(e) => setApiUsername(e.target.value)} placeholder="π.χ. Default" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>API Key</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Το API key από System → Users → API"
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

          <p style={{ margin: 0, fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5' }}>
            OpenCart Admin → System → Users → API → Add New ή χρησιμοποίησε υπάρχον API user. Βεβαιωθείτε ότι είναι ενεργοποιημένο (Status: Enabled).
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
  const { user, isSuperAdmin } = useAuth();
  const { members } = useBrandMembers();
  const queryClient = useQueryClient();
  const brandId = currentBrand?.id ?? null;
  const brandName = currentBrand?.name ?? 'Brand';
  const toast = useToast();

  const myRole = members.find((m) => m.userId === user?.uid)?.role ?? 'member';
  const canManageConnectors =
    Boolean(isSuperAdmin) ||
    (Boolean(user?.uid && currentBrand?.createdBy === user.uid)) ||
    myRole === 'owner' ||
    myRole === 'admin';

  const [syncingProviders, setSyncingProviders] = useState<Set<ConnectorConfig['id']>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  const [confirmingAccount, setConfirmingAccount] = useState(false);
  const [shopDomainModal, setShopDomainModal] = useState(false);
  const [wooModal, setWooModal] = useState(false);
  const [opencartModal, setOpencartModal] = useState(false);
  const [magentoModal, setMagentoModal] = useState(false);

  const emptyStates: Record<string, ConnectorState> = {
    google_ads: { connected: false },
    meta: { connected: false },
    merchant: { connected: false },
    ga4: { connected: false },
    shopify: { connected: false },
    woocommerce: { connected: false },
    opencart: { connected: false },
    magento: { connected: false },
  };

  // Connectors doc — cached, refetch only after sync/connect/disconnect
  const { data: connectorsData, isPending: loading, refetch: refetchConnectors } = useQuery({
    queryKey: ['connectorsPanel', brandId],
    queryFn: async () => {
      if (!brandId) return null;
      const doc = await FirestoreService.getDocumentWithTimeout<Record<string, any>>('connectors', brandId, 10000);
      return doc;
    },
    enabled: !!brandId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const states: Record<string, ConnectorState> = connectorsData
    ? {
        google_ads: connectorsData.google_ads || { connected: false },
        meta: connectorsData.meta || { connected: false },
        merchant: connectorsData.merchant || { connected: false },
        ga4: connectorsData.ga4 || { connected: false },
        shopify: connectorsData.shopify || { connected: false },
        woocommerce: connectorsData.woocommerce || { connected: false },
        opencart: connectorsData.opencart || { connected: false },
        magento: connectorsData.magento || { connected: false },
      }
    : emptyStates;

  // Last sync dates — secondary, loaded once, cached
  const { data: lastSyncDates = {} as Record<string, Date> } = useQuery({
    queryKey: ['lastSyncDates', brandId],
    queryFn: async () => {
      if (!brandId) return {} as Record<string, Date>;
      const dates = await getLastImportDates(brandId);
      return {
        google_ads: dates['google_ads_api'] || dates['campaigns'],
        meta: dates['meta_api'] || dates['campaigns'],
        merchant: dates['merchant_center_api'] || dates['price_benchmarks'],
        ga4: dates['ga4_api'] || dates['ga4'],
        shopify: dates['shopify_api'],
        woocommerce: dates['woocommerce_api'],
        opencart: dates['opencart_api'],
        magento: dates['magento_api'],
      } as Record<string, Date>;
    },
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  // Keep fetchStates for OAuth callback compatibility (force refetch after OAuth redirect)
  const fetchStates = useCallback(async () => {
    await refetchConnectors();
    queryClient.removeQueries({ queryKey: ['lastSyncDates', brandId] });
  }, [brandId, refetchConnectors, queryClient]);

  const runOAuthSuccessFlow = useCallback(
    async (connectorKey: string) => {
      await fetchStates();
      queryClient.invalidateQueries({ queryKey: ['connectorsSummary', brandId] });
      const label =
        connectorKey === 'meta'
          ? 'Το Meta συνδέθηκε επιτυχώς.'
          : connectorKey === 'google_ads'
            ? 'Το Google Ads συνδέθηκε επιτυχώς.'
            : connectorKey === 'ga4'
              ? 'Το GA4 συνδέθηκε επιτυχώς.'
              : connectorKey === 'merchant'
                ? 'Το Merchant Center συνδέθηκε επιτυχώς.'
                : connectorKey === 'shopify'
                  ? 'Το Shopify συνδέθηκε επιτυχώς.'
                  : connectorKey === 'opencart'
                    ? 'Το OpenCart συνδέθηκε επιτυχώς.'
                    : connectorKey === 'magento'
                      ? 'Το Magento συνδέθηκε επιτυχώς.'
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

  // Auto-open picker if pending (μόνο owner/admin/δημιουργός)
  useEffect(() => {
    const pendingProvider = Object.entries(states).find(
      ([, s]) => s.pendingAccountSelection
    )?.[0];
    if (pendingProvider && canManageConnectors) setAccountPickerFor(pendingProvider);
  }, [states, canManageConnectors]);

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

    setConnecting(provider);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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

  const handleSync = async (provider: ConnectorConfig['id']) => {
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

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${FUNCTIONS_BASE}/connectorSync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ brandId, provider }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const result = await res.json();
      if (result.success) {
        const syncedConnector = CONNECTORS.find((c) => c.id === provider);
        const label = syncedConnector?.syncLabel || 'campaigns';
        // Optimistic last-sync UI update (prevents stale date display while background queries refresh)
        queryClient.setQueryData<Record<string, Date> | undefined>(
          ['lastSyncDates', brandId],
          (prev) => ({ ...(prev || {}), [provider]: new Date() })
        );
        if (provider === 'merchant' && (result.imported === 0 || result.imported == null)) {
          toast.info(
            'GMC: sync ολοκληρώθηκε — 0 SKUs με benchmark. Έλεγξε GTIN στο feed και Price Competitiveness στο Merchant Center.'
          );
        } else {
          toast.success(`Εισήχθησαν ${result.imported} ${label}`);
        }
        queryClient.invalidateQueries({ queryKey: ['campaigns', brandId] });
        queryClient.invalidateQueries({ queryKey: ['connectorsSummary', brandId] });
        queryClient.invalidateQueries({ queryKey: ['lastSyncDates', brandId] });
        if (provider === 'google_ads') {
          queryClient.invalidateQueries({ queryKey: ['search_intelligence', brandId] });
        }
        if (provider === 'merchant') queryClient.invalidateQueries({ queryKey: ['priceBenchmarks', brandId] });
        if (['shopify', 'woocommerce', 'opencart', 'magento'].includes(provider)) {
          // Force immediate refetch so #ecommerce reflects latest sync right away
          queryClient.removeQueries({ queryKey: ['ecommerce_summary', brandId] });
          queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] });
        }
        fetchStates();
      } else {
        toast.error(result.error || 'Sync failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Σφάλμα sync';
      toast.error(msg);
      console.error('[ConnectorsPanel] connectorSync failed:', err);
    } finally {
      markSyncEnd(provider);
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          brandId,
          provider: accountPickerFor,
          accountId: account.id,
          accountName: account.name,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
      toast.error('Σφάλμα επιλογής λογαριασμού');
      console.error(err);
    } finally {
      setConfirmingAccount(false);
    }
  };

  if (!brandId) return null;

  const pendingState = accountPickerFor ? states[accountPickerFor] : null;

  return (
    <>
      {accountPickerFor && pendingState?.pendingAccountSelection && (
        <AccountPickerModal
          accounts={pendingState.availableAccounts || []}
          brandName={brandName}
          provider={accountPickerFor}
          onConfirm={handleConfirmAccount}
          onCancel={() => setAccountPickerFor(null)}
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
                Σύνδεσε Ad Platforms & E-shop για αυτόματη εισαγωγή δεδομένων (23:00)
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

          {loading ? (
            <div className="py-8 flex justify-center">
              <Spinner size="md" label="Φόρτωση connectors..." />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CONNECTORS.map((conn) => {
                const state = states[conn.id] || { connected: false };
                const isConnected = state.connected;
                const isPending = !!state.pendingAccountSelection;
                const isSyncing = syncingProviders.has(conn.id);
                const isConnecting = connecting === conn.id;

                return (
                  <div
                    key={conn.id}
                    className={`rounded-xl border-2 p-5 transition-all ${
                      conn.comingSoon
                        ? 'bg-gray-50 border-gray-200 opacity-70'
                        : isConnected
                        ? `${conn.bgColor} ${conn.borderColor}`
                        : isPending
                        ? 'bg-amber-50 border-amber-300'
                        : 'bg-white border-[#E5E5E5] hover:border-[#D1D5DB]'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{conn.icon}</span>
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
                        <CheckCircle2 size={20} className="text-green-500 flex-shrink-0" />
                      )}
                      {isPending && (
                        <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
                      )}
                    </div>

                    {isPending && (
                      <p className="mb-3 text-xs text-amber-700 font-medium">
                        Απαιτείται επιλογή διαφημιστικού λογαριασμού
                      </p>
                    )}

                    {isConnected && (
                      <div className="mb-3 text-xs text-[#6B7280] space-y-1">
                        {conn.id === 'google_ads' && state.customerName && (
                          <p>{state.customerName} ({state.customerId})</p>
                        )}
                        {conn.id === 'meta' && state.adAccountNames && (
                          <p>{state.adAccountNames.join(', ')}</p>
                        )}
                        {conn.id === 'merchant' && (state as any).merchantName && (
                          <p>{(state as any).merchantName} ({(state as any).merchantId})</p>
                        )}
                        {conn.id === 'ga4' && (state as any).propertyName && (
                          <p>{(state as any).propertyName} ({(state as any).propertyId})</p>
                        )}
                        {conn.id === 'shopify' && (state as any).shopName && (
                          <p>{(state as any).shopName} ({(state as any).shopDomain})</p>
                        )}
                        {conn.id === 'woocommerce' && (state as any).shopName && (
                          <p>{(state as any).shopName}</p>
                        )}
                        {conn.id === 'opencart' && (state as any).shopName && (
                          <p>{(state as any).shopName}</p>
                        )}
                        {conn.id === 'magento' && (state as any).shopName && (
                          <p>{(state as any).shopName}</p>
                        )}
                        {(() => {
                          const d = coerceToDate(lastSyncDates[conn.id] as unknown);
                          return d ? (
                            <p className="text-[#9CA3AF]">
                              Τελευταίο sync:{' '}
                              {d.toLocaleDateString('el-GR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          ) : null;
                        })()}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      {conn.comingSoon ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled
                          className="w-full cursor-not-allowed"
                        >
                          Σύντομα διαθέσιμο
                        </Button>
                      ) : isPending ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setAccountPickerFor(conn.id)}
                          disabled={!canManageConnectors}
                          className="w-full"
                          title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                        >
                          <Building2 size={14} className="mr-1" />
                          Επιλογή λογαριασμού
                        </Button>
                      ) : isConnected ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleSync(conn.id)}
                            disabled={isSyncing || !canManageConnectors}
                            className="flex-1"
                            title={!canManageConnectors ? 'Μόνο ιδιοκτήτης ή διαχειριστής' : undefined}
                          >
                            {isSyncing ? (
                              <Spinner size="sm" className="mr-1" />
                            ) : (
                              <RefreshCw size={14} className="mr-1" />
                            )}
                            {isSyncing ? 'Syncing...' : 'Sync τώρα'}
                          </Button>
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
          )}

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

          <p className="text-xs text-[#9CA3AF] mt-4">
            Κάθε brand συνδέεται με τους δικούς του λογαριασμούς. Τα credentials αποθηκεύονται ασφαλώς στο Firebase.
          </p>
        </div>
      </Card>
    </>
  );
}
