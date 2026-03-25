import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, doc, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { useBrand } from '../../hooks';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
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
  ShoppingCart,
  ArrowUp,
  ArrowDown,
  BarChart3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_URL ||
  'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net';

// ── Types ────────────────────────────────────────────────

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

type Tab = 'pricing' | 'ads';

// ── Data fetchers ────────────────────────────────────────

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

// ── Main Component ───────────────────────────────────────

export function CompetitorInsights() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('pricing');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPageId, setNewPageId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);

  // Price benchmarks
  const { benchmarks, isLoading: benchmarksLoading, count: benchmarkCount, aboveMarket, belowMarket, avgDiff } = usePriceBenchmarks();

  // Competitor ads
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
    onError: () => {
      toast.error('Σφάλμα κατά την προσθήκη ανταγωνιστή');
    },
  });

  const removeCompetitor = useCallback(
    async (pageId: string) => {
      if (!brandId || !settings) return;
      if (!confirm('Αφαίρεση ανταγωνιστή;')) return;
      try {
        const updated: CompetitorSettings = {
          ...settings,
          competitors: settings.competitors.filter((c) => c.pageId !== pageId),
        };
        await saveSettings(brandId, updated);
        queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
        toast.success('Αφαιρέθηκε');
      } catch {
        toast.error('Σφάλμα κατά την αφαίρεση ανταγωνιστή');
      }
    },
    [brandId, settings, queryClient, toast]
  );

  const handleSync = async (provider: 'merchant' | 'competitor') => {
    if (!brandId) return;
    setSyncing(provider);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandId, provider }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) {
        if (provider === 'merchant') {
          toast.success(`Ενημερώθηκαν ${result.imported} SKU benchmarks`);
          queryClient.invalidateQueries({ queryKey: ['priceBenchmarks', brandId] });
        } else {
          toast.success(`Βρέθηκαν ${result.totalAds} ads (${result.newAds} νέες)`);
          queryClient.invalidateQueries({ queryKey: ['competitorAds', brandId] });
          queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
        }
      } else {
        toast.error(result.error || 'Sync failed');
      }
    } catch {
      toast.error(`Σφάλμα sync ${provider === 'merchant' ? 'benchmarks' : 'ανταγωνιστών'}`);
    } finally {
      setSyncing(null);
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

  // Benchmark sorting / filtering
  const [benchmarkSearch, setBenchmarkSearch] = useState('');
  const [benchmarkSort, setBenchmarkSort] = useState<'diff' | 'price' | 'name'>('diff');

  const filteredBenchmarks = useMemo(() => {
    let list = [...benchmarks];
    if (benchmarkSearch) {
      const q = benchmarkSearch.toLowerCase();
      list = list.filter(
        (b) => b.title.toLowerCase().includes(q) || b.productId.toLowerCase().includes(q) || b.gtin.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (benchmarkSort === 'diff') return b.priceDiff - a.priceDiff;
      if (benchmarkSort === 'price') return b.yourPrice - a.yourPrice;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [benchmarks, benchmarkSearch, benchmarkSort]);

  if (!brandId) return null;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'pricing', label: 'Price Benchmarks (GMC)', count: benchmarkCount },
    { id: 'ads', label: 'Ad Monitoring (Meta)', count: ads.length },
  ];

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
            Price benchmarking (Google Merchant Center) & Ad monitoring (Meta Ad Library)
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#F3F4F6] p-1 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-white text-[#111827] shadow-sm'
                : 'text-[#6B7280] hover:text-[#374151]'
            }`}
          >
            {tab.id === 'pricing' ? <ShoppingCart size={15} /> : <Eye size={15} />}
            {tab.label}
            {(tab.count ?? 0) > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                activeTab === tab.id ? 'bg-[var(--nts-accent)] text-white' : 'bg-[#E5E7EB] text-[#6B7280]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════ PRICING TAB ════════════════ */}
      {activeTab === 'pricing' && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <KpiBox
              label="SKUs με benchmark"
              value={String(benchmarkCount)}
              tooltip="Πλήθος SKUs με δεδομένα τιμών αγοράς από Google Merchant Center."
              icon={<ShoppingCart size={18} />}
              color="#6366F1"
            />
            <KpiBox
              label="Πάνω από αγορά"
              value={String(aboveMarket)}
              tooltip="SKUs με τιμή ακριβότερη από τη μέση αγοράς."
              icon={<ArrowUp size={18} />}
              color="#EF4444"
            />
            <KpiBox
              label="Κάτω από αγορά"
              value={String(belowMarket)}
              tooltip="SKUs με τιμή φθηνότερη από τη μέση αγοράς."
              icon={<ArrowDown size={18} />}
              color="#22C55E"
            />
            <KpiBox
              label="Μέση απόκλιση"
              value={`${avgDiff > 0 ? '+' : ''}${avgDiff}%`}
              tooltip="Μέσος όρος τιμολογιακής απόκλισης σε σχέση με benchmark. Θετικό = ακριβότεροι."
              icon={<BarChart3 size={18} />}
              color={avgDiff > 0 ? '#EF4444' : '#22C55E'}
            />
            <KpiBox
              label="Τελ. ενημέρωση"
              value={benchmarks.length > 0 ? new Date(benchmarks[0].updatedAt).toLocaleDateString('el-GR') : '—'}
              tooltip="Ημερομηνία τελευταίου sync με Google Merchant Center."
              icon={<Calendar size={18} />}
              color="#8B5CF6"
            />
          </div>

          {/* Sync + Filters */}
          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-[#1A1A1A]">Price Benchmarks — Google Merchant Center</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={benchmarkSort}
                    onChange={(e) => setBenchmarkSort(e.target.value as any)}
                    className="px-3 py-1.5 border border-[#D1D5DB] rounded-lg text-xs bg-white focus:ring-2 focus:ring-[var(--nts-accent)]"
                  >
                    <option value="diff">Ταξινόμηση: Απόκλιση ↓</option>
                    <option value="price">Ταξινόμηση: Τιμή ↓</option>
                    <option value="name">Ταξινόμηση: Όνομα A-Z</option>
                  </select>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={benchmarkSearch}
                      onChange={(e) => setBenchmarkSearch(e.target.value)}
                      placeholder="Αναζήτηση SKU..."
                      className="pl-8 pr-3 py-1.5 bg-[#F5F5F5] border border-transparent rounded-lg text-xs focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all w-48"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSync('merchant')}
                    disabled={syncing !== null}
                  >
                    {syncing === 'merchant' ? <Spinner size="sm" className="mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                    Sync GMC
                  </Button>
                </div>
              </div>

              {benchmarksLoading ? (
                <div className="py-8 flex justify-center">
                  <Spinner size="md" label="Φόρτωση benchmarks..." />
                </div>
              ) : benchmarkCount === 0 ? (
                <div className="text-center py-10">
                  <ShoppingCart size={40} className="mx-auto text-[#D1D5DB] mb-3" />
                  <p className="text-sm text-[#9CA3AF] mb-1">Δεν υπάρχουν δεδομένα benchmarking.</p>
                  <p className="text-xs text-[#D1D5DB]">Συνδέστε Google Merchant Center από τις Ρυθμίσεις Δεδομένων και πατήστε "Sync GMC".</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-[#F9FAFB] z-10">
                      <tr className="text-xs text-[#6B7280] uppercase tracking-wider">
                        <th className="px-3 py-2.5 font-medium">Προϊόν</th>
                        <th className="px-3 py-2.5 font-medium text-right">Η τιμή σας</th>
                        <th className="px-3 py-2.5 font-medium text-right">Benchmark</th>
                        <th className="px-3 py-2.5 font-medium text-right">Απόκλιση</th>
                        <th className="px-3 py-2.5 font-medium hidden lg:table-cell">GTIN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredBenchmarks.map((b) => (
                        <BenchmarkRow key={b.productId} item={b} />
                      ))}
                    </tbody>
                  </table>
                  {filteredBenchmarks.length === 0 && benchmarkSearch && (
                    <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ════════════════ ADS TAB ════════════════ */}
      {activeTab === 'ads' && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                    <Plus size={14} className="mr-1" />
                    Προσθήκη
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSync('competitor')}
                    disabled={syncing !== null || competitors.length === 0}
                  >
                    {syncing === 'competitor' ? <Spinner size="sm" className="mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                    Scan τώρα
                  </Button>
                </div>
              </div>

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
              ) : ads.length === 0 ? (
                <p className="text-sm text-[#9CA3AF] text-center py-8">Δεν υπάρχουν δεδομένα. Προσθέστε ανταγωνιστές και πατήστε "Scan τώρα".</p>
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
        </>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

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

function BenchmarkRow({ item }: { item: { productId: string; title: string; gtin: string; yourPrice: number; benchmarkPrice: number; priceDiff: number; currency: string } }) {
  const diffColor = item.priceDiff > 5 ? '#EF4444' : item.priceDiff < -5 ? '#22C55E' : '#6B7280';
  const diffBg = item.priceDiff > 5 ? '#FEF2F2' : item.priceDiff < -5 ? '#F0FDF4' : '#F9FAFB';

  return (
    <tr className="hover:bg-[#FAFAFA] transition-colors">
      <td className="px-3 py-2.5">
        <p className="text-sm font-medium text-[#111827] line-clamp-1 max-w-xs">{item.title || item.productId}</p>
        <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">{item.productId}</p>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-mono text-[#1A1A1A]">€{item.yourPrice.toFixed(2)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-mono text-[#6B7280]">
          {item.benchmarkPrice > 0 ? `€${item.benchmarkPrice.toFixed(2)}` : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {item.benchmarkPrice > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ color: diffColor, backgroundColor: diffBg }}
          >
            {item.priceDiff > 0 ? <ArrowUp size={11} /> : item.priceDiff < 0 ? <ArrowDown size={11} /> : null}
            {item.priceDiff > 0 ? '+' : ''}{item.priceDiff}%
          </span>
        ) : (
          <span className="text-[10px] text-[#9CA3AF]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <span className="text-[11px] font-mono text-[#9CA3AF]">{item.gtin || '—'}</span>
      </td>
    </tr>
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
