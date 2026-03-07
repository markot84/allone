import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Header as PrimerHeader,
  NavList,
  Text,
  TextInput
} from '@primer/react';
import { Button } from '../common';
import { useAuth, useBrand } from '../../hooks';
import type { Brand } from '../../types';
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
  ThreeBarsIcon,
  XIcon
} from '@primer/octicons-react';
import { Upload, UserPlus, Building2, Target, Euro } from 'lucide-react';

type SectionId =
  | 'brands'
  | 'dashboard'
  | 'strategy'
  | 'calendar'
  | 'rfm'
  | 'products'
  | 'channels'
  | 'campaigns'
  | 'finances'
  | 'reports'
  | 'roi'
  | 'insights'
  | 'data'
  | 'invite'
  | 'help';

export interface AppShellProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  children: React.ReactNode;
}

type NavItem = { id: SectionId; label: string; icon: any };

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
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          border: '1px solid rgba(249, 115, 22, 0.35)',
          borderRadius: 8,
          background: 'var(--nts-accent-light)',
          cursor: brands.length > 1 ? 'pointer' : 'default',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nts-accent)'
        }}
      >
        <Text as="span" size="small" weight="semibold">{currentBrand.name}</Text>
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
  onClose
}: {
  user: { email?: string | null; displayName?: string | null } | null;
  onSignOut: () => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
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
          border: '1px solid var(--borderColor-default, #d0d7de)',
          borderRadius: 6,
          background: 'var(--bgColor-default, #ffffff)',
          cursor: 'pointer',
          fontSize: 14
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'var(--bgColor-accent-emphasis, #0969da)',
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
        <Text as="span" size="small" className="hidden sm:inline" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            </div>
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

export function AppShell({ activeSection, onSectionChange, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { currentBrand, brands, setCurrentBrand } = useBrand();

  const navItems = useMemo<NavItem[]>(
    () => [
      { id: 'brands', label: 'Τα Brands μου', icon: Building2 },
      { id: 'dashboard', label: 'Dashboard', icon: HomeIcon },
      { id: 'strategy', label: 'Strategy Weights', icon: GraphIcon },
      { id: 'products', label: 'Product Intelligence', icon: PackageIcon },
      { id: 'rfm', label: 'Data Analysis', icon: OrganizationIcon },
      { id: 'channels', label: 'Channel Activation', icon: MegaphoneIcon },
      { id: 'campaigns', label: 'Campaigns', icon: Target },
      { id: 'finances', label: 'Οικονομικά', icon: Euro },
      { id: 'roi', label: 'ROI', icon: GraphIcon },
      { id: 'calendar', label: 'Content Strategy', icon: PencilIcon },
      { id: 'reports', label: 'Reports', icon: ReportIcon },
      { id: 'insights', label: 'AI Insights', icon: LightBulbIcon },
      { id: 'data', label: 'Data Import', icon: Upload },
      { id: 'invite', label: 'Καλέστε χρήστη', icon: UserPlus },
      { id: 'help', label: 'Help & Support', icon: GearIcon }
    ],
    []
  );

  const Nav = ({ onSelect }: { onSelect: (id: SectionId) => void }) => (
    <NavList aria-label="Primary">
      {navItems.map((item) => (
        <NavList.Item
          key={item.id}
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
          {item.label}
        </NavList.Item>
      ))}
    </NavList>
  );

  return (
    <>
      <PrimerHeader style={{ borderBottom: '1px solid var(--borderColor-default, #d0d7de)' }}>
        <PrimerHeader.Item>
          <Button
            variant="ghost"
            size="sm"
            icon={<ThreeBarsIcon />}
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
          >
            Menu
          </Button>
        </PrimerHeader.Item>

        <PrimerHeader.Item full style={{ minWidth: 0 }}>
          <PrimerHeader.Link
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--borderColor-default, #d0d7de)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                color: 'var(--fgColor-default, #24292f)'
              }}
            >
              P+
            </div>
            <div style={{ minWidth: 0 }}>
              <Text as="div" weight="semibold" size="medium" className="truncate">
                Performance+
              </Text>
              <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)' }} className="truncate">
                by notthesame.ai
              </Text>
            </div>
          </PrimerHeader.Link>
        </PrimerHeader.Item>

        <PrimerHeader.Item full className="hidden md:block" style={{ maxWidth: 520 }}>
          <TextInput
            leadingVisual={SearchIcon}
            aria-label="Search"
            placeholder="Search…"
            block
          />
        </PrimerHeader.Item>

        {currentBrand && (
          <PrimerHeader.Item>
            <BrandMenu
              currentBrand={currentBrand}
              brands={brands}
              isOpen={brandMenuOpen}
              onToggle={() => setBrandMenuOpen((o) => !o)}
              onClose={() => setBrandMenuOpen(false)}
              onSelect={setCurrentBrand}
            />
          </PrimerHeader.Item>
        )}

        <PrimerHeader.Item style={{ position: 'relative', overflow: 'visible' }}>
          <AccountMenu
            user={user}
            onSignOut={signOut}
            isOpen={userMenuOpen}
            onToggle={() => setUserMenuOpen((o) => !o)}
            onClose={() => setUserMenuOpen(false)}
          />
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
        {/* Sidebar */}
        <div 
          className="hidden md:block"
          style={{
            width: 260,
            minWidth: 260,
            maxWidth: 260,
            borderRight: '1px solid var(--borderColor-default, #d0d7de)',
            overflowY: 'auto',
            overflowX: 'hidden',
            backgroundColor: 'var(--nts-bg-pure)'
          }}
        >
          {currentBrand && (
            <div
              style={{
                margin: 12,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--nts-accent-light)',
                border: '1px solid rgba(249, 115, 22, 0.3)'
              }}
            >
              <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)', marginBottom: 4 }}>
                Brand
              </Text>
              <Text as="div" weight="semibold" size="medium" style={{ color: 'var(--nts-accent)' }}>
                {currentBrand.name}
              </Text>
              {currentBrand.type && (
                <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)', marginTop: 2 }}>
                  {currentBrand.type}
                </Text>
              )}
            </div>
          )}
          <div style={{ padding: 16 }}>
            <Nav onSelect={(id) => onSectionChange(id)} />
          </div>
        </div>

        {/* Main Content */}
        <div 
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
          <div style={{ 
            maxWidth: 1400,
            margin: '0 auto',
            padding: 24,
            width: '100%'
          }}>
            {children}
          </div>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      {mobileNavOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setMobileNavOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              zIndex: 999,
              animation: 'fadeIn 0.2s ease-out'
            }}
          />
          {/* Mobile Navigation Drawer */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: 280,
              maxWidth: '80vw',
              backgroundColor: 'var(--nts-bg-pure)',
              borderRight: '1px solid var(--borderColor-default, #d0d7de)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
              animation: 'slideInLeft 0.2s ease-out',
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ 
              padding: 16, 
              borderBottom: '1px solid var(--borderColor-default, #d0d7de)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border: '1px solid var(--borderColor-default, #d0d7de)',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      color: 'var(--fgColor-default, #24292f)'
                    }}
                  >
                    P+
                  </div>
                  <div>
                    <Text as="div" weight="semibold" size="medium">
                      Performance+
                    </Text>
                    <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)' }}>
                      by notthesame.ai
                    </Text>
                  </div>
                </div>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  style={{
                    padding: 8,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--fgColor-muted, #57606a)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bgColor-muted, #f6f8fa)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <XIcon />
                </button>
              </div>
              {currentBrand && (
                <div style={{ padding: '0 12px 12px' }}>
                  <Text as="div" size="small" style={{ color: 'var(--fgColor-muted, #57606a)', marginBottom: 6 }}>
                    Brand
                  </Text>
                  {brands.length > 1 ? (
                    brands.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setCurrentBrand(b); setMobileNavOpen(false); }}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          textAlign: 'left',
                          border: 'none',
                          borderRadius: 8,
                          background: currentBrand?.id === b.id ? 'var(--nts-accent-light)' : 'var(--bgColor-muted, #f6f8fa)',
                          cursor: 'pointer',
                          fontSize: 14,
                          color: currentBrand?.id === b.id ? 'var(--nts-accent)' : 'var(--fgColor-default, #24292f)',
                          fontWeight: currentBrand?.id === b.id ? 600 : 400,
                          marginBottom: 4
                        }}
                      >
                        {b.name}
                      </button>
                    ))
                  ) : (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--nts-accent-light)',
                        border: '1px solid rgba(249, 115, 22, 0.3)'
                      }}
                    >
                      <Text as="div" weight="semibold" style={{ color: 'var(--nts-accent)' }}>
                        {currentBrand.name}
                      </Text>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Navigation */}
            <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
              <Nav
                onSelect={(id) => {
                  setMobileNavOpen(false);
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

