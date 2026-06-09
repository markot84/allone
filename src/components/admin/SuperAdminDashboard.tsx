import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  PencilIcon,
  PeopleIcon
} from '@primer/octicons-react';
import { FirestoreService } from '../../services/firestore';
import { MembersService } from '../../services/coordination';
import { db, auth, storage, PROJECT_ID } from '../../config/firebase';
import { collection, getDocs, doc, getDoc, limit, orderBy, query } from 'firebase/firestore';
import { SUPPORT_EMAIL, APP_NAME } from '../../config/superAdmins';
import { loadSuperAdmins, type SuperAdminsConfig } from '../../services/appConfig';
import { getDefaultModuleEnabled, getEditionStatus, getModuleLabel } from '../../config/modules';
import type { Brand, ChangelogEntry, ModuleId, BrandMemberRole, BrandDepartment } from '../../types';
import { ROLE_LABELS, DEPARTMENT_LABELS, normalizeBrandMemberRole } from '../../types';
import { useAuth } from '../../hooks';
import { clearAnalysisSnapshots } from '../../services/analysisSnapshotCache';
import buildInfo from '../../generated/buildInfo.json';
import { logger } from '../../utils/logger';

type AdminTab = 'brands' | 'users' | 'leads' | 'api' | 'changelog' | 'system';

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
    { id: 'users', label: 'Χρήστες', icon: PeopleIcon },
    { id: 'leads', label: 'Leads', icon: InfoIcon },
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
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'leads' && <LeadsTab />}
      {activeTab === 'api' && <ApiStatusTab />}
      {activeTab === 'changelog' && <ChangelogTab userEmail={user?.email ?? ''} />}
      {activeTab === 'system' && <SystemInfoTab />}
    </div>
  );
}

/* ─── Brands Tab ─── */

