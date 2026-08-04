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
import { getModuleIdForSection, isSectionHidden } from '../../config/modules';
import { validatePassword, PASSWORD_REQUIREMENTS_HINT } from '../../utils/passwordPolicy';
import { ACCENT_PICKER_ENABLED, ACCENT_PRESETS, readStoredAccent, setStoredAccent, type AccentId } from '../../theme/accentTheme';
import { CASCADE_HOLD_MS, CASCADE_STEP_MS, STRATEGY_CASCADE_EVENT, cascadeChain } from '../../utils/strategyCascade';
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
import { Upload, UserPlus, Building2, Target, Euro, Truck, FileSpreadsheet, GitPullRequestArrow, Zap, BarChart3, ShoppingBag, Handshake, Users, Globe2, HeartHandshake, MapPin, ClipboardList, Palette, Lightbulb } from 'lucide-react';
import { NotificationBell } from '../coordination/NotificationBell';

const SIDEBAR_PIN_KEY = 'perf-plus-sidebar-pinned';

export interface AppShellProps {
  activeSection: string;
  onSectionChange: (section: string, opts?: { hashQuery?: string }) => void;
  children: React.ReactNode;
}

type NavGroup = 'business' | 'commerce' | 'commercial' | 'marketing' | 'procurement' | 'finance' | 'operations' | 'admin';
type NavIcon = React.ComponentType<{ size?: number }>;
type NavItem = { id: AppSectionId; label: string; icon: NavIcon; badge?: string; badgeColor?: string; group: NavGroup };
type TimestampLike = { toMillis?: () => number; seconds?: number };

const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  business: 'Business',
  commerce: 'Market & Data',
  commercial: 'Commercial Strategy & Sales',
  marketing: 'Marketing',
  procurement: 'Procurement',
  finance: 'Finance',
  operations: 'Operations',
  admin: 'Admin',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

/**
 * Lights the affected modules in sequence when a strategy weight settles.
 *
 * Each module keeps its own hold window, so the pulses overlap the way the brief describes rather
 * than one cutting the previous one short.
 */
