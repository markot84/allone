import { useState, useEffect, useCallback } from 'react';
import { Text } from '@primer/react';
import {
  ShieldIcon,
  OrganizationIcon,
  PulseIcon,
  TagIcon,
  InfoIcon,
  CheckCircleIcon,
  XCircleIcon,
  SyncIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon
} from '@primer/octicons-react';
import { FirestoreService } from '../../services/firestore';
import { db, auth, storage } from '../../config/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { SUPER_ADMIN_EMAILS, SUPPORT_EMAIL, APP_NAME } from '../../config/superAdmins';
import { getDefaultModuleEnabled, getEditionStatus, getModuleLabel } from '../../config/modules';
import type { Brand, ChangelogEntry, ModuleId } from '../../types';
import { useAuth } from '../../hooks';
import buildInfo from '../../generated/buildInfo.json';

type AdminTab = 'brands' | 'api' | 'changelog' | 'system';

interface ServiceStatus {
  name: string;
  status: 'ok' | 'error' | 'checking';
  latency?: number;
  lastChecked?: Date;
}

export function SuperAdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('brands');
  const { user } = useAuth();

  const tabs: { id: AdminTab; label: string; icon: typeof ShieldIcon }[] = [
    { id: 'brands', label: 'Brands', icon: OrganizationIcon },
    { id: 'api', label: 'API & Services', icon: PulseIcon },
    { id: 'changelog', label: 'Versions & Changelog', icon: TagIcon },
    { id: 'system', label: 'System Info', icon: InfoIcon },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <ShieldIcon size={24} />
          <Text as="h1" style={{ fontSize: 24, fontWeight: 700, color: 'var(--fgColor-default)' }}>
            Super Admin
          </Text>
        </div>
        <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14 }}>
          Διαχείριση εφαρμογής, brands, APIs και εκδόσεων
        </Text>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--borderColor-default, #d0d7de)',
        marginBottom: 24,
        overflowX: 'auto'
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 16px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--nts-accent, #d4854a)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--fgColor-default)' : 'var(--fgColor-muted)',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'brands' && <BrandsTab />}
      {activeTab === 'api' && <ApiStatusTab />}
      {activeTab === 'changelog' && <ChangelogTab userEmail={user?.email ?? ''} />}
      {activeTab === 'system' && <SystemInfoTab />}
    </div>
  );
}

/* ─── Brands Tab ─── */

