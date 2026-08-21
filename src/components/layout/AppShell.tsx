import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Text } from '@primer/react';
import { AllOneLogo } from '../common';
import { AppChromeProvider, useAppChrome } from './AppChrome';
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
  ReportIcon,
  SearchIcon,
  ShieldIcon,
  ThreeBarsIcon,
  XIcon
} from '@primer/octicons-react';
import { Upload, UserPlus, Building2, Target, Euro, Truck, FileSpreadsheet, GitPullRequestArrow, Zap, BarChart3, ShoppingBag, Handshake, Users, Globe2, HeartHandshake, MapPin, ClipboardList, Palette, Lightbulb } from 'lucide-react';
import { NotificationBell } from '../coordination/NotificationBell';

const RAIL_OPEN_KEY = 'perf-plus-rail-open';

/** The artboard's second face: every number, key cap, tab and eyebrow label is set in it. */
const MONO = "'JetBrains Mono', monospace";

export interface AppShellProps {
  activeSection: string;
  onSectionChange: (section: string, opts?: { hashQuery?: string }) => void;
  children: React.ReactNode;
}

type NavGroup = 'business' | 'commerce' | 'commercial' | 'marketing' | 'procurement' | 'finance' | 'operations' | 'admin';
type NavIcon = React.ComponentType<{ size?: number }>;
type NavItem = { id: AppSectionId; label: string; icon: NavIcon; badge?: string; group: NavGroup };
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

/**
 * The rail's navigation list.
 *
 * Primer's `NavList` was doing the markup here, which meant every rule of the artboard — the mono
 * group label with its hairline, the 9px radius, the gold marker down the leading edge of the
 * active item — had to be forced through `!important` overrides in `index.css`. The list is a
 * dozen lines of flexbox; owning it is cheaper than fighting a component that wants to look like
 * something else.
 */
