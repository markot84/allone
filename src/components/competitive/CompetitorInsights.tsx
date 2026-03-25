import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, doc, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { useBrand } from '../../hooks';
import { Card, Button, Spinner, Badge, Tooltip, useToast } from '../common';
import {
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  Calendar,
  TrendingUp,
  Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_URL ||
  'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net';

interface CompetitorConfig {
  pageId: string;
  name: string;
  platform: string;
}

interface CompetitorAd {
  adId: string;
  competitorName: string;
  competitorPageId: string;
  adText: string;
  startDate: string;
  endDate?: string;
  platforms: string[];
  isActive: boolean;
  daysRunning: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface CompetitorSettings {
  competitors: CompetitorConfig[];
  lastSyncAt?: string;
}

async function fetchSettings(brandId: string): Promise<CompetitorSettings> {
  const docRef = doc(db, 'competitor_settings', brandId);
  const snap = await getDoc(docRef);
  if (snap.exists()) return snap.data() as CompetitorSettings;
  return { competitors: [] };
}

async function saveSettings(brandId: string, settings: CompetitorSettings) {
  const docRef = doc(db, 'competitor_settings', brandId);
  await setDoc(docRef, settings, { merge: true });
}

async function fetchAds(brandId: string): Promise<CompetitorAd[]> {
  const colRef = collection(db, 'competitor_ads', brandId, 'ads');
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => d.data() as CompetitorAd);
}

export function CompetitorInsights() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPageId, setNewPageId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['competitorSettings', brandId],
    queryFn: () => (brandId ? fetchSettings(brandId) : Promise.resolve({ competitors: [] })),
    enabled: !!brandId,
  });

  const { data: ads = [], isPending: adsLoading } = useQuery({
    queryKey: ['competitorAds', brandId],
    queryFn: () => (brandId ? fetchAds(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
  });

  const competitors = settings?.competitors ?? [];

  const addCompetitor = useMutation({
    mutationFn: async () => {
      if (!brandId) return;
      const updated: CompetitorSettings = {
        ...settings,
        competitors: [
          ...(settings?.competitors ?? []),
          { pageId: newPageId.trim(), name: newName.trim(), platform: 'meta' },
        ],
      };
      await saveSettings(brandId, updated);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
      toast.success('Ο ανταγωνιστής προστέθηκε');
      setNewName('');
      setNewPageId('');
      setShowAddForm(false);
    },
  });

  const removeCompetitor = useCallback(
    async (pageId: string) => {
      if (!brandId || !settings) return;
      if (!confirm('Αφαίρεση ανταγωνιστή;')) return;
      const updated: CompetitorSettings = {
        ...settings,
        competitors: settings.competitors.filter((c) => c.pageId !== pageId),
      };
      await saveSettings(brandId, updated);
      queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
      toast.success('Αφαιρέθηκε');
    },
    [brandId, settings, queryClient, toast]
  );

  const handleSync = async () => {
    if (!brandId) return;
    setSyncing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandId, provider: 'competitor' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) {
        toast.success(`Βρέθηκαν ${result.totalAds} ads (${result.newAds} νέες)`);
        queryClient.invalidateQueries({ queryKey: ['competitorAds', brandId] });
      } else {
        toast.error(result.error || 'Sync failed');
      }
    } catch (err) {
      toast.error('Σφάλμα sync ανταγωνιστών');
    } finally {
      setSyncing(false);
    }
  };

  const filteredAds = useMemo(() => {
    if (!searchQuery) return ads;
    const q = searchQuery.toLowerCase();
    return ads.filter(
      (a) =>
        a.competitorName.toLowerCase().includes(q) ||
        a.adText.toLowerCase().includes(q)
    );
  }, [ads, searchQuery]);

  const activeAds = ads.filter((a) => a.isActive);

  if (!brandId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A] flex items-center gap-2">
            <Search size={24} className="text-[var(--nts-accent)]" />
            Competitive Intelligence
          </h2>
          <p className="text-[#4A4A4A] mt-1">
            Παρακολούθηση διαφημιστικής δραστηριότητας ανταγωνιστών (Meta Ad Library)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSync}
            disabled={syncing || competitors.length === 0}
          >
            {syncing ? <Spinner size="sm" className="mr-1" /> : <RefreshCw size={14} className="mr-1" />}
            {syncing ? 'Scanning...' : 'Scan τώρα'}
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KpiBox
          label="Ανταγωνιστές"
          value={String(competitors.length)}
          tooltip="Πλήθος ανταγωνιστών υπό παρακολούθηση."
          icon={<Eye size={18} />}
          color="#6366F1"
        />
        <KpiBox
          label="Ενεργές ads"
          value={String(activeAds.length)}
          tooltip="Διαφημίσεις που τρέχουν τώρα σε Meta."
          icon={<Activity size={18} />}
          color="#22C55E"
        />
        <KpiBox
          label="Σύνολο ads"
          value={String(ads.length)}
          tooltip="Συνολικές διαφημίσεις ανταγωνιστών (ενεργές + ανενεργές)."
          icon={<TrendingUp size={18} />}
          color="#F59E0B"
        />
        <KpiBox
          label="Τελευταίο scan"
          value={settings?.lastSyncAt ? new Date(settings.lastSyncAt).toLocaleDateString('el-GR') : '—'}
          tooltip="Ημερομηνία τελευταίου ελέγχου Meta Ad Library."
          icon={<Calendar size={18} />}
          color="#8B5CF6"
        />
      </div>

      {/* Competitor Settings */}
      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-[#1A1A1A]">Ανταγωνιστές υπό παρακολούθηση</h3>
            <Button variant="secondary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
              <Plus size={14} className="mr-1" />
              Προσθήκη
            </Button>
          </div>

          {/* Add Form */}
          <AnimatePresence>
            {showAddForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-end gap-3 mb-4 p-4 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB]">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[#374151] mb-1">Όνομα ανταγωνιστή</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="π.χ. Competitor Brand"
                      className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-transparent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[#374151] mb-1">
                      Facebook Page ID
                      <Tooltip content="Βρείτε το Page ID μέσω facebook.com/page_name/about ή Graph API." size={12} />
                    </label>
                    <input
                      type="text"
                      value={newPageId}
                      onChange={(e) => setNewPageId(e.target.value)}
                      placeholder="π.χ. 123456789012345"
                      className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-transparent"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => addCompetitor.mutate()}
                    disabled={!newName.trim() || !newPageId.trim() || addCompetitor.isPending}
                  >
                    {addCompetitor.isPending ? <Spinner size="sm" /> : 'Αποθήκευση'}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Competitor List */}
          {competitors.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] text-center py-6">
              Δεν έχετε προσθέσει ανταγωνιστές. Πατήστε "Προσθήκη" για να ξεκινήσετε.
            </p>
          ) : (
            <div className="space-y-2">
              {competitors.map((c) => (
                <div
                  key={c.pageId}
                  className="flex items-center justify-between px-4 py-3 bg-white border border-[#E5E7EB] rounded-lg hover:border-[var(--nts-accent)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📘</span>
                    <div>
                      <p className="text-sm font-medium text-[#111827]">{c.name}</p>
                      <p className="text-xs text-[#9CA3AF]">Page ID: {c.pageId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#6B7280]">
                      {ads.filter((a) => a.competitorPageId === c.pageId).length} ads
                    </span>
                    <button
                      onClick={() => removeCompetitor(c.pageId)}
                      className="p-1.5 hover:bg-red-50 rounded-md text-[#9CA3AF] hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Ads Activity */}
      {ads.length > 0 && (
        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#1A1A1A]">Διαφημιστική δραστηριότητα</h3>
              <div className="relative w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Αναζήτηση..."
                  className="w-full pl-9 pr-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
                />
              </div>
            </div>

            {adsLoading ? (
              <div className="py-8 flex justify-center">
                <Spinner size="md" label="Φόρτωση ads..." />
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {filteredAds
                  .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
                  .map((ad) => (
                    <AdCard key={ad.adId} ad={ad} />
                  ))}
                {filteredAds.length === 0 && (
                  <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function KpiBox({
  label,
  value,
  tooltip,
  icon,
  color,
}: {
  label: string;
  value: string;
  tooltip: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card padding="md" hover>
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div>
          <p className="text-xs text-[#6B7280] flex items-center gap-1">
            {label}
            <Tooltip content={tooltip} size={11} />
          </p>
          <p className="text-lg font-bold text-[#1A1A1A] font-mono">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function AdCard({ ad }: { ad: CompetitorAd }) {
  return (
    <div className="p-4 border border-[#E5E7EB] rounded-lg hover:border-[#D1D5DB] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#111827]">{ad.competitorName}</span>
          <Badge variant={ad.isActive ? 'success' : 'default'} size="sm">
            {ad.isActive ? 'Ενεργή' : 'Ανενεργή'}
          </Badge>
        </div>
        <span className="text-xs text-[#9CA3AF]">{ad.daysRunning} ημέρες</span>
      </div>
      <p className="text-sm text-[#374151] line-clamp-3 mb-2">
        {ad.adText || <span className="italic text-[#9CA3AF]">Χωρίς κείμενο</span>}
      </p>
      <div className="flex items-center gap-4 text-xs text-[#9CA3AF]">
        <span>Έναρξη: {ad.startDate ? new Date(ad.startDate).toLocaleDateString('el-GR') : '—'}</span>
        {ad.endDate && <span>Λήξη: {new Date(ad.endDate).toLocaleDateString('el-GR')}</span>}
        {ad.platforms.length > 0 && <span>Platforms: {ad.platforms.join(', ')}</span>}
      </div>
    </div>
  );
}
