import { useState, useEffect, useCallback } from 'react';
import { useBrand, useAuth } from '../../hooks';
import { auth } from '../../config/firebase';
import { FirestoreService } from '../../services/firestore';
import { Card, Button, Spinner, useToast } from '../common';
import {
  Link2,
  Unlink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

interface ConnectorState {
  connected: boolean;
  connectedAt?: any;
  customerIds?: string[];
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

export function ConnectorsPanel() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const brandId = currentBrand?.id ?? null;
  const toast = useToast();

  const [states, setStates] = useState<Record<string, ConnectorState>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const fetchStates = useCallback(async () => {
    if (!brandId) return;
    try {
      const doc = await FirestoreService.getDocument('connectors', brandId);
      if (doc) {
        const data = doc as Record<string, any>;
        setStates({
          google_ads: data.google_ads || { connected: false },
          meta: data.meta || { connected: false },
        });
      } else {
        setStates({ google_ads: { connected: false }, meta: { connected: false } });
      }
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
        toast.success(`${connector === 'google_ads' ? 'Google Ads' : 'Meta'} συνδέθηκε επιτυχώς!`);
        fetchStates();
      } else if (connector && status === 'error') {
        toast.error(`Σφάλμα σύνδεσης: ${params.get('message') || 'Unknown'}`);
      }
      // Clean URL
      window.location.hash = 'data';
    }
  }, [toast, fetchStates]);

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
        body: JSON.stringify({
          brandId,
          provider,
          redirectUri: callbackUrl,
        }),
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

  if (!brandId) return null;

  return (
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
              const isSyncing = syncing === conn.id;
              const isConnecting = connecting === conn.id;
              const isExpired = state.expiresAt ? state.expiresAt < Date.now() : false;

              return (
                <div
                  key={conn.id}
                  className={`rounded-xl border-2 p-5 transition-all ${
                    isConnected
                      ? `${conn.bgColor} ${conn.borderColor}`
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
                    {isConnected && isExpired && (
                      <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
                    )}
                  </div>

                  {isConnected && (
                    <div className="mb-3 text-xs text-[#6B7280] space-y-1">
                      {conn.id === 'google_ads' && state.customerIds && (
                        <p>{state.customerIds.length} customer account(s)</p>
                      )}
                      {conn.id === 'meta' && state.adAccountNames && (
                        <p>{state.adAccountNames.length} ad account(s): {state.adAccountNames.join(', ')}</p>
                      )}
                      {isExpired && (
                        <p className="text-amber-600 font-medium">Token expired — reconnect required</p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    {isConnected ? (
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
          Τα credentials αποθηκεύονται ασφαλώς. Ρυθμίστε <code>GOOGLE_ADS_CLIENT_ID</code>, <code>GOOGLE_ADS_CLIENT_SECRET</code>,
          <code> GOOGLE_ADS_DEVELOPER_TOKEN</code>, <code>META_APP_ID</code>, <code>META_APP_SECRET</code> στο Cloud Functions environment.
        </p>
      </div>
    </Card>
  );
}
