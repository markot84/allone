import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBrand, useAuth } from '../../hooks';
import { auth } from '../../config/firebase';
import { getLastImportDates } from '../../services/import';
import { FirestoreService } from '../../services/firestore';
import { Card, Button, Spinner, useToast } from '../common';
import {
  Link2,
  Unlink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Building2,
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

interface ConnectorConfig {
  id: 'google_ads' | 'meta';
  name: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
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
  },
  {
    id: 'meta',
    name: 'Meta (Facebook / Instagram)',
    description: 'Αυτόματη εισαγωγή campaigns, spend, conversions, ROAS',
    icon: '📘',
    color: '#1877F2',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
  },
];

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_URL ||
  'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net';

// ─── Account Picker Modal ────────────────────────────────────────

function AccountPickerModal({
  accounts,
  brandName,
  onConfirm,
  onCancel,
  loading,
}: {
  accounts: AdAccount[];
  brandName: string;
  onConfirm: (account: AdAccount) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<AdAccount | null>(accounts[0] ?? null);
  const [manualId, setManualId] = useState('');
  const manualMode = accounts.length === 0;

  const handleConfirm = () => {
    if (manualMode) {
      const id = manualId.trim().replace(/-/g, '');
      if (id) onConfirm({ id, name: `Account ${id}` });
    } else if (selected) {
      onConfirm(selected);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div style={{ maxWidth: '440px', width: '100%' }} className="rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[#F3F4F6]">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50">
            <Building2 size={20} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-[#1A1A1A] text-sm">Επιλογή Διαφημιστικού Λογαριασμού</h3>
            <p className="text-xs text-[#6B7280]">για το brand <strong>{brandName}</strong></p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {manualMode ? (
            <div>
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4">
                <span className="text-amber-500 text-sm mt-0.5">⚠</span>
                <p className="text-xs text-amber-700">
                  Εισάγετε το ID του <strong>διαφημιστικού λογαριασμού</strong> (sub-account), <strong>όχι</strong> του Manager Account (MCC).
                </p>
              </div>
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="π.χ. 123-456-7890"
                style={{ width: '100%' }}
                className="rounded-lg border border-[#E5E7EB] px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-[#F9FAFB]"
              />
              <p className="text-xs text-[#9CA3AF] mt-2">Google Ads → επιλογή sub-account → Ρυθμίσεις → Customer ID</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#6B7280] mb-3">
                Επίλεξε τον λογαριασμό για το brand:
              </p>
              <div className="space-y-2" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                {accounts.map((acc) => (
                  <label
                    key={acc.id}
                    className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer transition-all ${
                      selected?.id === acc.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="adAccount"
                      value={acc.id}
                      checked={selected?.id === acc.id}
                      onChange={() => setSelected(acc)}
                      className="accent-indigo-600 flex-shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-[#1A1A1A]">{acc.name}</p>
                      <p className="text-xs text-[#9CA3AF]">{acc.id}</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-5">
          <Button variant="secondary" size="sm" onClick={onCancel} className="flex-1" disabled={loading}>
            Άκυρο
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={(manualMode ? !manualId.trim() : !selected) || loading}
            className="flex-1"
          >
            {loading ? <Spinner size="sm" className="mr-1" /> : null}
            {loading ? 'Αποθήκευση...' : 'Επιβεβαίωση'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function ConnectorsPanel() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const brandId = currentBrand?.id ?? null;
  const brandName = currentBrand?.name ?? 'Brand';
  const toast = useToast();

  const [states, setStates] = useState<Record<string, ConnectorState>>({});
  const [lastSyncDates, setLastSyncDates] = useState<Record<string, Date>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  const [confirmingAccount, setConfirmingAccount] = useState(false);

  const fetchStates = useCallback(async () => {
    if (!brandId) return;
    try {
      const [doc, dates] = await Promise.all([
        FirestoreService.getDocument('connectors', brandId),
        getLastImportDates(brandId),
      ]);
      if (doc) {
        const data = doc as Record<string, any>;
        setStates({
          google_ads: data.google_ads || { connected: false },
          meta: data.meta || { connected: false },
        });
      } else {
        setStates({ google_ads: { connected: false }, meta: { connected: false } });
      }
      // Map source keys to connector ids
      setLastSyncDates({
        google_ads: dates['google_ads_api'] || dates['campaigns'],
        meta: dates['meta_api'] || dates['campaigns'],
      } as Record<string, Date>);
    } catch {
      setStates({ google_ads: { connected: false }, meta: { connected: false } });
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    fetchStates();
  }, [fetchStates]);

  // Listen for OAuth callback results via URL hash params
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('connector=')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const connector = params.get('connector');
      const status = params.get('status');
      if (connector && status === 'success') {
        // Clear hash first, then reload so Firestore state is fresh
        history.replaceState(null, '', window.location.pathname + '#data');
        window.location.reload();
      } else if (connector && status === 'error') {
        toast.error(`Σφάλμα σύνδεσης: ${params.get('message') || 'Unknown'}`);
        history.replaceState(null, '', window.location.pathname + '#data');
      }
    }
  }, [toast, fetchStates]);

  // Auto-open picker if pending
  useEffect(() => {
    const pendingProvider = Object.entries(states).find(
      ([, s]) => s.pendingAccountSelection
    )?.[0];
    if (pendingProvider) setAccountPickerFor(pendingProvider);
  }, [states]);

  const handleConnect = async (provider: ConnectorConfig['id']) => {
    if (!brandId || !user) return;
    setConnecting(provider);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const callbackUrl = `${FUNCTIONS_BASE}/connectorCallback`;

      const res = await fetch(`${FUNCTIONS_BASE}/connectorAuth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ brandId, provider, redirectUri: callbackUrl }),
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

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Αποσυνδέθηκε');
      await fetchStates();
    } catch (err) {
      toast.error('Σφάλμα αποσύνδεσης');
      console.error(err);
    }
  };

  const handleSync = async (provider: ConnectorConfig['id']) => {
    if (!brandId || !user) return;
    setSyncing(provider);

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
        toast.success(`Εισήχθησαν ${result.imported} campaigns`);
        queryClient.invalidateQueries({ queryKey: ['campaigns', brandId] });
        fetchStates();
      } else {
        toast.error(result.error || 'Sync failed');
      }
    } catch (err) {
      toast.error('Σφάλμα sync');
      console.error(err);
    } finally {
      setSyncing(null);
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

      toast.success(`Λογαριασμός "${account.name}" επιλέχθηκε για αυτό το brand`);
      setAccountPickerFor(null);
      await fetchStates();
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
          onConfirm={handleConfirmAccount}
          onCancel={() => setAccountPickerFor(null)}
          loading={confirmingAccount}
        />
      )}

      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] flex items-center gap-2">
                <Link2 size={20} className="text-[var(--nts-accent)]" />
                Ad Platform Connectors
              </h3>
              <p className="text-sm text-[#6B7280] mt-0.5">
                Σύνδεσε Google Ads & Meta για αυτόματη εισαγωγή campaigns καθημερινά (06:00)
              </p>
            </div>
          </div>

          {loading ? (
            <div className="py-8 flex justify-center">
              <Spinner size="md" label="Φόρτωση connectors..." />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CONNECTORS.map((conn) => {
                const state = states[conn.id] || { connected: false };
                const isConnected = state.connected;
                const isPending = !!state.pendingAccountSelection;
                const isSyncing = syncing === conn.id;
                const isConnecting = connecting === conn.id;
                const isExpired = state.expiresAt ? state.expiresAt < Date.now() : false;

                return (
                  <div
                    key={conn.id}
                    className={`rounded-xl border-2 p-5 transition-all ${
                      isConnected
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
                          <h4 className="font-semibold text-[#1A1A1A]">{conn.name}</h4>
                          <p className="text-xs text-[#6B7280] mt-0.5">{conn.description}</p>
                        </div>
                      </div>
                      {isConnected && !isExpired && (
                        <CheckCircle2 size={20} className="text-green-500 flex-shrink-0" />
                      )}
                      {(isConnected && isExpired) || isPending ? (
                        <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
                      ) : null}
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
                        {lastSyncDates[conn.id] && (
                          <p className="text-[#9CA3AF]">
                            Τελευταίο sync: {lastSyncDates[conn.id].toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                        {isExpired && (
                          <p className="text-amber-600 font-medium">Token expired — reconnect required</p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      {isPending ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setAccountPickerFor(conn.id)}
                          className="w-full"
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
                            disabled={isSyncing || isExpired}
                            className="flex-1"
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
                          disabled={isConnecting}
                          className="w-full"
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

          <p className="text-xs text-[#9CA3AF] mt-4">
            Κάθε brand συνδέεται με τον δικό του διαφημιστικό λογαριασμό. Τα credentials αποθηκεύονται ασφαλώς.
          </p>
        </div>
      </Card>
    </>
  );
}