function BrandsTab() {
  const queryClient = useQueryClient();
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
        const allBrands = await FirestoreService.getDocuments<Brand>('brands', [], null, { forceServer: true });
        setBrands(allBrands.sort((a, b) => a.name.localeCompare(b.name)));
        setLoading(false);

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
        logger.error('Failed to load brands:', { err });
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
      logger.error('Failed to update plan:', { err });
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
      logger.error('Failed to update brand type:', { err });
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
      clearAnalysisSnapshots(brandId);
      queryClient.removeQueries({ queryKey: ['brandSyncVersion', brandId] });
      queryClient.invalidateQueries({ queryKey: ['ecommerceOrdersRaw', brandId] });
      queryClient.invalidateQueries({ queryKey: ['dataAnalysisOrdersRaw', brandId] });
      queryClient.invalidateQueries({ queryKey: ['catalogAlignmentDataAnalysis', brandId] });
    } catch (err) {
      logger.error('Failed to update historyStartDate:', { err });
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
      logger.error('Failed to update modules:', { err });
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

/* ─── Users Tab ─── */

interface AdminUserRow {
  id: string;
  email?: string;
  displayName?: string | null;
  createdAt?: unknown;
}

interface UserMembership {
  brandId: string;
  brandName: string;
  role: BrandMemberRole;
  department?: BrandDepartment;
}

function formatUserDate(value: unknown): string {
  if (!value) return '—';
  const maybeTimestamp = value as { toDate?: () => Date };
  const date = typeof maybeTimestamp?.toDate === 'function'
    ? maybeTimestamp.toDate()
    : new Date(value as string);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const MEMBERSHIP_ROLES: BrandMemberRole[] = ['owner', 'admin', 'member'];

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [memberships, setMemberships] = useState<Record<string, UserMembership[]>>({});
  const [superAdmins, setSuperAdmins] = useState<SuperAdminsConfig>({ uids: [], emails: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const isSuperAdmin = useCallback(
    (u: AdminUserRow) =>
      superAdmins.uids.includes(u.id) ||
      (!!u.email && superAdmins.emails.includes(u.email.toLowerCase())),
    [superAdmins]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersList, brandsList, sa] = await Promise.all([
        FirestoreService.getDocuments<AdminUserRow>('users'),
        FirestoreService.getDocuments<Brand>('brands'),
        loadSuperAdmins(),
      ]);
      setSuperAdmins(sa);

      // Map each user → the brands they belong to by reading every brand's
      // `members` subcollection via direct path. The collection-group rule for
      // `members` only authorizes a user's OWN memberships, but the nested
      // brands/{id}/members rule grants super admins read on each doc — so we
      // walk the brands (same batched pattern as BrandsTab) instead of one CG query.
      const byUser: Record<string, UserMembership[]> = {};
      const BATCH = 5;
      for (let i = 0; i < brandsList.length; i += BATCH) {
        const batch = brandsList.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (brand) => {
            try {
              const memSnap = await getDocs(collection(db, 'brands', brand.id, 'members'));
              for (const d of memSnap.docs) {
                const data = d.data() as { userId?: string; role?: unknown; department?: BrandDepartment };
                const userId = data.userId || d.id;
                if (!userId) continue;
                (byUser[userId] ??= []).push({
                  brandId: brand.id,
                  brandName: brand.name || brand.id,
                  role: normalizeBrandMemberRole(data.role),
                  department: data.department,
                });
              }
            } catch (memErr) {
              logger.error('Failed to load members for brand', { brandId: brand.id, err: memErr });
            }
          })
        );
      }
      for (const list of Object.values(byUser)) {
        list.sort((a, b) => a.brandName.localeCompare(b.brandName));
      }
      setMemberships(byUser);

      usersList.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
      setUsers(usersList);
    } catch (err) {
      logger.error('Failed to load users:', { err });
      setError(err instanceof Error ? err.message : 'Could not load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleSuperAdmin = async (u: AdminUserRow) => {
    if (u.id === currentUser?.uid) {
      alert('Δεν μπορείς να αφαιρέσεις τα δικά σου δικαιώματα super admin.');
      return;
    }
    const currentlySA = isSuperAdmin(u);
    const verb = currentlySA ? 'αφαίρεση' : 'παραχώρηση';
    if (!confirm(`Επιβεβαίωση ${verb} δικαιωμάτων super admin για ${u.email || u.id};`)) return;

    const email = (u.email || '').toLowerCase();
    const next: SuperAdminsConfig = currentlySA
      ? {
          uids: superAdmins.uids.filter((x) => x !== u.id),
          emails: superAdmins.emails.filter((x) => x !== email),
        }
      : {
          uids: [...new Set([...superAdmins.uids, u.id])],
          emails: email ? [...new Set([...superAdmins.emails, email])] : superAdmins.emails,
        };

    setBusy(`sa:${u.id}`);
    try {
      await FirestoreService.updateDocument('appConfig', 'superAdmins', {
        uids: next.uids,
        emails: next.emails,
      });
      setSuperAdmins(next);
    } catch (err) {
      logger.error('Failed to update super admins:', { err });
      alert('Η ενημέρωση των super admins απέτυχε.');
    } finally {
      setBusy(null);
    }
  };

  const handleRoleChange = async (userId: string, m: UserMembership, role: BrandMemberRole) => {
    if (m.role === role) return;
    setBusy(`role:${userId}:${m.brandId}`);
    try {
      await MembersService.updateRole(m.brandId, userId, role);
      setMemberships((prev) => ({
        ...prev,
        [userId]: (prev[userId] || []).map((item) =>
          item.brandId === m.brandId ? { ...item, role } : item
        ),
      }));
    } catch (err) {
      logger.error('Failed to update role:', { err });
      alert('Η αλλαγή ρόλου απέτυχε.');
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveFromBrand = async (userId: string, m: UserMembership) => {
    if (!confirm(`Αφαίρεση του χρήστη από το brand "${m.brandName}";`)) return;
    setBusy(`remove:${userId}:${m.brandId}`);
    try {
      await MembersService.remove(m.brandId, userId);
      setMemberships((prev) => ({
        ...prev,
        [userId]: (prev[userId] || []).filter((item) => item.brandId !== m.brandId),
      }));
    } catch (err) {
      logger.error('Failed to remove member:', { err });
      alert('Η αφαίρεση από το brand απέτυχε.');
    } finally {
      setBusy(null);
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = term
    ? users.filter((u) =>
        (u.email || '').toLowerCase().includes(term) ||
        (u.displayName || '').toLowerCase().includes(term) ||
        u.id.toLowerCase().includes(term)
      )
    : users;

  // Client-side pagination: only PAGE_SIZE cards are mounted at once so the DOM
  // stays light regardless of total user count.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgColor-muted)' }}>Φόρτωση χρηστών...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14, margin: 0 }}>
          Συνολικά {users.length} χρήστ{users.length === 1 ? 'ης' : 'ες'} στο σύστημα
          {term && ` · ${filtered.length} με αναζήτηση`}
        </Text>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Αναζήτηση email / όνομα..."
            style={{
              padding: '6px 12px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid var(--borderColor-default, #d0d7de)',
              background: 'var(--bgColor-default, #fff)',
              color: 'var(--fgColor-default)',
              minWidth: 220,
            }}
          />
          <button
            type="button"
            onClick={load}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 6,
              border: '1px solid var(--borderColor-default)',
              background: 'var(--bgColor-default)', cursor: 'pointer',
              fontSize: 13, color: 'var(--fgColor-default)',
            }}
          >
            <SyncIcon size={14} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          color: '#b91c1c', marginBottom: 16, fontSize: 13,
        }}>
          Δεν ήταν δυνατή η φόρτωση των χρηστών: {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {visible.map((u) => {
          const userBrands = memberships[u.id] || [];
          const admin = isSuperAdmin(u);
          const isOpen = expanded === u.id;
          const name = u.displayName || (u.email ? u.email.split('@')[0] : 'Χωρίς όνομα');
          const initial = (u.displayName || u.email || '?')[0]?.toUpperCase();
          const isSelf = u.id === currentUser?.uid;
          return (
            <div
              key={u.id}
              style={{
                padding: 16, borderRadius: 10,
                border: `1px solid ${admin ? 'rgba(212,133,74,0.4)' : 'var(--borderColor-default, #d0d7de)'}`,
                background: 'var(--bgColor-default, #fff)',
                display: 'grid', gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: admin ? 'rgba(212,133,74,0.15)' : 'var(--bgColor-accent-muted, #ddf4ff)',
                    display: 'grid', placeItems: 'center',
                    fontWeight: 700, fontSize: 14,
                    color: admin ? 'var(--nts-accent)' : '#0969da',
                    flexShrink: 0,
                  }}>
                    {initial}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text as="span" weight="semibold" style={{ fontSize: 15 }}>{name}</Text>
                      {admin && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: 'rgba(212,133,74,0.12)', color: 'var(--nts-accent)',
                        }}>
                          <ShieldIcon size={11} /> Super Admin
                        </span>
                      )}
                      {isSelf && (
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                          background: 'var(--bgColor-muted, #f6f8fa)', color: 'var(--fgColor-muted)',
                        }}>
                          εσύ
                        </span>
                      )}
                    </div>
                    <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.email || '—'} · Εγγραφή {formatUserDate(u.createdAt)}
                    </Text>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: 'var(--bgColor-muted, #f6f8fa)', color: 'var(--fgColor-muted)',
                  }}>
                    {userBrands.length} brand{userBrands.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleSuperAdmin(u)}
                    disabled={busy === `sa:${u.id}` || isSelf}
                    title={isSelf ? 'Δεν μπορείς να αλλάξεις τα δικά σου δικαιώματα' : admin ? 'Αφαίρεση super admin' : 'Παραχώρηση super admin'}
                    style={{
                      padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      border: '1px solid var(--borderColor-default, #d0d7de)',
                      background: admin ? 'rgba(207,34,46,0.06)' : 'var(--bgColor-default, #fff)',
                      color: isSelf ? 'var(--fgColor-muted)' : admin ? '#cf222e' : 'var(--fgColor-default)',
                      cursor: busy === `sa:${u.id}` ? 'wait' : isSelf ? 'not-allowed' : 'pointer',
                      opacity: isSelf ? 0.5 : 1,
                    }}
                  >
                    {busy === `sa:${u.id}` ? '...' : admin ? 'Αφαίρεση SA' : 'Κάνε Super Admin'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : u.id)}
                    style={{
                      padding: '5px 10px', borderRadius: 6, fontSize: 12,
                      border: '1px solid var(--borderColor-default, #d0d7de)',
                      background: 'var(--bgColor-default, #fff)',
                      color: 'var(--fgColor-muted)', cursor: 'pointer',
                    }}
                  >
                    {isOpen ? 'Απόκρυψη' : 'Διαχείριση brands'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--borderColor-muted, #e5e7eb)', paddingTop: 12, display: 'grid', gap: 8 }}>
                  {userBrands.length === 0 && (
                    <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                      Ο χρήστης δεν ανήκει σε κανένα brand.
                    </Text>
                  )}
                  {userBrands.map((m) => {
                    const roleBusy = busy === `role:${u.id}:${m.brandId}`;
                    const removeBusy = busy === `remove:${u.id}:${m.brandId}`;
                    return (
                      <div
                        key={m.brandId}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 12, flexWrap: 'wrap',
                          padding: '8px 12px', borderRadius: 8,
                          background: 'var(--bgColor-muted, #f6f8fa)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <Text as="div" weight="semibold" style={{ fontSize: 13 }}>{m.brandName}</Text>
                          {m.department && (
                            <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                              {DEPARTMENT_LABELS[m.department] ?? m.department}
                            </Text>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--borderColor-default, #d0d7de)' }}>
                            {MEMBERSHIP_ROLES.map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => handleRoleChange(u.id, m, r)}
                                disabled={roleBusy}
                                style={{
                                  padding: '4px 10px', fontSize: 12,
                                  fontWeight: m.role === r ? 700 : 400,
                                  border: 'none',
                                  borderLeft: r !== 'owner' ? '1px solid var(--borderColor-default, #d0d7de)' : 'none',
                                  background: m.role === r ? 'var(--nts-accent, #d4854a)' : 'var(--bgColor-default, #fff)',
                                  color: m.role === r ? '#fff' : 'var(--fgColor-muted)',
                                  cursor: roleBusy ? 'wait' : 'pointer',
                                }}
                              >
                                {ROLE_LABELS[r]}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromBrand(u.id, m)}
                            disabled={removeBusy}
                            title="Αφαίρεση από το brand"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 6, fontSize: 12,
                              border: '1px solid var(--borderColor-default, #d0d7de)',
                              background: 'var(--bgColor-default, #fff)',
                              color: 'var(--danger-fg, #cf222e)',
                              cursor: removeBusy ? 'wait' : 'pointer',
                            }}
                          >
                            <TrashIcon size={12} />
                            {removeBusy ? '...' : 'Αφαίρεση'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && !error && (
          <Text as="p" style={{ color: 'var(--fgColor-muted)', textAlign: 'center', padding: 32 }}>
            {term ? 'Κανένας χρήστης δεν ταιριάζει στην αναζήτηση.' : 'Δεν υπάρχουν χρήστες ακόμα.'}
          </Text>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, marginTop: 16, flexWrap: 'wrap',
        }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 13,
              border: '1px solid var(--borderColor-default, #d0d7de)',
              background: 'var(--bgColor-default, #fff)',
              color: 'var(--fgColor-default)',
              cursor: safePage === 0 ? 'not-allowed' : 'pointer',
              opacity: safePage === 0 ? 0.5 : 1,
            }}
          >
            ← Προηγούμενη
          </button>
          <Text as="span" size="small" style={{ color: 'var(--fgColor-muted)' }}>
            Σελίδα {safePage + 1} / {pageCount} · {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} από {filtered.length}
          </Text>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 13,
              border: '1px solid var(--borderColor-default, #d0d7de)',
              background: 'var(--bgColor-default, #fff)',
              color: 'var(--fgColor-default)',
              cursor: safePage >= pageCount - 1 ? 'not-allowed' : 'pointer',
              opacity: safePage >= pageCount - 1 ? 0.5 : 1,
            }}
          >
            Επόμενη →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Leads Tab ─── */

interface InterestLeadRow {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  source?: string;
  createdAt?: unknown;
  teamNotificationStatus?: 'sent' | 'failed';
  userConfirmationStatus?: 'sent' | 'failed';
}

function formatLeadDate(value: unknown): string {
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  const date = maybeTimestamp?.toDate?.();
  if (!date) return '—';
  return date.toLocaleString('el-GR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function LeadsTab() {
  const [leads, setLeads] = useState<InterestLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const leadsQuery = query(
        collection(db, 'interest_leads'),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const snap = await getDocs(leadsQuery);
      setLeads(snap.docs.map((leadDoc) => ({
        id: leadDoc.id,
        ...leadDoc.data(),
      })) as InterestLeadRow[]);
    } catch (err) {
      logger.error('Failed to load interest leads:', { err });
      setError(err instanceof Error ? err.message : 'Could not load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgColor-muted)' }}>Φόρτωση leads...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14, margin: 0 }}>
            Τελευταία {leads.length} contact form submissions.
          </Text>
          <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Team notification: support@notthesame.gr
          </Text>
        </div>
        <button
          type="button"
          onClick={loadLeads}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--borderColor-default)',
            background: 'var(--bgColor-default)',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--fgColor-default)',
          }}
        >
          <SyncIcon size={14} />
          Refresh
        </button>
      </div>

      {error && (
        <div style={{
          padding: 12,
          borderRadius: 8,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          color: '#b91c1c',
          marginBottom: 16,
          fontSize: 13,
        }}>
          Δεν ήταν δυνατή η φόρτωση των leads: {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {leads.map((lead) => {
          const teamSent = lead.teamNotificationStatus === 'sent';
          return (
            <div
              key={lead.id}
              style={{
                padding: 16,
                borderRadius: 10,
                border: '1px solid var(--borderColor-default, #d0d7de)',
                background: 'var(--bgColor-default, #fff)',
                display: 'grid',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <Text as="div" weight="semibold" style={{ fontSize: 15 }}>
                    {lead.fullName || 'Χωρίς όνομα'}
                  </Text>
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                    {lead.email || '—'} · {lead.phone || 'χωρίς τηλέφωνο'}
                  </Text>
                  {lead.company && (
                    <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                      {lead.company}
                    </Text>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>
                    {formatLeadDate(lead.createdAt)}
                  </Text>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    marginTop: 6,
                    padding: '3px 8px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    color: teamSent ? '#15803d' : '#b45309',
                    background: teamSent ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.12)',
                    border: teamSent ? '1px solid rgba(34,197,94,0.22)' : '1px solid rgba(245,158,11,0.24)',
                  }}>
                    {teamSent ? 'Email sent' : 'Email pending'}
                  </span>
                </div>
              </div>
              {lead.message && (
                <Text as="p" style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bgColor-muted, #f6f8fa)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  color: 'var(--fgColor-default)',
                }}>
                  {lead.message}
                </Text>
              )}
            </div>
          );
        })}

        {leads.length === 0 && !error && (
          <Text as="p" style={{ color: 'var(--fgColor-muted)', textAlign: 'center', padding: 32 }}>
            Δεν υπάρχουν leads ακόμα.
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

  const projectId = PROJECT_ID;

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
      logger.error('Failed to load changelog:', { err });
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
  const [adminEmails, setAdminEmails] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      const [usersRes, brandsRes, saRes] = await Promise.allSettled([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'brands')),
        loadSuperAdmins(),
      ]);
      if (usersRes.status === 'fulfilled' && brandsRes.status === 'fulfilled') {
        setStats({ users: usersRes.value.size, brands: brandsRes.value.size });
      } else {
        if (usersRes.status === 'rejected') logger.error('Failed to load users count:', { err: usersRes.reason });
        if (brandsRes.status === 'rejected') logger.error('Failed to load brands count:', { err: brandsRes.reason });
      }
      if (saRes.status === 'fulfilled') setAdminEmails(saRes.value.emails);
      else logger.error('Failed to load super admins:', { err: saRes.reason });
      setLoading(false);
    }
    load();
  }, []);

  const projectId = PROJECT_ID;

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
      items: adminEmails.length
        ? adminEmails.map((email) => ({ label: 'Email', value: email }))
        : [{ label: 'Email', value: loading ? '...' : '—' }]
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