function useCascadeHighlight(): Set<string> {
  const [lit, setLit] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const timers: number[] = [];

    const handleCascade = () => {
      cascadeChain().forEach((section, step) => {
        timers.push(
          window.setTimeout(() => {
            setLit((prev) => new Set(prev).add(section));
          }, step * CASCADE_STEP_MS)
        );
        timers.push(
          window.setTimeout(() => {
            setLit((prev) => {
              const next = new Set(prev);
              next.delete(section);
              return next;
            });
          }, step * CASCADE_STEP_MS + CASCADE_HOLD_MS)
        );
      });
    };

    window.addEventListener(STRATEGY_CASCADE_EVENT, handleCascade);
    return () => {
      window.removeEventListener(STRATEGY_CASCADE_EVENT, handleCascade);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return lit;
}

function SidebarNav({
  navItems,
  activeSection,
  onSelect,
}: {
  navItems: NavItem[];
  activeSection: string;
  onSelect: (id: AppSectionId) => void;
}) {
  const cascadeLit = useCascadeHighlight();
  return (
    <NavList aria-label="Primary">
      {navItems.map((item, index) => {
        const previousGroup = navItems[index - 1]?.group;
        const isFirstGroup = index === 0;
        const showGroupLabel = item.group !== previousGroup;
        return (
          <React.Fragment key={item.id}>
            {showGroupLabel && (
              <li
                style={{
                  listStyle: 'none',
                  margin: isFirstGroup ? '2px 12px 4px' : '10px 12px 4px',
                  paddingTop: isFirstGroup ? 0 : 8,
                  borderTop: isFirstGroup ? 'none' : '1px solid var(--chrome-border)'
                }}
              >
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ color: 'var(--chrome-fg-subtle)' }}
                >
                  {NAV_GROUP_LABELS[item.group]}
                </span>
              </li>
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
              className={cascadeLit.has(item.id) ? 'nav-cascade-pulse' : undefined}
              style={{ width: '100%', textAlign: 'left' }}
            >
              <NavList.LeadingVisual>
                {<item.icon size={16} />}
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
}

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
      const gutter = 8;
      const viewportWidth = window.innerWidth;
      const width = Math.min(Math.max(180, rect.width), viewportWidth - gutter * 2);
      const left = Math.min(Math.max(gutter, rect.left), viewportWidth - width - gutter);
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left,
        width,
        minWidth: 0,
        maxWidth: `calc(100vw - ${gutter * 2}px)`,
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
          border: '1px solid var(--chrome-control-border)',
          borderRadius: 8,
          background: 'var(--chrome-control-bg)',
          cursor: brands.length > 1 ? 'pointer' : 'default',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--chrome-fg)',
          minWidth: 0,
          maxWidth: 'min(100%, 12rem)',
        }}
      >
        <Text
          as="span"
          size="small"
          weight="semibold"
          className="hidden min-w-0 max-w-[4.5rem] truncate min-[420px]:inline sm:max-w-[8rem] md:max-w-[10rem] lg:max-w-[12rem]"
          style={{ color: 'var(--chrome-fg)' }}
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
  const [accent, setAccent] = useState<AccentId>(() => readStoredAccent());

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const gutter = 8;
      const viewportWidth = window.innerWidth;
      const width = Math.min(260, viewportWidth - gutter * 2);
      const left = Math.min(Math.max(gutter, rect.right - width), viewportWidth - width - gutter);
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left,
        width,
        minWidth: 0,
        maxWidth: `calc(100vw - ${gutter * 2}px)`,
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
          border: '1px solid var(--chrome-control-border)',
          borderRadius: 6,
          background: 'var(--chrome-control-bg)',
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
        <Text as="span" size="small" className="hidden xl:inline" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--chrome-fg)' }}>
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

            {/* Accent color (per-user, localStorage) — off while the brand palette is fixed. */}
            {ACCENT_PICKER_ENABLED && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--borderColor-default, #d0d7de)' }}>
              <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)', marginBottom: 8 }}>
                Χρώμα έμφασης
              </Text>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ACCENT_PRESETS.map((preset) => {
                  const selected = accent === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.label}
                      aria-label={preset.label}
                      aria-pressed={selected}
                      onClick={() => { setStoredAccent(preset.id); setAccent(preset.id); }}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: preset.swatch2
                          ? `linear-gradient(135deg, ${preset.swatch} 0 50%, ${preset.swatch2} 50% 100%)`
                          : preset.swatch,
                        border: selected ? '2px solid var(--fgColor-default, #24292f)' : '2px solid transparent',
                        boxShadow: selected ? `0 0 0 2px ${preset.swatch}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      {selected && (
                        <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            )}

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
                      placeholder={PASSWORD_REQUIREMENTS_HINT}
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6,
                        border: '1px solid var(--borderColor-default)', marginBottom: 6
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={async () => {
                          const pwError = validatePassword(newPassword);
                          if (pwError) { setLinkMsg({ type: 'err', text: pwError }); return; }
                          try {
                            await onLinkPassword(newPassword);
                            setLinkMsg({ type: 'ok', text: 'Κωδικός ορίστηκε!' });
                            setShowSetPassword(false);
                            setNewPassword('');
                          } catch (e) {
                            const msg = errorMessage(e);
                            setLinkMsg({ type: 'err', text: msg.includes('auth/') ? 'Αποτυχία σύνδεσης' : (msg || 'Σφάλμα') });
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
                    } catch (e) {
                      const msg = errorMessage(e);
                      setLinkMsg({ type: 'err', text: msg.includes('auth/credential-already-in-use') ? 'Αυτό το Google account χρησιμοποιείται ήδη' : (msg || 'Σφάλμα') });
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

/** Always-visible palette button in the top bar that opens a popover of accent colors (per-user). */
function AccentMenu() {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [accent, setAccent] = useState<AccentId>(() => readStoredAccent());

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const gutter = 8;
      const width = Math.min(220, window.innerWidth - gutter * 2);
      const left = Math.min(Math.max(gutter, rect.right - width), window.innerWidth - width - gutter);
      setMenuStyle({ position: 'fixed', top: rect.bottom + 4, left, width, zIndex: 1000 });
    }
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Χρώμα έμφασης"
        title="Χρώμα έμφασης"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          border: '1px solid var(--chrome-control-border)',
          borderRadius: 6,
          background: 'var(--chrome-control-bg)',
          color: 'var(--chrome-fg)',
          cursor: 'pointer',
        }}
      >
        <Palette size={18} />
      </button>
      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} aria-hidden />
          <div
            style={{
              ...menuStyle,
              background: 'var(--bgColor-default, #ffffff)',
              border: '1px solid var(--borderColor-default, #d0d7de)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              padding: 12,
            }}
          >
            <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)', marginBottom: 8 }}>
              Χρώμα έμφασης
            </Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ACCENT_PRESETS.map((preset) => {
                const selected = accent === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={selected}
                    onClick={() => { setStoredAccent(preset.id); setAccent(preset.id); }}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: preset.swatch2
                        ? `linear-gradient(135deg, ${preset.swatch} 0 50%, ${preset.swatch2} 50% 100%)`
                        : preset.swatch,
                      border: selected ? '2px solid var(--fgColor-default, #24292f)' : '2px solid transparent',
                      boxShadow: selected ? `0 0 0 2px ${preset.swatch}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    {selected && <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </button>
                );
              })}
            </div>
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
  const { user, signOut, isSuperAdmin, hasPasswordProvider, hasGoogleProvider, linkPassword, linkGoogle } = useAuth();
  const { currentBrand, brands, setCurrentBrand } = useBrand();
  const { isB2B, enabledModules, moduleConfig } = useModules();
  const { activeStrategy } = useActiveStrategy();
  useBrandMembers();

  /** On screens <1024px the pinned menu does NOT stay as a column (it breaks the layout) — only the overlay drawer is used. */
  const showPinnedColumn = sidebarPinned && isWideLayout;

  /** Main scroll lives here (not the window) so a new page from the menu starts at the top. */
  const mainContentScrollRef = useRef<HTMLDivElement>(null);
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    const el = mainContentScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [activeSection]);

  const strategyBadge = useMemo(() => {
    if (!activeStrategy?.duration || activeStrategy.duration === 'ongoing') return null;
    const dur = typeof activeStrategy.duration === 'string' ? parseInt(activeStrategy.duration as string, 10) : activeStrategy.duration;
    if (!dur || isNaN(dur)) return null;
    const raw = activeStrategy.updatedAt || activeStrategy.createdAt;
    const timestamp = raw as TimestampLike | undefined;
    const startMs = typeof raw === 'string' ? new Date(raw).getTime()
      : typeof timestamp?.toMillis === 'function' ? timestamp.toMillis()
      : typeof timestamp?.seconds === 'number' ? timestamp.seconds * 1000
      : NaN;
    if (isNaN(startMs)) {
      return { text: `${dur}ημ`, color: '#F97316' };
    }
    const elapsedDays = Math.floor((nowMs - startMs) / 86400000);
    if (elapsedDays < 1) return { text: `${dur}ημ`, color: '#F97316' };
    const remaining = dur - elapsedDays;
    if (remaining <= 0) return { text: 'Έληξε', color: '#EF4444' };
    if (remaining <= 3) return { text: `${remaining}ημ`, color: '#F59E0B' };
    return { text: `${remaining}ημ`, color: '#F97316' };
  }, [activeStrategy, nowMs]);

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
        { id: 'brands', label: 'My Brands', icon: Building2, group: 'business' },
        { id: 'dashboard', label: moduleConfig.dashboard.label, icon: HomeIcon, group: 'business' },
        { id: 'roi', label: moduleConfig.roi.label, icon: GraphIcon, group: 'business' },
        { id: 'insights', label: moduleConfig.insights.label, icon: LightBulbIcon, group: 'business' },
        { id: 'reports', label: moduleConfig.reports.label, icon: ReportIcon, group: 'business' },
        { id: 'ecommerce', label: moduleConfig.ecommerce.label, icon: ShoppingBag, group: 'commerce' },
        { id: 'rfm', label: moduleConfig.rfm.label, icon: OrganizationIcon, group: 'commerce' },
        { id: 'accounts', label: moduleConfig.accounts.label, icon: Users, group: 'commerce' },
        { id: 'competitive', label: moduleConfig.competitive.label, icon: SearchIcon, group: 'commerce' },
        { id: 'strategy', label: 'Commercial Strategy', icon: GraphIcon, group: 'commercial', ...(strategyBadge ? { badge: strategyBadge.text, badgeColor: strategyBadge.color } : {}) },
        { id: 'policy-impact', label: 'Policy Impact', icon: BarChart3, group: 'commercial' },
        { id: 'markets', label: moduleConfig.markets.label, icon: Globe2, group: 'commercial' },
        { id: 'sales', label: moduleConfig.sales.label, icon: Handshake, group: 'commercial' },
        { id: 'offers', label: moduleConfig.offers.label, icon: ClipboardList, group: 'commercial' },
        { id: 'marketing-plan', label: 'Marketing Plan', icon: ClipboardList, group: 'marketing' },
        { id: 'brand-profile', label: 'Brand Profile', icon: Palette, group: 'marketing' },
        { id: 'commercial-info', label: 'Εμπορικές Πληροφορίες', icon: Lightbulb, group: 'marketing' },
        { id: 'channels', label: moduleConfig.channels.label, icon: MegaphoneIcon, group: 'marketing' },
        { id: 'campaigns', label: moduleConfig.campaigns.label, icon: Target, group: 'marketing' },
        { id: 'analytics', label: moduleConfig.analytics.label, icon: BarChart3, group: 'marketing' },
        { id: 'calendar', label: moduleConfig.calendar.label, icon: PencilIcon, group: 'marketing' },
        { id: 'products', label: moduleConfig.products.label, icon: PackageIcon, group: 'procurement' },
        { id: 'suppliers', label: moduleConfig.suppliers.label, icon: Truck, group: 'procurement' },
        { id: 'procurement', label: moduleConfig.procurement.label, icon: FileSpreadsheet, group: 'procurement' },
        { id: 'finances', label: moduleConfig.finances.label, icon: Euro, group: 'finance' },
        { id: 'hr', label: moduleConfig.hr.label, icon: HeartHandshake, group: 'operations' },
        { id: 'territories', label: moduleConfig.territories.label, icon: MapPin, group: 'operations' },
        { id: 'coordination', label: moduleConfig.coordination.label, icon: GitPullRequestArrow, group: 'operations' },
        { id: 'automation', label: moduleConfig.automation.label, icon: Zap, group: 'operations' },
        { id: 'data', label: moduleConfig.data.label, icon: Upload, group: 'admin' },
        { id: 'invite', label: 'Invite users', icon: UserPlus, group: 'admin' },
        { id: 'help', label: 'Help', icon: GearIcon, group: 'admin' },
      ];

      const ordered = isB2B
        ? [
            'brands', 'dashboard', 'roi', 'insights', 'reports', 'accounts', 'competitive', 'strategy', 'policy-impact', 'markets', 'sales', 'offers',
            'marketing-plan', 'brand-profile', 'commercial-info', 'channels', 'campaigns', 'analytics', 'calendar', 'products', 'suppliers', 'procurement', 'finances', 'hr', 'territories', 'coordination', 'automation', 'data', 'invite', 'help',
          ]
        : [
            'brands', 'dashboard', 'roi', 'insights', 'reports', 'ecommerce', 'rfm', 'competitive', 'strategy', 'policy-impact',
            'marketing-plan', 'brand-profile', 'commercial-info', 'channels', 'campaigns', 'analytics', 'calendar', 'products', 'suppliers', 'procurement', 'finances', 'coordination', 'automation', 'data', 'invite', 'help',
          ];

      const itemMap = new Map(commonItems.map((item) => [item.id, item]));
      const items = ordered
        .map((id) => itemMap.get(id as AppSectionId))
        .filter((item): item is NavItem => Boolean(item))
        // Sections switched off for this build, including the ones with no module behind them.
        .filter((item) => !isSectionHidden(item.id))
        .filter((item) => {
          const moduleId = getModuleIdForSection(item.id);
          return moduleId ? enabledModules[moduleId] : true;
        });

      if (isSuperAdmin) {
        items.push({ id: 'admin', label: 'Super Admin', icon: ShieldIcon, group: 'admin' });
      }
      return items;
    },
    [enabledModules, isB2B, isSuperAdmin, moduleConfig, strategyBadge]
  );

  return (
    <>
      <PrimerHeader style={{ borderBottom: '1px solid var(--chrome-border)', backgroundColor: 'var(--app-chrome-bg, #111111)' }} className="min-w-0">
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
              color: 'var(--chrome-fg)',
              border: '1px solid var(--chrome-control-border)',
              background: 'var(--chrome-control-bg)',
              borderRadius: 8
            }}
            aria-label="Menu"
          />
        </PrimerHeader.Item>

        <PrimerHeader.Item style={{ flex: '0 1 auto', minWidth: 0 }} className="min-w-0">
          <PrimerHeader.Link
            as="button"
            type="button"
            onClick={(e) => { e.preventDefault(); onSectionChange('dashboard'); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
              border: 'none',
              background: 'transparent',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            <PerformancePlusLogo height={30} className="max-w-[6.5rem] min-[420px]:max-w-[9rem] sm:max-w-none" variant="onLight" />
          </PrimerHeader.Link>
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
            {ACCENT_PICKER_ENABLED && <AccentMenu />}
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
              borderRight: '1px solid var(--chrome-border)',
              overflowY: 'auto',
              overflowX: 'hidden',
              backgroundColor: 'var(--app-chrome-bg, #111111)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{ 
              padding: '8px 16px', 
              borderBottom: '1px solid var(--chrome-border)',
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
                  background: 'var(--chrome-control-hover)',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--chrome-fg-subtle)'
                }}
              >
                <PinIcon size={14} />
              </button>
            </div>
            <div style={{ padding: 12, flex: 1, overflowY: 'auto' }}>
              <SidebarNav navItems={navItems} activeSection={activeSection} onSelect={(id) => onSectionChange(id)} />
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
            backgroundColor: 'var(--app-canvas-bg, var(--nts-bg-pure))'
          }}
        >
          <div className="mx-auto w-full max-w-[1400px] px-3 pb-28 pt-4 sm:px-4 sm:pb-28 sm:pt-5 md:px-6 md:py-6">
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
              backgroundColor: 'var(--app-chrome-bg, #111111)',
              borderRight: '1px solid var(--chrome-border)',
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
              borderBottom: '1px solid var(--chrome-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <button
                type="button"
                onClick={() => onSectionChange('dashboard')}
                style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                title="Dashboard"
              >
                <PerformancePlusLogo height={40} variant="onLight" />
              </button>
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
                    color: 'var(--chrome-fg-subtle)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--chrome-control-hover)'; }}
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
                    color: 'var(--chrome-fg-subtle)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--chrome-control-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <XIcon size={16} />
                </button>
              </div>
            </div>
            {/* Navigation */}
            <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
              <SidebarNav
                navItems={navItems}
                activeSection={activeSection}
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