function BrandsTab() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [userCounts, setUserCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [updatingBrandType, setUpdatingBrandType] = useState<string | null>(null);
  const [updatingModule, setUpdatingModule] = useState<string | null>(null);
  const [updatingHistory, setUpdatingHistory] = useState<string | null>(null);
  const [historyDrafts, setHistoryDrafts] = useState<Record<string, string>>({});
  const moduleToggleIds: ModuleId[] = ['ecommerce', 'analytics', 'competitive', 'roi', 'sales', 'accounts', 'markets', 'procurement'];

  useEffect(() => {
    async function load() {
      try {
        const allBrands = await FirestoreService.getDocuments<Brand>('brands');
        setBrands(allBrands.sort((a, b) => a.name.localeCompare(b.name)));

        const counts: Record<string, number> = {};
        const BATCH = 5;
        for (let i = 0; i < allBrands.length; i += BATCH) {
          const batch = allBrands.slice(i, i + BATCH);
          await Promise.all(
            batch.map(async (brand) => {
              const membersSnap = await getDocs(collection(db, 'brands', brand.id, 'members'));
              counts[brand.id] = membersSnap.size;
            })
          );
        }
        setUserCounts(counts);
      } catch (err) {
        console.error('Failed to load brands:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handlePlanChange = async (brandId: string, newPlan: 'growth' | 'enterprise') => {
    setUpdatingPlan(brandId);
    try {
      await FirestoreService.updateDocument('brands', brandId, { plan: newPlan });
      setBrands((prev) => prev.map((b) => (b.id === brandId ? { ...b, plan: newPlan } : b)));
    } catch (err) {
      console.error('Failed to update plan:', err);
    } finally {
      setUpdatingPlan(null);
    }
  };

  const handleBrandTypeChange = async (brandId: string, newType: 'B2B' | 'B2C') => {
    setUpdatingBrandType(brandId);
    try {
      await FirestoreService.updateDocument('brands', brandId, { type: newType });
      setBrands((prev) => prev.map((b) => (b.id === brandId ? { ...b, type: newType } : b)));
    } catch (err) {
      console.error('Failed to update brand type:', err);
    } finally {
      setUpdatingBrandType(null);
    }
  };

  const handleHistoryStartChange = async (brandId: string, isoDate: string) => {
    const trimmed = (isoDate || '').trim();
    const valid = !trimmed || /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    if (!valid) return;
    setUpdatingHistory(brandId);
    try {
      // Άδεια τιμή = remove cutoff (επιστροφή σε full history). Firestore: τίποτα να μην σταλεί ως undefined.
      const payload: Partial<Brand> = trimmed
        ? { historyStartDate: trimmed }
        : { historyStartDate: '' };
      await FirestoreService.updateDocument('brands', brandId, payload);
      setBrands((prev) => prev.map((b) => (b.id === brandId ? { ...b, historyStartDate: trimmed || undefined } : b)));
    } catch (err) {
      console.error('Failed to update historyStartDate:', err);
    } finally {
      setUpdatingHistory(null);
    }
  };

  const handleModuleToggle = async (brand: Brand, moduleId: ModuleId) => {
    const brandType = brand.type ?? 'B2C';
    if (getEditionStatus(moduleId, brandType) === 'hidden') return;
    const baseValue = brand.enabledModules?.[moduleId] ?? getDefaultModuleEnabled(moduleId, brandType);
    const nextValue = !baseValue;
    const nextOverrides = { ...(brand.enabledModules ?? {}) };
    if (nextValue === getDefaultModuleEnabled(moduleId, brandType)) {
      delete nextOverrides[moduleId];
    } else {
      nextOverrides[moduleId] = nextValue;
    }

    setUpdatingModule(`${brand.id}:${moduleId}`);
    try {
      await FirestoreService.updateDocument('brands', brand.id, { enabledModules: nextOverrides });
      setBrands((prev) => prev.map((item) => (
        item.id === brand.id ? { ...item, enabledModules: nextOverrides } : item
      )));
    } catch (err) {
      console.error('Failed to update modules:', err);
    } finally {
      setUpdatingModule(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgColor-muted)' }}>Φόρτωση brands...</div>;
  }

  return (
    <div>
      <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14, marginBottom: 16 }}>
        Συνολικά {brands.length} brand{brands.length !== 1 ? 's' : ''} στο σύστημα
      </Text>
      <div style={{ display: 'grid', gap: 12 }}>
        {brands.map((brand) => {
          const plan = brand.plan ?? 'growth';
          const isEnterprise = plan === 'enterprise';
          const brandKind = brand.type ?? 'B2C';
          return (
            <div
              key={brand.id}
              style={{
                padding: 16,
                borderRadius: 10,
                border: `1px solid ${isEnterprise ? 'rgba(139,92,246,0.3)' : 'var(--borderColor-default, #d0d7de)'}`,
                background: 'var(--bgColor-default, #fff)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {brand.logoUrl ? (
                  <img src={brand.logoUrl} alt={brand.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: 'var(--bgColor-accent-muted, #ddf4ff)',
                    display: 'grid', placeItems: 'center',
                    fontWeight: 700, fontSize: 14, color: 'var(--nts-accent)'
                  }}>
                    {brand.name[0]?.toUpperCase()}
                  </div>
                )}
                <div>
                  <Text as="div" weight="semibold" style={{ fontSize: 15 }}>{brand.name}</Text>
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                    {brandKind} · Created {new Date(brand.createdAt).toLocaleDateString('el-GR')}
                  </Text>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {/* Plan Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--borderColor-default, #d0d7de)' }}>
                  <button
                    type="button"
                    onClick={() => plan !== 'growth' && handlePlanChange(brand.id, 'growth')}
                    disabled={updatingPlan === brand.id}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: plan === 'growth' ? 700 : 400,
                      border: 'none',
                      cursor: updatingPlan === brand.id ? 'wait' : 'pointer',
                      background: plan === 'growth' ? '#22C55E' : 'var(--bgColor-default, #fff)',
                      color: plan === 'growth' ? '#fff' : 'var(--fgColor-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Growth
                  </button>
                  <button
                    type="button"
                    onClick={() => plan !== 'enterprise' && handlePlanChange(brand.id, 'enterprise')}
                    disabled={updatingPlan === brand.id}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: plan === 'enterprise' ? 700 : 400,
                      border: 'none',
                      borderLeft: '1px solid var(--borderColor-default, #d0d7de)',
                      cursor: updatingPlan === brand.id ? 'wait' : 'pointer',
                      background: plan === 'enterprise' ? '#8B5CF6' : 'var(--bgColor-default, #fff)',
                      color: plan === 'enterprise' ? '#fff' : 'var(--fgColor-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Enterprise
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--borderColor-default, #d0d7de)' }}>
                  <button
                    type="button"
                    onClick={() => brandKind !== 'B2C' && handleBrandTypeChange(brand.id, 'B2C')}
                    disabled={updatingBrandType === brand.id}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: brandKind === 'B2C' ? 700 : 400,
                      border: 'none',
                      cursor: updatingBrandType === brand.id ? 'wait' : 'pointer',
                      background: brandKind === 'B2C' ? '#d4854a' : 'var(--bgColor-default, #fff)',
                      color: brandKind === 'B2C' ? '#fff' : 'var(--fgColor-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    B2C
                  </button>
                  <button
                    type="button"
                    onClick={() => brandKind !== 'B2B' && handleBrandTypeChange(brand.id, 'B2B')}
                    disabled={updatingBrandType === brand.id}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: brandKind === 'B2B' ? 700 : 400,
                      border: 'none',
                      borderLeft: '1px solid var(--borderColor-default, #d0d7de)',
                      cursor: updatingBrandType === brand.id ? 'wait' : 'pointer',
                      background: brandKind === 'B2B' ? '#3b82f6' : 'var(--bgColor-default, #fff)',
                      color: brandKind === 'B2B' ? '#fff' : 'var(--fgColor-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    B2B
                  </button>
                </div>

                <div style={{ textAlign: 'center', minWidth: 40 }}>
                  <Text as="div" weight="semibold" style={{ fontSize: 16 }}>{userCounts[brand.id] || 0}</Text>
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>χρήστες</Text>
                </div>
              </div>
              <div style={{ width: '100%', borderTop: '1px solid var(--borderColor-muted, #e5e7eb)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                    Edition matrix (Growth/Enterprise · B2C/B2B από πάνω): defaults ανά <strong>{brandKind}</strong>, με granular overrides.
                  </Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <Text as="span" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                    History start (cutoff):
                  </Text>
                  <input
                    type="date"
                    value={historyDrafts[brand.id] ?? brand.historyStartDate ?? ''}
                    onChange={(e) => setHistoryDrafts((prev) => ({ ...prev, [brand.id]: e.target.value }))}
                    onBlur={(e) => {
                      const next = e.target.value;
                      const current = brand.historyStartDate ?? '';
                      if (next !== current) handleHistoryStartChange(brand.id, next);
                    }}
                    disabled={updatingHistory === brand.id}
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid var(--borderColor-default, #d0d7de)',
                      background: 'var(--bgColor-default, #fff)',
                      color: 'var(--fgColor-default)',
                      cursor: updatingHistory === brand.id ? 'wait' : 'text',
                    }}
                    title="Δεδομένα παλιότερα από αυτή τη ημερομηνία θα κρύβονται από όλες τις προβολές (e-shop, GA4, Top Products κ.λπ.). Άφησέ το κενό για πλήρες ιστορικό."
                  />
                  {brand.historyStartDate && (
                    <button
                      type="button"
                      onClick={() => handleHistoryStartChange(brand.id, '')}
                      disabled={updatingHistory === brand.id}
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        borderRadius: 6,
                        border: '1px solid var(--borderColor-default, #d0d7de)',
                        background: 'var(--bgColor-default, #fff)',
                        color: 'var(--fgColor-muted)',
                        cursor: updatingHistory === brand.id ? 'wait' : 'pointer',
                      }}
                    >
                      Καθαρισμός
                    </button>
                  )}
                  {updatingHistory === brand.id && (
                    <Text as="span" size="small" style={{ color: 'var(--fgColor-muted)' }}>Saving…</Text>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {moduleToggleIds.map((moduleId) => {
                    const label = getModuleLabel(moduleId, brandKind);
                    const status = getEditionStatus(moduleId, brandKind);
                    const hiddenEdition = status === 'hidden';
                    const enabled = hiddenEdition
                      ? false
                      : (brand.enabledModules?.[moduleId] ?? getDefaultModuleEnabled(moduleId, brandKind));
                    const pending = updatingModule === `${brand.id}:${moduleId}`;
                    const disabled = pending || hiddenEdition;
                    return (
                      <button
                        key={moduleId}
                        type="button"
                        onClick={() => !disabled && handleModuleToggle(brand, moduleId)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 999,
                          border: enabled ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(148,163,184,0.35)',
                          background: hiddenEdition ? 'rgba(148,163,184,0.04)' : enabled ? 'rgba(34,197,94,0.10)' : 'rgba(148,163,184,0.08)',
                          color: hiddenEdition ? '#94a3b8' : enabled ? '#15803d' : '#475569',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: disabled ? (pending ? 'wait' : 'not-allowed') : 'pointer',
                          opacity: hiddenEdition ? 0.75 : 1,
                        }}
                        title={hiddenEdition ? `Hidden για ${brandKind} — άλλαξε B2C/B2B για να ενεργοποιηθεί` : `Default για ${brandKind}: ${status}`}
                      >
                        {pending ? 'Updating...' : `${label}: ${enabled ? 'ON' : 'OFF'}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        {brands.length === 0 && (
          <Text as="p" style={{ color: 'var(--fgColor-muted)', textAlign: 'center', padding: 32 }}>
            Δεν υπάρχουν brands ακόμα.
          </Text>
        )}
      </div>
    </div>
  );
}

/* ─── API & Services Tab ─── */

function ApiStatusTab() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'Firebase Auth', status: 'checking' },
    { name: 'Cloud Firestore', status: 'checking' },
    { name: 'Firebase Storage', status: 'checking' },
  ]);
  const [checking, setChecking] = useState(false);

  const checkServices = useCallback(async () => {
    setChecking(true);
    const results: ServiceStatus[] = [];

    // Check Auth
    const authStart = performance.now();
    try {
      await auth.authStateReady();
      results.push({ name: 'Firebase Auth', status: 'ok', latency: Math.round(performance.now() - authStart), lastChecked: new Date() });
    } catch {
      results.push({ name: 'Firebase Auth', status: 'error', lastChecked: new Date() });
    }

    // Check Firestore
    const fsStart = performance.now();
    try {
      await getDoc(doc(db, '__health__', 'ping'));
      results.push({ name: 'Cloud Firestore', status: 'ok', latency: Math.round(performance.now() - fsStart), lastChecked: new Date() });
    } catch (err: any) {
      if (err?.code === 'permission-denied' || err?.code === 'not-found') {
        results.push({ name: 'Cloud Firestore', status: 'ok', latency: Math.round(performance.now() - fsStart), lastChecked: new Date() });
      } else {
        results.push({ name: 'Cloud Firestore', status: 'error', lastChecked: new Date() });
      }
    }

    // Check Storage
    const stStart = performance.now();
    try {
      void storage.app;
      results.push({ name: 'Firebase Storage', status: 'ok', latency: Math.round(performance.now() - stStart), lastChecked: new Date() });
    } catch {
      results.push({ name: 'Firebase Storage', status: 'error', lastChecked: new Date() });
    }

    setServices(results);
    setChecking(false);
  }, []);

  useEffect(() => {
    checkServices();
  }, [checkServices]);

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14 }}>
          Κατάσταση υπηρεσιών Firebase
        </Text>
        <button
          onClick={checkServices}
          disabled={checking}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6, border: '1px solid var(--borderColor-default)',
            background: 'var(--bgColor-default)', cursor: checking ? 'wait' : 'pointer',
            fontSize: 13, color: 'var(--fgColor-default)'
          }}
        >
          <SyncIcon size={14} className={checking ? 'anim-rotate' : ''} />
          {checking ? 'Έλεγχος...' : 'Επανέλεγχος'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {services.map((svc) => (
          <div
            key={svc.name}
            style={{
              padding: 16, borderRadius: 10,
              border: '1px solid var(--borderColor-default, #d0d7de)',
              background: 'var(--bgColor-default, #fff)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {svc.status === 'ok' && <CheckCircleIcon size={20} fill="#2da44e" />}
              {svc.status === 'error' && <XCircleIcon size={20} fill="#cf222e" />}
              {svc.status === 'checking' && <SyncIcon size={20} className="anim-rotate" />}
              <div>
                <Text as="div" weight="semibold" style={{ fontSize: 14 }}>{svc.name}</Text>
                {svc.lastChecked && (
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                    Τελευταίος έλεγχος: {svc.lastChecked.toLocaleTimeString('el-GR')}
                  </Text>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{
                padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                background: svc.status === 'ok' ? 'rgba(45,164,78,0.12)' : svc.status === 'error' ? 'rgba(207,34,46,0.12)' : 'rgba(0,0,0,0.06)',
                color: svc.status === 'ok' ? '#2da44e' : svc.status === 'error' ? '#cf222e' : 'var(--fgColor-muted)'
              }}>
                {svc.status === 'ok' ? 'Online' : svc.status === 'error' ? 'Offline' : 'Checking...'}
              </span>
              {svc.latency != null && (
                <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)', marginTop: 2 }}>
                  {svc.latency}ms
                </Text>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 20, padding: 16, borderRadius: 10,
        background: 'var(--bgColor-muted, #f6f8fa)',
        border: '1px solid var(--borderColor-default)'
      }}>
        <Text as="div" weight="semibold" size="small" style={{ marginBottom: 8, color: 'var(--fgColor-muted)' }}>
          Project Details
        </Text>
        <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <div><span style={{ color: 'var(--fgColor-muted)' }}>Project ID:</span> <code>{projectId}</code></div>
          <div>
            <span style={{ color: 'var(--fgColor-muted)' }}>Console: </span>
            <a href={`https://console.firebase.google.com/project/${projectId}`} target="_blank" rel="noreferrer"
              style={{ color: 'var(--nts-accent)' }}>
              Firebase Console
            </a>
          </div>
          <div>
            <span style={{ color: 'var(--fgColor-muted)' }}>Hosting: </span>
            <a href={`https://${projectId}.web.app`} target="_blank" rel="noreferrer"
              style={{ color: 'var(--nts-accent)' }}>
              {projectId}.web.app
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Build Info Panel ─── */

function BuildInfoPanel() {
  const [expanded, setExpanded] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const copyChangesForUsers = async () => {
    const lines = buildInfo.changes.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const text = `${APP_NAME} v${buildInfo.version} — Νέα Ενημέρωση\n\n${lines}\n\nΥποστήριξη: ${SUPPORT_EMAIL}`;
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div style={{
      borderRadius: 10, marginBottom: 16,
      border: '1px solid var(--borderColor-default)',
      background: 'var(--bgColor-default, #fff)',
      overflow: 'hidden'
    }}>
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%', padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: 'none', background: 'var(--bgColor-muted, #f6f8fa)',
          cursor: 'pointer', gap: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text as="span" size="small" weight="semibold" style={{ color: 'var(--fgColor-default)' }}>Τρέχον build</Text>
          <span style={{ padding: '1px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: 'rgba(212,133,74,0.12)', color: 'var(--nts-accent)' }}>
            v{buildInfo.version}
          </span>
          <Text as="span" size="small" style={{ color: 'var(--fgColor-muted)' }}>
            {buildInfo.commitHash} · {new Date(buildInfo.buildDate).toLocaleDateString('el-GR')}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '1px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
            background: 'rgba(45,164,78,0.1)', color: '#2da44e'
          }}>
            {buildInfo.changes.length} αλλαγές
          </span>
          <span style={{ fontSize: 12, color: 'var(--fgColor-muted)', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
        </div>
      </button>

      {/* Expanded: changes list + copy button */}
      {expanded && (
        <div style={{ padding: 16, borderTop: '1px solid var(--borderColor-default)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text as="span" size="small" weight="semibold" style={{ color: 'var(--fgColor-muted)' }}>
              Αλλαγές σε αυτό το build
            </Text>
            <button
              onClick={(e) => { e.stopPropagation(); copyChangesForUsers(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--borderColor-default)',
                background: copiedAll ? 'rgba(45,164,78,0.08)' : 'var(--bgColor-default)',
                cursor: 'pointer', fontSize: 12, fontWeight: 500,
                color: copiedAll ? '#2da44e' : 'var(--fgColor-default)'
              }}
            >
              {copiedAll ? <><CheckCircleIcon size={12} /> Αντιγράφηκε!</> : <><CopyIcon size={12} /> Αντιγραφή για χρήστες</>}
            </button>
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            {buildInfo.changes.map((change, i) => {
              const tagMatch = change.match(/^\[(.+?)\]\s*/);
              const tag = tagMatch ? tagMatch[1] : null;
              const text = tagMatch ? change.slice(tagMatch[0].length) : change;
              const dot = tag?.includes('Διόρθωση') ? '#cf222e' : tag?.includes('Αναδιαμόρφωση') ? '#8250df' : tag?.includes('Βελτίωση') ? '#78716C' : '#2da44e';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, lineHeight: 1.6, padding: '2px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0, marginTop: 6 }} />
                  <span style={{ color: 'var(--fgColor-default)' }}>{text}</span>
                </div>
              );
            })}
          </div>

          {/* Commits detail */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: 'var(--fgColor-muted)', cursor: 'pointer', userSelect: 'none' }}>
              Commits ({buildInfo.commits.length})
            </summary>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {buildInfo.commits.map((c) => (
                <div key={c.hash} style={{ display: 'flex', gap: 8, padding: '3px 0', color: 'var(--fgColor-muted)' }}>
                  <code style={{ fontSize: 11, color: 'var(--nts-accent)', flexShrink: 0 }}>{c.hash}</code>
                  <span>{c.message}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/* ─── Changelog Tab ─── */

function ChangelogTab({ userEmail }: { userEmail: string }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoSaved, setAutoSaved] = useState(false);
  const [form, setForm] = useState({ version: '', title: '', changes: '' });

  const loadEntries = useCallback(async () => {
    try {
      const docs = await FirestoreService.getDocuments<ChangelogEntry>('changelog');
      docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setEntries(docs);
      return docs;
    } catch (err) {
      console.error('Failed to load changelog:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-detect new build and save changelog entry
  useEffect(() => {
    if (autoSaved) return;
    loadEntries().then(async (docs) => {
      const currentVersion = buildInfo.version;
      const alreadyRecorded = docs.some((d) => d.version === currentVersion);
      if (!alreadyRecorded && buildInfo.changes.length > 0) {
        const now = new Date().toISOString();
        const firstCommitMsg = buildInfo.commits[0]?.message || '';
        const title = firstCommitMsg
          .replace(/^(feat|fix|refactor|chore)(\(.+?\))?:\s*/i, '')
          .split(',')[0]
          .trim() || `Build ${currentVersion}`;
        const docId = `v${currentVersion.replace(/\./g, '-')}-${Date.now()}`;
        await FirestoreService.setDocument('changelog', docId, {
          id: docId,
          version: currentVersion,
          title,
          changes: buildInfo.changes,
          date: buildInfo.buildDate,
          createdBy: `auto (${userEmail})`,
          createdAt: now,
        } as unknown as Record<string, unknown>);
        setAutoSaved(true);
        await loadEntries();
      }
    });
  }, [loadEntries, userEmail, autoSaved]);

  const handleSave = async () => {
    if (!form.version.trim() || !form.title.trim()) return;
    const changesArr = form.changes.split('\n').map((c) => c.trim()).filter(Boolean);
    const now = new Date().toISOString();

    if (editingId) {
      await FirestoreService.updateDocument('changelog', editingId, {
        version: form.version.trim(),
        title: form.title.trim(),
        changes: changesArr,
        date: now,
      });
    } else {
      const docId = `v${form.version.trim().replace(/\./g, '-')}-${Date.now()}`;
      await FirestoreService.setDocument('changelog', docId, {
        id: docId,
        version: form.version.trim(),
        title: form.title.trim(),
        changes: changesArr,
        date: now,
        createdBy: userEmail,
        createdAt: now,
      } as unknown as Record<string, unknown>);
    }

    setForm({ version: '', title: '', changes: '' });
    setShowForm(false);
    setEditingId(null);
    await loadEntries();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Διαγραφή αυτής της εγγραφής;')) return;
    await FirestoreService.deleteDocument('changelog', id);
    await loadEntries();
  };

  const handleEdit = (entry: ChangelogEntry) => {
    setForm({ version: entry.version, title: entry.title, changes: entry.changes.join('\n') });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const copyToClipboard = async (entry: ChangelogEntry) => {
    const text = `${APP_NAME} v${entry.version}\n${entry.title}\n\n${entry.changes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nΥποστήριξη: ${SUPPORT_EMAIL}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgColor-muted)' }}>Φόρτωση changelog...</div>;
  }

  return (
    <div>
      {/* Current Build Info - Expandable */}
      <BuildInfoPanel />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14 }}>
          Ιστορικό εκδόσεων και ενημερώσεων
        </Text>
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setForm({
                version: buildInfo.version,
                title: buildInfo.commits[0]?.message?.replace(/^(feat|fix|refactor|chore)(\(.+?\))?:\s*/i, '').split(',')[0].trim() || '',
                changes: buildInfo.changes.join('\n'),
              });
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 6,
              border: 'none', background: 'var(--nts-accent, #d4854a)',
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600
            }}
          >
            <PlusIcon size={14} />
            Νέα Έκδοση
          </button>
        )}
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{
          padding: 20, borderRadius: 10, marginBottom: 20,
          border: '1px solid var(--borderColor-default)',
          background: 'var(--bgColor-muted, #f6f8fa)'
        }}>
          <Text as="div" weight="semibold" style={{ marginBottom: 12, fontSize: 15 }}>
            {editingId ? 'Επεξεργασία Έκδοσης' : 'Νέα Έκδοση'}
          </Text>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--fgColor-muted)' }}>Version</label>
                <input
                  value={form.version}
                  onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                  placeholder="π.χ. 1.2.0"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid var(--borderColor-default)',
                    background: 'var(--bgColor-default)', fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--fgColor-muted)' }}>Τίτλος</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="π.χ. Super Admin & Changelog"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid var(--borderColor-default)',
                    background: 'var(--bgColor-default)', fontSize: 14
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--fgColor-muted)' }}>Αλλαγές (μία ανά γραμμή)</label>
              <textarea
                value={form.changes}
                onChange={(e) => setForm((f) => ({ ...f, changes: e.target.value }))}
                rows={5}
                placeholder={"Προστέθηκε Super Admin dashboard\nΒελτίωση sidebar navigation\nΔιόρθωση bug στο brand switching"}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: '1px solid var(--borderColor-default)',
                  background: 'var(--bgColor-default)', fontSize: 14,
                  resize: 'vertical', fontFamily: 'inherit'
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  border: '1px solid var(--borderColor-default)',
                  background: 'var(--bgColor-default)', cursor: 'pointer',
                  fontSize: 13, color: 'var(--fgColor-default)'
                }}
              >
                Ακύρωση
              </button>
              <button
                onClick={handleSave}
                disabled={!form.version.trim() || !form.title.trim()}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  border: 'none', background: 'var(--nts-accent, #d4854a)',
                  color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  opacity: (!form.version.trim() || !form.title.trim()) ? 0.5 : 1
                }}
              >
                {editingId ? 'Ενημέρωση' : 'Αποθήκευση'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Entries List */}
      <div style={{ display: 'grid', gap: 12 }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: 16, borderRadius: 10,
              border: '1px solid var(--borderColor-default, #d0d7de)',
              background: 'var(--bgColor-default, #fff)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{
                    padding: '1px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700,
                    background: 'rgba(212,133,74,0.12)', color: 'var(--nts-accent)'
                  }}>
                    v{entry.version}
                  </span>
                  <Text as="span" weight="semibold" style={{ fontSize: 15 }}>{entry.title}</Text>
                </div>
                <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                  {new Date(entry.date || entry.createdAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {entry.createdBy && ` · ${entry.createdBy}`}
                </Text>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => copyToClipboard(entry)}
                  title="Αντιγραφή για κοινοποίηση"
                  style={{
                    padding: 6, border: '1px solid var(--borderColor-default)',
                    borderRadius: 6, background: copiedId === entry.id ? 'rgba(45,164,78,0.12)' : 'var(--bgColor-default)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    color: copiedId === entry.id ? '#2da44e' : 'var(--fgColor-muted)'
                  }}
                >
                  {copiedId === entry.id ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />}
                </button>
                <button
                  onClick={() => handleEdit(entry)}
                  title="Επεξεργασία"
                  style={{
                    padding: 6, border: '1px solid var(--borderColor-default)',
                    borderRadius: 6, background: 'var(--bgColor-default)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    color: 'var(--fgColor-muted)'
                  }}
                >
                  <PencilIcon size={14} />
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  title="Διαγραφή"
                  style={{
                    padding: 6, border: '1px solid var(--borderColor-default)',
                    borderRadius: 6, background: 'var(--bgColor-default)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    color: 'var(--danger-fg, #cf222e)'
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
            {entry.changes.length > 0 && (
              <div style={{ display: 'grid', gap: 2 }}>
                {entry.changes.map((change, i) => {
                  const tagMatch = change.match(/^\[(.+?)\]\s*/);
                  const tag = tagMatch ? tagMatch[1] : null;
                  const text = tagMatch ? change.slice(tagMatch[0].length) : change;
                  const dot = tag?.includes('Διόρθωση') ? '#cf222e' : tag?.includes('Αναδιαμόρφωση') ? '#8250df' : tag?.includes('Βελτίωση') ? '#78716C' : '#2da44e';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, lineHeight: 1.6, padding: '2px 0' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0, marginTop: 6 }} />
                      <span>{text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--fgColor-muted)' }}>
            <TagIcon size={32} />
            <Text as="p" style={{ marginTop: 8, fontSize: 14 }}>
              Δεν υπάρχουν καταχωρίσεις ακόμα. Πατήστε "Νέα Έκδοση" για να ξεκινήσετε.
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── System Info Tab ─── */

function SystemInfoTab() {
  const [stats, setStats] = useState({ users: 0, brands: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [usersSnap, brandsSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'brands')),
        ]);
        setStats({ users: usersSnap.size, brands: brandsSnap.size });
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';

  const infoSections = [
    {
      title: 'Εφαρμογή',
      items: [
        { label: 'Όνομα', value: APP_NAME },
        { label: 'Version', value: `v${buildInfo.version} (${buildInfo.commitHash})` },
        { label: 'Build Date', value: new Date(buildInfo.buildDate).toLocaleString('el-GR') },
        { label: 'Project ID', value: projectId },
        { label: 'Environment', value: import.meta.env.MODE || 'development' },
        { label: 'Branch', value: buildInfo.branch },
      ]
    },
    {
      title: 'Στατιστικά',
      items: [
        { label: 'Συνολικοί χρήστες', value: loading ? '...' : String(stats.users) },
        { label: 'Συνολικά brands', value: loading ? '...' : String(stats.brands) },
      ]
    },
    {
      title: 'Super Admins',
      items: SUPER_ADMIN_EMAILS.map((email) => ({ label: 'Email', value: email }))
    },
    {
      title: 'Υποστήριξη',
      items: [
        { label: 'Email', value: SUPPORT_EMAIL },
      ]
    }
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {infoSections.map((section) => (
        <div
          key={section.title}
          style={{
            padding: 16, borderRadius: 10,
            border: '1px solid var(--borderColor-default, #d0d7de)',
            background: 'var(--bgColor-default, #fff)'
          }}
        >
          <Text as="div" weight="semibold" style={{ fontSize: 14, marginBottom: 10, color: 'var(--fgColor-muted)' }}>
            {section.title}
          </Text>
          <div style={{ display: 'grid', gap: 6 }}>
            {section.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0' }}>
                <span style={{ color: 'var(--fgColor-muted)' }}>{item.label}</span>
                <span style={{ fontWeight: 500 }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{
        padding: 16, borderRadius: 10,
        background: 'var(--bgColor-muted, #f6f8fa)',
        border: '1px solid var(--borderColor-default)'
      }}>
        <Text as="div" weight="semibold" size="small" style={{ marginBottom: 8, color: 'var(--fgColor-muted)' }}>
          Quick Links
        </Text>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Firebase Console', url: `https://console.firebase.google.com/project/${projectId}` },
            { label: 'Firestore', url: `https://console.firebase.google.com/project/${projectId}/firestore` },
            { label: 'Authentication', url: `https://console.firebase.google.com/project/${projectId}/authentication` },
            { label: 'Hosting', url: `https://console.firebase.google.com/project/${projectId}/hosting` },
            { label: 'Storage', url: `https://console.firebase.google.com/project/${projectId}/storage` },
          ].map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--borderColor-default)',
                background: 'var(--bgColor-default)', color: 'var(--nts-accent)',
                textDecoration: 'none', fontWeight: 500
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
