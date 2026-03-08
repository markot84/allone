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
import type { Brand, ChangelogEntry } from '../../types';
import { useAuth } from '../../hooks';

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

  useEffect(() => {
    async function load() {
      try {
        const allBrands = await FirestoreService.getDocuments<Brand>('brands');
        setBrands(allBrands.sort((a, b) => a.name.localeCompare(b.name)));

        const usersSnap = await getDocs(collection(db, 'users'));
        const counts: Record<string, number> = {};
        usersSnap.docs.forEach((d) => {
          const data = d.data();
          const bIds: string[] = data.brandIds ?? [];
          bIds.forEach((bid) => {
            counts[bid] = (counts[bid] || 0) + 1;
          });
        });
        setUserCounts(counts);
      } catch (err) {
        console.error('Failed to load brands:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgColor-muted)' }}>Φόρτωση brands...</div>;
  }

  return (
    <div>
      <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14, marginBottom: 16 }}>
        Συνολικά {brands.length} brand{brands.length !== 1 ? 's' : ''} στο σύστημα
      </Text>
      <div style={{ display: 'grid', gap: 12 }}>
        {brands.map((brand) => (
          <div
            key={brand.id}
            style={{
              padding: 16,
              borderRadius: 10,
              border: '1px solid var(--borderColor-default, #d0d7de)',
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
                  {brand.type} · Created {new Date(brand.createdAt).toLocaleDateString('el-GR')}
                </Text>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Text as="div" weight="semibold" style={{ fontSize: 16 }}>{userCounts[brand.id] || 0}</Text>
                <Text as="div" size="small" style={{ color: 'var(--fgColor-muted)' }}>χρήστες</Text>
              </div>
              <span style={{
                padding: '2px 8px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                background: brand.type === 'B2C' ? 'rgba(212,133,74,0.12)' : 'rgba(59,130,246,0.12)',
                color: brand.type === 'B2C' ? '#d4854a' : '#3b82f6'
              }}>
                {brand.type}
              </span>
            </div>
          </div>
        ))}
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

/* ─── Changelog Tab ─── */

function ChangelogTab({ userEmail }: { userEmail: string }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState({ version: '', title: '', changes: '' });

  const loadEntries = useCallback(async () => {
    try {
      const docs = await FirestoreService.getDocuments<ChangelogEntry>('changelog');
      docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setEntries(docs);
    } catch (err) {
      console.error('Failed to load changelog:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

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
    const text = `${APP_NAME} v${entry.version}\n${entry.title}\n\n${entry.changes.map((c) => `• ${c}`).join('\n')}\n\nΥποστήριξη: ${SUPPORT_EMAIL}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgColor-muted)' }}>Φόρτωση changelog...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text as="p" style={{ color: 'var(--fgColor-muted)', fontSize: 14 }}>
          Ιστορικό εκδόσεων και ενημερώσεων
        </Text>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ version: '', title: '', changes: '' }); }}
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
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--fgColor-default)' }}>
                {entry.changes.map((change, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>{change}</li>
                ))}
              </ul>
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
        { label: 'Project ID', value: projectId },
        { label: 'Environment', value: import.meta.env.MODE || 'development' },
        { label: 'Build Tool', value: 'Vite' },
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
