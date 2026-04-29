import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Header as PrimerHeader,
  NavList,
  Text
} from '@primer/react';
import { Button, PerformancePlusLogo } from '../common';
import { useAuth, useBrand, useBrandMembers } from '../../hooks';
import { useModules } from '../../hooks/useModules';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import type { AppSectionId, Brand } from '../../types';
import { getModuleIdForSection } from '../../config/modules';
import {
  GearIcon,
  GraphIcon,
  HomeIcon,
  LightBulbIcon,
  MegaphoneIcon,
  OrganizationIcon,
  PackageIcon,
  PencilIcon,
  PinIcon,
  ReportIcon,
  SearchIcon,
  ShieldIcon,
  ThreeBarsIcon,
  XIcon
} from '@primer/octicons-react';
import { Upload, UserPlus, Building2, Target, Euro, Truck, FileSpreadsheet, GitPullRequestArrow, Zap, BarChart3, ShoppingBag, Handshake, Users, Globe2 } from 'lucide-react';
import { NotificationBell } from '../coordination/NotificationBell';

const SIDEBAR_PIN_KEY = 'perf-plus-sidebar-pinned';

export interface AppShellProps {
  activeSection: string;
  onSectionChange: (section: string, opts?: { hashQuery?: string }) => void;
  children: React.ReactNode;
}

type NavGroup = 'overview' | 'intelligence' | 'strategy' | 'execution' | 'coordination' | 'utility';
type NavItem = { id: AppSectionId; label: string; icon: any; badge?: string; badgeColor?: string; group: NavGroup };