function RailNav({
  navItems,
  activeSection,
  collapsed,
  onSelect,
}: {
  navItems: NavItem[];
  activeSection: string;
  collapsed: boolean;
  onSelect: (id: AppSectionId) => void;
}) {
  const cascadeLit = useCascadeHighlight();

  const isCurrent = (item: NavItem) =>
    activeSection === item.id || (item.id === 'data' && activeSection.startsWith('data-'));

  /** Groups in nav order, so a group heading is emitted once per run of items that share it. */
  const groups = navItems.reduce<{ group: NavGroup; items: NavItem[] }[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else acc.push({ group: item.group, items: [item] });
    return acc;
  }, []);

  const handleClick = (e: React.MouseEvent, id: AppSectionId) => {
    // Let the browser handle ctrl/cmd/shift-click and middle-click so "open in new tab" works;
    // only plain clicks stay in-SPA.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: collapsed ? 2 : 6,
        alignItems: collapsed ? 'center' : 'stretch',
      }}
    >
      {groups.map(({ group, items }) => (
        <div
          key={group}
          style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: collapsed ? 'center' : 'stretch' }}
        >
          {!collapsed && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px 4px',
                fontFamily: MONO,
                fontSize: 9.5,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--chrome-fg-subtle)',
                lineHeight: 1.3,
              }}
            >
              {NAV_GROUP_LABELS[group]}
              <span style={{ flex: 1, height: 1, background: 'var(--chrome-border)', display: 'block' }} />
            </span>
          )}
          {items.map((item) => {
            const current = isCurrent(item);
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                title={collapsed ? item.label : undefined}
                aria-current={current ? 'page' : undefined}
                onClick={(e) => handleClick(e, item.id)}
                className={`rail-nav-item${current ? ' rail-nav-item--current' : ''}${
                  cascadeLit.has(item.id) ? ' nav-cascade-pulse' : ''
                }`}
                style={
                  collapsed
                    ? {
                        width: 38,
                        height: 26,
                        flex: 'none',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textDecoration: 'none',
                      }
                    : {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '7px 10px',
                        borderRadius: 9,
                        fontSize: 13,
                        fontWeight: current ? 700 : 500,
                        textDecoration: 'none',
                      }
                }
              >
                <Icon size={16} />
                {!collapsed && (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.label}
                    {item.badge && (
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 9,
                          fontWeight: 700,
                          lineHeight: 1,
                          padding: '3px 5px',
                          borderRadius: 999,
                          background: 'var(--gold-500)',
                          color: 'var(--navy-900)',
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      ))}
    </div>
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
      {/* The artboard's "SportFlow ▾": the brand sits beside the section title as a mono eyebrow,
          not as a boxed control. It only reads as a control when there is more than one brand. */}
      <button
        ref={btnRef}
        type="button"
        title={currentBrand.name}
        onClick={onToggle}
        className="brand-eyebrow"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: brands.length > 1 ? 'pointer' : 'default',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--chrome-fg-muted)',
          minWidth: 0,
          maxWidth: 'min(100%, 12rem)',
        }}
      >
        <Text
          as="span"
          className="min-w-0 max-w-[6rem] truncate sm:max-w-[10rem]"
          style={{ font: 'inherit', color: 'inherit' }}
        >
          {currentBrand.name}
        </Text>
        {brands.length > 1 && <span aria-hidden>▾</span>}
      </button>
      {brands.length > 1 && isOpen && createPortal(
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999 }} aria-hidden />
          <div
            style={{
              ...menuStyle,
              background: 'var(--bgColor-default, var(--surface-0))',
              border: '1px solid var(--borderColor-default, var(--border))',
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
                  background: currentBrand?.id === b.id ? 'var(--bgColor-muted, var(--surface-2))' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: currentBrand?.id === b.id ? 'var(--nts-accent)' : 'var(--fgColor-default, var(--text-primary))'
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
  onLinkGoogle,
  initial,
  label,
  caption,
  collapsed
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
  /** Rail footer presentation — the avatar letter, the name under it and the caption below that. */
  initial: string;
  label: string;
  caption: string;
  collapsed: boolean;
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
      const left = Math.min(Math.max(gutter, rect.left), viewportWidth - width - gutter);
      // The trigger now lives at the BOTTOM of the rail, so the menu rises from it. Anchored by
      // `bottom` rather than `top` so it grows upward and never runs off the foot of the viewport.
      setMenuStyle({
        position: 'fixed',
        bottom: Math.max(gutter, window.innerHeight - rect.top + 6),
        left,
        width,
        minWidth: 0,
        maxWidth: `calc(100vw - ${gutter * 2}px)`,
        maxHeight: `calc(100vh - ${gutter * 2}px)`,
        overflowY: 'auto',
        zIndex: 1000
      });
    }
  }, [isOpen]);

  if (!user) return null;

  return (
    <>
      {/* The rail footer: an orange initial tile, the account name, and the active strategy as a
          mono caption. The whole strip is the menu trigger. */}
      <button
        ref={btnRef}
        onClick={onToggle}
        title={user.email || user.displayName || 'Account'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="rail-account"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          width: collapsed ? 'auto' : '100%',
          minWidth: 0,
          padding: collapsed ? 0 : '4px 2px',
          border: 'none',
          borderRadius: 8,
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: collapsed ? 26 : 28,
            height: collapsed ? 26 : 28,
            flex: 'none',
            borderRadius: 8,
            background: 'var(--orange-500)',
            color: 'var(--navy-900)',
            fontSize: 11.5,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {initial}
        </span>
        {!collapsed && (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--chrome-fg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--chrome-fg-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {caption}
            </span>
          </span>
        )}
      </button>
      {isOpen && createPortal(
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999 }} aria-hidden />
          <div
            style={{
              ...menuStyle,
              background: 'var(--bgColor-default, var(--surface-0))',
              border: '1px solid var(--borderColor-default, var(--border))',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            <div style={{ padding: 12, borderBottom: '1px solid var(--borderColor-default, var(--border))' }}>
              <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, var(--text-muted))', marginBottom: 2 }}>Account</Text>
              <Text as="div" size="small" weight="semibold" style={{ wordBreak: 'break-all' }}>{user.email}</Text>
              {user.displayName && (
                <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, var(--text-muted))' }}>{user.displayName}</Text>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {hasPasswordProvider && (
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'rgba(45,164,78,0.1)', color: 'var(--success-700)' }}>Email/Password</span>
                )}
                {/* Google's own blue: this badge says which provider the account signs in with. */}
                {hasGoogleProvider && (
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'rgba(66,133,244,0.1)', color: '#4285F4' }}>Google</span>
                )}
              </div>
            </div>

            {/* Accent color (per-user, localStorage) — off while the brand palette is fixed. */}
            {ACCENT_PICKER_ENABLED && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--borderColor-default, var(--border))' }}>
              <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, var(--text-muted))', marginBottom: 8 }}>
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
                        border: selected ? '2px solid var(--fgColor-default, var(--text-primary))' : '2px solid transparent',
                        boxShadow: selected ? `0 0 0 2px ${preset.swatch}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      {selected && (
                        <span style={{ color: 'var(--surface-0)', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            )}

            {/* Link providers */}
            {!hasPasswordProvider && (
              <div style={{ borderBottom: '1px solid var(--borderColor-default, var(--border))' }}>
                {!showSetPassword ? (
                  <button
                    onClick={() => setShowSetPassword(true)}
                    style={{
                      width: '100%', padding: '10px 12px', textAlign: 'left',
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontSize: 13, color: 'var(--fgColor-default, var(--text-primary))'
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
                          border: 'none', background: 'var(--nts-accent)', color: 'var(--surface-0)', cursor: 'pointer'
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
              <div style={{ borderBottom: '1px solid var(--borderColor-default, var(--border))' }}>
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
                    fontSize: 13, color: 'var(--fgColor-default, var(--text-primary))'
                  }}
                >
                  Σύνδεση Google λογαριασμού
                </button>
              </div>
            )}

            {linkMsg && (
              <div style={{
                padding: '6px 12px', fontSize: 12,
                color: linkMsg.type === 'ok' ? 'var(--success-700)' : 'var(--danger-600)',
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
                color: 'var(--danger-fg, var(--danger-600))'
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
              background: 'var(--bgColor-default, var(--surface-0))',
              border: '1px solid var(--borderColor-default, var(--border))',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              padding: 12,
            }}
          >
            <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, var(--text-muted))', marginBottom: 8 }}>
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
                      border: selected ? '2px solid var(--fgColor-default, var(--text-primary))' : '2px solid transparent',
                      boxShadow: selected ? `0 0 0 2px ${preset.swatch}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    {selected && <span style={{ color: 'var(--surface-0)', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
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

const RAIL_WIDTH_OPEN = 238;
const RAIL_WIDTH_CLOSED = 62;

/** The search affordance at the top of the rail. Dispatches the same ⌘K the palette listens for. */
function RailSearch({ collapsed }: { collapsed: boolean }) {
  const open = () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
    );
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={open}
        title="Αναζήτηση (⌘K)"
        aria-label="Αναζήτηση"
        className="rail-control"
        style={{
          width: 38,
          height: 26,
          flex: 'none',
          border: 'none',
          borderRadius: 8,
          background: 'var(--chrome-control-bg)',
          color: 'var(--chrome-fg-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SearchIcon size={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Αναζήτηση"
      className="rail-control"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        background: 'var(--chrome-control-bg)',
        border: '1px solid var(--chrome-control-border)',
        borderRadius: 10,
        padding: '8px 10px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', color: 'var(--chrome-fg-muted)', flex: 'none' }}>
        <SearchIcon size={14} />
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--chrome-fg-muted)' }}>Αναζήτηση</span>
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 700,
          color: 'var(--chrome-fg-muted)',
          background: 'var(--chrome-control-hover)',
          border: '1px solid var(--chrome-control-hover)',
          borderRadius: 5,
          padding: '2px 5px',
        }}
      >
        ⌘K
      </span>
    </button>
  );
}

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

  /** Expanded vs the 62px icon rail. Persisted, so the choice survives a reload. */
  const [railOpen, setRailOpen] = useState(() => {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(RAIL_OPEN_KEY) !== '0';
    return true;
  });
  /** Below 1024px there is no room for a column at all — the rail becomes an overlay drawer. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const { user, signOut, isSuperAdmin, hasPasswordProvider, hasGoogleProvider, linkPassword, linkGoogle } = useAuth();
  const { currentBrand, brands, setCurrentBrand } = useBrand();
  const { isB2B, enabledModules, moduleConfig } = useModules();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  useBrandMembers();

  const [tabsNode, setTabsNode] = useState<HTMLElement | null>(null);
  const [actionsNode, setActionsNode] = useState<HTMLElement | null>(null);

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
      return { text: `${dur}ημ` };
    }
    const elapsedDays = Math.floor((nowMs - startMs) / 86400000);
    if (elapsedDays < 1) return { text: `${dur}ημ` };
    const remaining = dur - elapsedDays;
    if (remaining <= 0) return { text: 'Έληξε' };
    return { text: `${remaining}ημ` };
  }, [activeStrategy, nowMs]);

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RAIL_OPEN_KEY, next ? '1' : '0');
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
        { id: 'strategy', label: 'Commercial Strategy', icon: GraphIcon, group: 'commercial', ...(strategyBadge ? { badge: strategyBadge.text } : {}) },
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

  /** The top bar's title. `activeSection` can be a sub-route (`data-...`), hence the prefix match. */
  const sectionTitle =
    navItems.find((item) => item.id === activeSection)?.label ??
    navItems.find((item) => activeSection.startsWith(`${item.id}-`))?.label ??
    (isB2B ? 'Owner Dashboard' : 'Dashboard');

  const userInitial = (user?.email?.[0] || user?.displayName?.[0] || '?').toUpperCase();
  const userLabel = (user?.email || user?.displayName || 'Account').split('@')[0];
  const strategyLabel = activeStrategy ? getStrategyName(activeStrategy.scenarioId) : 'Χωρίς ενεργή στρατηγική';

  /** The rail, at either width. Also the drawer's contents below 1024px, always expanded there. */
  const renderRail = (collapsed: boolean, inDrawer: boolean) => (
    <nav
      aria-label="Primary"
      style={{
        boxSizing: 'border-box',
        height: '100%',
        overflow: 'hidden',
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        width: inDrawer ? '100%' : collapsed ? RAIL_WIDTH_CLOSED : RAIL_WIDTH_OPEN,
        background: 'var(--chrome-bg)',
        borderRight: inDrawer ? 'none' : '1px solid var(--chrome-border)',
        padding: collapsed ? '9px 8px' : '14px 12px',
        gap: collapsed ? 6 : 10,
        alignItems: collapsed ? 'center' : 'stretch',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          padding: collapsed ? 0 : '0 2px',
        }}
      >
        <button
          type="button"
          onClick={() => onSectionChange('dashboard')}
          title="Dashboard"
          style={{
            height: collapsed ? 28 : 34,
            padding: collapsed ? '0 6px' : '0 8px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--surface-0)',
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
        >
          <AllOneLogo height={collapsed ? 20 : 24} variant="onLight" />
        </button>
        {!collapsed && !inDrawer && (
          <button
            type="button"
            onClick={toggleRail}
            title="Σύμπτυξη μενού"
            aria-label="Σύμπτυξη μενού"
            className="rail-control"
            style={{
              border: 'none',
              cursor: 'pointer',
              width: 26,
              height: 26,
              flex: 'none',
              borderRadius: 8,
              background: 'var(--chrome-control-bg)',
              color: 'var(--chrome-fg-muted)',
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            «
          </button>
        )}
        {inDrawer && (
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Κλείσιμο μενού"
            className="rail-control"
            style={{
              border: 'none',
              cursor: 'pointer',
              width: 26,
              height: 26,
              flex: 'none',
              borderRadius: 8,
              background: 'var(--chrome-control-bg)',
              color: 'var(--chrome-fg-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      {collapsed && !inDrawer && (
        <button
          type="button"
          onClick={toggleRail}
          title="Ανάπτυξη μενού"
          aria-label="Ανάπτυξη μενού"
          className="rail-control"
          style={{
            border: 'none',
            cursor: 'pointer',
            width: 24,
            height: 22,
            flex: 'none',
            borderRadius: 8,
            background: 'var(--chrome-control-bg)',
            color: 'var(--chrome-fg-muted)',
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          »
        </button>
      )}

      <RailSearch collapsed={collapsed} />

      <RailNav
        navItems={navItems}
        activeSection={activeSection}
        collapsed={collapsed}
        onSelect={(id) => {
          setDrawerOpen(false);
          onSectionChange(id);
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          borderTop: collapsed ? 'none' : '1px solid var(--chrome-border)',
          padding: collapsed ? 0 : '11px 2px 0',
        }}
      >
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
          initial={userInitial}
          label={userLabel}
          caption={strategyLabel}
          collapsed={collapsed}
        />
      </div>
    </nav>
  );

  return (
    <AppChromeProvider tabsNode={tabsNode} actionsNode={actionsNode}>
      <ChromeCanvas
        onSectionChange={onSectionChange}
        isWideLayout={isWideLayout}
        railOpen={railOpen}
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        renderRail={renderRail}
        sectionTitle={sectionTitle}
        currentBrand={currentBrand}
        brands={brands}
        brandMenuOpen={brandMenuOpen}
        setBrandMenuOpen={setBrandMenuOpen}
        setCurrentBrand={setCurrentBrand}
        setTabsNode={setTabsNode}
        setActionsNode={setActionsNode}
        mainContentScrollRef={mainContentScrollRef}
      >
        {children}
      </ChromeCanvas>
    </AppChromeProvider>
  );
}

/**
 * The frame itself: rail, navy top bar, canvas.
 *
 * Split out from `AppShell` only because it has to read `useAppChrome()` — the shell is the
 * component that *provides* that context, so it cannot consume it in the same render.
 */
function ChromeCanvas({
  onSectionChange,
  isWideLayout,
  railOpen,
  drawerOpen,
  setDrawerOpen,
  renderRail,
  sectionTitle,
  currentBrand,
  brands,
  brandMenuOpen,
  setBrandMenuOpen,
  setCurrentBrand,
  setTabsNode,
  setActionsNode,
  mainContentScrollRef,
  children,
}: {
  onSectionChange: (section: string, opts?: { hashQuery?: string }) => void;
  isWideLayout: boolean;
  railOpen: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  renderRail: (collapsed: boolean, inDrawer: boolean) => React.ReactNode;
  sectionTitle: string;
  currentBrand: Brand | null;
  brands: Brand[];
  brandMenuOpen: boolean;
  setBrandMenuOpen: (fn: (open: boolean) => boolean) => void;
  setCurrentBrand: (brand: Brand) => void;
  setTabsNode: (node: HTMLElement | null) => void;
  setActionsNode: (node: HTMLElement | null) => void;
  mainContentScrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const chrome = useAppChrome();
  const bleed = chrome?.bleed ?? false;
  const pageOwnsActions = (chrome?.actionsClaimed ?? 0) > 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
      {isWideLayout && renderRail(!railOpen, false)}

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            background: 'var(--chrome-bg)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            gap: 24,
            padding: '0 28px',
            flexWrap: 'wrap',
            flex: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', minWidth: 0 }}>
            {!isWideLayout && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Μενού"
                className="rail-control"
                style={{
                  alignSelf: 'center',
                  border: 'none',
                  cursor: 'pointer',
                  width: 32,
                  height: 32,
                  flex: 'none',
                  borderRadius: 8,
                  background: 'var(--chrome-control-bg)',
                  color: 'var(--chrome-fg-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ThreeBarsIcon size={16} />
              </button>
            )}
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 0', minWidth: 0 }}>
              <span
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  letterSpacing: '-0.025em',
                  color: 'var(--chrome-fg)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {sectionTitle}
              </span>
              {currentBrand && (
                <BrandMenu
                  currentBrand={currentBrand}
                  brands={brands}
                  isOpen={brandMenuOpen}
                  onToggle={() => setBrandMenuOpen((o) => !o)}
                  onClose={() => setBrandMenuOpen(() => false)}
                  onSelect={setCurrentBrand}
                />
              )}
            </span>
            <nav
              ref={setTabsNode}
              aria-label="Ενότητες σελίδας"
              style={{ display: 'flex', alignItems: 'stretch', gap: 26, flexWrap: 'wrap' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '9px 0' }}>
            <div ref={setActionsNode} style={{ display: 'contents' }} />
            {/* The bar's own controls stand down while a page fills the slot — it is expected to
                include whichever of them it still wants, in the order its design calls for. */}
            {!pageOwnsActions && <NotificationBell onNavigate={(s) => onSectionChange(s)} />}
            {ACCENT_PICKER_ENABLED && <AccentMenu />}
          </div>
        </header>

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
            backgroundColor: 'var(--app-canvas-bg, var(--surface-2))',
          }}
        >
          {bleed ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-[1400px] px-3 pb-28 pt-4 sm:px-4 sm:pb-28 sm:pt-5 md:px-6 md:py-6">
              {children}
            </div>
          )}
        </div>
      </div>

      {!isWideLayout && drawerOpen && createPortal(
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,34,94,0.45)', zIndex: 999, animation: 'fadeIn 0.2s ease-out' }}
            aria-hidden
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: RAIL_WIDTH_OPEN,
              maxWidth: '80vw',
              zIndex: 1000,
              display: 'flex',
              boxShadow: '0 8px 24px rgba(0, 34, 94, 0.4)',
              animation: 'slideInLeft 0.2s ease-out',
            }}
          >
            {renderRail(false, true)}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