function BrandMenu({
  currentBrand,
  brands,
  isOpen,
  onToggle,
  onClose,
  onSelect
}: {
  currentBrand: Brand | null;
  brands: Brand[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (brand: Brand) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
        minWidth: Math.max(180, rect.width),
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 1000
      });
    }
  }, [isOpen]);

  if (!currentBrand) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={currentBrand.name}
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.06)',
          cursor: brands.length > 1 ? 'pointer' : 'default',
          fontSize: 14,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.8)',
          minWidth: 0,
          maxWidth: 'min(100%, 12rem)',
        }}
      >
        <Text
          as="span"
          size="small"
          weight="semibold"
          className="min-w-0 max-w-[5.5rem] truncate sm:max-w-[8rem] md:max-w-[10rem] lg:max-w-[12rem]"
          style={{ color: 'rgba(255,255,255,0.9)' }}
        >
          {currentBrand.name}
        </Text>
        {brands.length > 1 && (
          <span style={{ opacity: 0.7, fontSize: 12 }}>▼</span>
        )}
      </button>
      {brands.length > 1 && isOpen && createPortal(
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999 }} aria-hidden />
          <div
            style={{
              ...menuStyle,
              background: 'var(--bgColor-default, #ffffff)',
              border: '1px solid var(--borderColor-default, #d0d7de)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => { onSelect(b); onClose(); }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  textAlign: 'left',
                  border: 'none',
                  background: currentBrand?.id === b.id ? 'var(--bgColor-muted, #f6f8fa)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: currentBrand?.id === b.id ? 'var(--nts-accent)' : 'var(--fgColor-default, #24292f)'
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

function AccountMenu({
  user,
  onSignOut,
  isOpen,
  onToggle,
  onClose,
  hasPasswordProvider,
  hasGoogleProvider,
  onLinkPassword,
  onLinkGoogle
}: {
  user: { email?: string | null; displayName?: string | null } | null;
  onSignOut: () => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  hasPasswordProvider: boolean;
  hasGoogleProvider: boolean;
  onLinkPassword: (password: string) => Promise<void>;
  onLinkGoogle: () => Promise<void>;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [linkMsg, setLinkMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
        minWidth: 220,
        zIndex: 1000
      });
    }
  }, [isOpen]);

  if (!user) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          background: 'rgba(255,255,255,0.06)',
          cursor: 'pointer',
          fontSize: 14
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: '#F97316',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 12,
            flexShrink: 0
          }}
        >
          {(user.email?.[0] || user.displayName?.[0] || '?').toUpperCase()}
        </div>
        <Text as="span" size="small" className="hidden xl:inline" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.75)' }}>
          {user.email || user.displayName || 'Account'}
        </Text>
      </button>
      {isOpen && createPortal(
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999 }} aria-hidden />
          <div
            style={{
              ...menuStyle,
              background: 'var(--bgColor-default, #ffffff)',
              border: '1px solid var(--borderColor-default, #d0d7de)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            <div style={{ padding: 12, borderBottom: '1px solid var(--borderColor-default, #d0d7de)' }}>
              <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)', marginBottom: 2 }}>Account</Text>
              <Text as="div" size="small" weight="semibold" style={{ wordBreak: 'break-all' }}>{user.email}</Text>
              {user.displayName && (
                <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)' }}>{user.displayName}</Text>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {hasPasswordProvider && (
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'rgba(45,164,78,0.1)', color: '#2da44e' }}>Email/Password</span>
                )}
                {hasGoogleProvider && (
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'rgba(66,133,244,0.1)', color: '#4285F4' }}>Google</span>
                )}
              </div>
            </div>

            {/* Link providers */}
            {!hasPasswordProvider && (
              <div style={{ borderBottom: '1px solid var(--borderColor-default, #d0d7de)' }}>
                {!showSetPassword ? (
                  <button
                    onClick={() => setShowSetPassword(true)}
                    style={{
                      width: '100%', padding: '10px 12px', textAlign: 'left',
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontSize: 13, color: 'var(--fgColor-default, #24292f)'
                    }}
                  >
                    Ορισμός κωδικού
                  </button>
                ) : (
                  <div style={{ padding: 10 }}>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Νέος κωδικός (min 6)"
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6,
                        border: '1px solid var(--borderColor-default)', marginBottom: 6
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={async () => {
                          if (newPassword.length < 6) { setLinkMsg({ type: 'err', text: 'Min 6 χαρακτήρες' }); return; }
                          try {
                            await onLinkPassword(newPassword);
                            setLinkMsg({ type: 'ok', text: 'Κωδικός ορίστηκε!' });
                            setShowSetPassword(false);
                            setNewPassword('');
                          } catch (e: any) {
                            setLinkMsg({ type: 'err', text: e.message?.includes('auth/') ? 'Αποτυχία σύνδεσης' : (e.message || 'Σφάλμα') });
                          }
                        }}
                        style={{
                          flex: 1, padding: '5px 8px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                          border: 'none', background: 'var(--nts-accent)', color: '#fff', cursor: 'pointer'
                        }}
                      >
                        Αποθήκευση
                      </button>
                      <button
                        onClick={() => { setShowSetPassword(false); setNewPassword(''); setLinkMsg(null); }}
                        style={{
                          padding: '5px 8px', fontSize: 12, borderRadius: 6,
                          border: '1px solid var(--borderColor-default)', background: 'transparent', cursor: 'pointer'
                        }}
                      >
                        Ακύρωση
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!hasGoogleProvider && (
              <div style={{ borderBottom: '1px solid var(--borderColor-default, #d0d7de)' }}>
                <button
                  onClick={async () => {
                    try {
                      await onLinkGoogle();
                      setLinkMsg({ type: 'ok', text: 'Google συνδέθηκε!' });
                    } catch (e: any) {
                      setLinkMsg({ type: 'err', text: e.message?.includes('auth/credential-already-in-use') ? 'Αυτό το Google account χρησιμοποιείται ήδη' : (e.message || 'Σφάλμα') });
                    }
                  }}
                  style={{
                    width: '100%', padding: '10px 12px', textAlign: 'left',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: 13, color: 'var(--fgColor-default, #24292f)'
                  }}
                >
                  Σύνδεση Google λογαριασμού
                </button>
              </div>
            )}

            {linkMsg && (
              <div style={{
                padding: '6px 12px', fontSize: 12,
                color: linkMsg.type === 'ok' ? '#2da44e' : '#cf222e',
                background: linkMsg.type === 'ok' ? 'rgba(45,164,78,0.08)' : 'rgba(207,34,46,0.08)'
              }}>
                {linkMsg.text}
              </div>
            )}

            <button
              onClick={() => { onSignOut(); onClose(); }}
              style={{
                width: '100%',
                padding: '10px 12px',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--danger-fg, #cf222e)'
              }}
            >
              Αποσύνδεση
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

const LAYOUT_WIDE_MQ = '(min-width: 1024px)';

export function AppShell({ activeSection, onSectionChange, children }: AppShellProps) {
  const [isWideLayout, setIsWideLayout] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(LAYOUT_WIDE_MQ).matches : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(LAYOUT_WIDE_MQ);
    const onChange = () => setIsWideLayout(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(SIDEBAR_PIN_KEY) === '1';
    return false;
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');
  const { user, signOut, isSuperAdmin, hasPasswordProvider, hasGoogleProvider, linkPassword, linkGoogle } = useAuth();
  const { currentBrand, brands, setCurrentBrand } = useBrand();
  const { isB2B, enabledModules, moduleConfig } = useModules();
  const { activeStrategy } = useActiveStrategy();
  useBrandMembers();

  /** Σε οθόνες <1024px το καρφιτσωμένο μενού ΔΕΝ μένει στήλη (καταστρέφει το layout) — χρησιμοποιείται μόνο overlay drawer. */
  const showPinnedColumn = sidebarPinned && isWideLayout;

  /** Το κύριο scroll είναι εδώ (όχι το window) — ώστε νέα σελίδα από το μενού να ξεκινά από πάνω. */
  const mainContentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainContentScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [activeSection]);

  const strategyBadge = useMemo(() => {
    if (!activeStrategy?.duration || activeStrategy.duration === 'ongoing') return null;
    const dur = typeof activeStrategy.duration === 'string' ? parseInt(activeStrategy.duration as string, 10) : activeStrategy.duration;
    if (!dur || isNaN(dur)) return null;
    const raw = activeStrategy.updatedAt || activeStrategy.createdAt;
    const startMs = typeof raw === 'string' ? new Date(raw).getTime()
      : typeof (raw as any)?.toMillis === 'function' ? (raw as any).toMillis()
      : typeof (raw as any)?.seconds === 'number' ? (raw as any).seconds * 1000
      : NaN;
    if (isNaN(startMs)) {
      return { text: `${dur}ημ`, color: '#F97316' };
    }
    const elapsedDays = Math.floor((Date.now() - startMs) / 86400000);
    if (elapsedDays < 1) return { text: `${dur}ημ`, color: '#F97316' };
    const remaining = dur - elapsedDays;
    if (remaining <= 0) return { text: 'Έληξε', color: '#EF4444' };
    if (remaining <= 3) return { text: `${remaining}ημ`, color: '#F59E0B' };
    return { text: `${remaining}ημ`, color: '#F97316' };
  }, [activeStrategy]);

  const togglePin = () => {
    const next = !sidebarPinned;
    setSidebarPinned(next);
    setSidebarOpen(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_PIN_KEY, next ? '1' : '0');
    }
  };

  const navItems = useMemo<NavItem[]>(
    () => {
      const commonItems: NavItem[] = [
        { id: 'brands', label: 'My Brands', icon: Building2, group: 'overview' },
        { id: 'dashboard', label: moduleConfig.dashboard.label, icon: HomeIcon, group: 'overview' },
        { id: 'roi', label: moduleConfig.roi.label, icon: GraphIcon, group: 'overview' },
        { id: 'ecommerce', label: moduleConfig.ecommerce.label, icon: ShoppingBag, group: 'intelligence' },
        { id: 'rfm', label: moduleConfig.rfm.label, icon: OrganizationIcon, group: 'intelligence' },
        { id: 'accounts', label: moduleConfig.accounts.label, icon: Users, group: 'intelligence' },
        { id: 'products', label: moduleConfig.products.label, icon: PackageIcon, group: 'intelligence' },
        { id: 'competitive', label: moduleConfig.competitive.label, icon: SearchIcon, group: 'intelligence' },
        { id: 'analytics', label: moduleConfig.analytics.label, icon: BarChart3, group: 'intelligence' },
        { id: 'insights', label: moduleConfig.insights.label, icon: LightBulbIcon, group: 'intelligence' },
        { id: 'strategy', label: 'Commercial Strategy', icon: GraphIcon, group: 'strategy', ...(strategyBadge ? { badge: strategyBadge.text, badgeColor: strategyBadge.color } : {}) },
        { id: 'markets', label: moduleConfig.markets.label, icon: Globe2, group: 'strategy' },
        { id: 'channels', label: moduleConfig.channels.label, icon: MegaphoneIcon, group: 'strategy' },
        { id: 'sales', label: moduleConfig.sales.label, icon: Handshake, group: 'strategy' },
        { id: 'campaigns', label: moduleConfig.campaigns.label, icon: Target, group: 'strategy' },
        { id: 'calendar', label: moduleConfig.calendar.label, icon: PencilIcon, group: 'strategy' },
        { id: 'finances', label: moduleConfig.finances.label, icon: Euro, group: 'execution' },
        { id: 'suppliers', label: moduleConfig.suppliers.label, icon: Truck, group: 'execution' },
        { id: 'procurement', label: moduleConfig.procurement.label, icon: FileSpreadsheet, group: 'execution' },
        { id: 'coordination', label: moduleConfig.coordination.label, icon: GitPullRequestArrow, group: 'coordination' },
        { id: 'automation', label: moduleConfig.automation.label, icon: Zap, group: 'coordination' },
        { id: 'reports', label: moduleConfig.reports.label, icon: ReportIcon, group: 'coordination' },
        { id: 'data', label: isB2B ? moduleConfig.data.label : 'Συνδέσεις', icon: Upload, group: 'utility' },
        { id: 'invite', label: 'Invite users', icon: UserPlus, group: 'utility' },
        { id: 'help', label: 'Help', icon: GearIcon, group: 'utility' },
      ];

      const ordered = isB2B
        ? [
            'brands', 'dashboard', 'accounts', 'products', 'suppliers', 'procurement', 'strategy', 'markets', 'channels', 'sales', 'campaigns',
            'competitive', 'analytics', 'roi', 'finances', 'calendar', 'insights', 'coordination', 'automation', 'reports', 'data', 'invite', 'help',
          ]
        : [
            'brands', 'dashboard', 'roi', 'ecommerce', 'rfm', 'products', 'competitive', 'analytics', 'insights', 'strategy', 'channels',
            'campaigns', 'calendar', 'finances', 'suppliers', 'procurement', 'coordination', 'automation', 'reports', 'data', 'invite', 'help',
          ];

      const itemMap = new Map(commonItems.map((item) => [item.id, item]));
      const items = ordered
        .map((id) => itemMap.get(id as AppSectionId))
        .filter((item): item is NavItem => Boolean(item))
        .filter((item) => {
          const moduleId = getModuleIdForSection(item.id);
          return moduleId ? enabledModules[moduleId] : true;
        });

      if (isSuperAdmin) {
        items.push({ id: 'admin', label: 'Super Admin', icon: ShieldIcon, group: 'utility' });
      }
      return items;
    },
    [enabledModules, isB2B, isSuperAdmin, moduleConfig, strategyBadge]
  );

  const Nav = ({ onSelect }: { onSelect: (id: AppSectionId) => void }) => {
    let lastGroup: NavGroup | null = null;
    return (
      <NavList aria-label="Primary">
        {navItems.map((item) => {
          const showSeparator = lastGroup !== null && item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <React.Fragment key={item.id}>
              {showSeparator && (
                <li aria-hidden="true" style={{ listStyle: 'none', margin: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
              )}
              <NavList.Item
                as="button"
                type="button"
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation();
                  onSelect(item.id); 
                }}
                aria-current={(activeSection === item.id || (item.id === 'data' && activeSection.startsWith('data-'))) ? 'page' : undefined}
                style={{ width: '100%', textAlign: 'left' }}
              >
                <NavList.LeadingVisual>
                  {typeof item.icon === 'function' ? <item.icon size={16} /> : <item.icon />}
                </NavList.LeadingVisual>
                <span className="flex items-center gap-2">
                  {item.label}
                  {item.badge && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
                      style={{ backgroundColor: `${item.badgeColor}20`, color: item.badgeColor }}
                    >
                      {item.badge}
                    </span>
                  )}
                </span>
              </NavList.Item>
            </React.Fragment>
          );
        })}
      </NavList>
    );
  };

  return (
    <>
      <PrimerHeader style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#111111' }} className="min-w-0">
        <PrimerHeader.Item className="min-w-0 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={<ThreeBarsIcon />}
            onClick={() => {
              if (showPinnedColumn) togglePin();
              else setSidebarOpen((o) => !o);
            }}
            style={{
              color: 'rgba(255,255,255,0.95)',
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 8
            }}
            aria-label="Menu"
          />
        </PrimerHeader.Item>

        <PrimerHeader.Item style={{ flex: '0 1 auto', minWidth: 0 }} className="min-w-0">
          <PrimerHeader.Link
            as="button"
            type="button"
            onClick={(e) => e.preventDefault()}
            style={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
              border: 'none',
              background: 'transparent',
              padding: 0,
              font: 'inherit',
              cursor: 'default',
            }}
          >
            <PerformancePlusLogo height={30} className="max-w-[9rem] sm:max-w-none" variant="onDark" />
          </PrimerHeader.Link>
        </PrimerHeader.Item>

        <PrimerHeader.Item full className="hidden lg:block" style={{ maxWidth: 460, minWidth: 220 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', display: 'flex' }}><SearchIcon /></span>
            <input
              type="search"
              aria-label="Search help"
              placeholder="Search…"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const q = headerSearch.trim();
                if (!q) {
                  onSectionChange('help');
                  return;
                }
                onSectionChange('help', { hashQuery: `q=${encodeURIComponent(q)}` });
              }}
              style={{
                width: '100%',
                padding: '7px 12px 7px 34px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 14,
                outline: 'none'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.background = 'transparent';
              }}
            />
          </div>
        </PrimerHeader.Item>

        <PrimerHeader.Item style={{ marginLeft: 'auto', minWidth: 0 }} className="min-w-0 shrink">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
            {currentBrand && (
              <BrandMenu
                currentBrand={currentBrand}
                brands={brands}
                isOpen={brandMenuOpen}
                onToggle={() => setBrandMenuOpen((o) => !o)}
                onClose={() => setBrandMenuOpen(false)}
                onSelect={setCurrentBrand}
              />
            )}
            <div style={{ position: 'relative', overflow: 'visible' }}>
              <NotificationBell onNavigate={(s) => onSectionChange(s)} />
            </div>
            <div style={{ position: 'relative', overflow: 'visible' }}>
              <AccountMenu
                user={user}
                onSignOut={signOut}
                isOpen={userMenuOpen}
                onToggle={() => setUserMenuOpen((o) => !o)}
                onClose={() => setUserMenuOpen(false)}
                hasPasswordProvider={hasPasswordProvider}
                hasGoogleProvider={hasGoogleProvider}
                onLinkPassword={linkPassword}
                onLinkGoogle={linkGoogle}
              />
            </div>
          </div>
        </PrimerHeader.Item>
      </PrimerHeader>

      <div style={{ 
        flex: 1, 
        minHeight: 0, 
        display: 'flex', 
        flexDirection: 'row',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '100%'
      }}>
        {/* Pinned Sidebar */}
        {showPinnedColumn && (
          <div 
            className="sidebar-dark"
            style={{
              width: 260,
              minWidth: 260,
              maxWidth: 260,
              borderRight: '1px solid rgba(255,255,255,0.08)',
              overflowY: 'auto',
              overflowX: 'hidden',
              backgroundColor: '#111111',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{ 
              padding: '8px 16px', 
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexShrink: 0
            }}>
              <button
                onClick={togglePin}
                title="Ξεκαρφίτσωμα μενού"
                style={{
                  padding: 4,
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.5)'
                }}
              >
                <PinIcon size={14} />
              </button>
            </div>
            <div style={{ padding: 12, flex: 1, overflowY: 'auto' }}>
              <Nav onSelect={(id) => onSectionChange(id)} />
            </div>
          </div>
        )}

        {/* Main Content */}
        <div 
          ref={mainContentScrollRef}
          style={{ 
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            width: '100%',
            maxWidth: '100%',
            backgroundColor: 'var(--nts-bg-pure)'
          }}
        >
          <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-6">
            {children}
          </div>
        </div>
      </div>

      {/* Drawer Overlay (unpinned) */}
      {sidebarOpen && !showPinnedColumn && (
        <>
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              zIndex: 999,
              animation: 'fadeIn 0.2s ease-out'
            }}
          />
          <div
            className="sidebar-dark"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: 280,
              maxWidth: '80vw',
              backgroundColor: '#111111',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              animation: 'slideInLeft 0.2s ease-out',
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
          >
            {/* Drawer Header */}
            <div style={{ 
              padding: 16, 
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <PerformancePlusLogo height={40} variant="onDark" />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={togglePin}
                  title="Καρφίτσωμα μενού"
                  style={{
                    padding: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(255,255,255,0.5)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <PinIcon size={16} />
                </button>
                <button
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close navigation"
                  style={{
                    padding: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(255,255,255,0.5)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <XIcon size={16} />
                </button>
              </div>
            </div>
            {/* Navigation */}
            <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
              <Nav
                onSelect={(id) => {
                  setSidebarOpen(false);
                  onSectionChange(id);
                }}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

