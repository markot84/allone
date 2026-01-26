import { useMemo, useState } from 'react';
import {
  Header as PrimerHeader,
  NavList,
  Text,
  TextInput
} from '@primer/react';
import { Button } from '../common';
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
import { Upload } from 'lucide-react';

type SectionId =
  | 'dashboard'
  | 'strategy'
  | 'calendar'
  | 'rfm'
  | 'products'
  | 'channels'
  | 'reports'
  | 'roi'
  | 'insights'
  | 'data'
  | 'help';

export interface AppShellProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  children: React.ReactNode;
}

type NavItem = { id: SectionId; label: string; icon: any };

export function AppShell({ activeSection, onSectionChange, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = useMemo<NavItem[]>(
    () => [
      { id: 'dashboard', label: 'Dashboard', icon: HomeIcon },
      { id: 'strategy', label: 'Strategy Weights', icon: GraphIcon },
      { id: 'calendar', label: 'Content Strategy', icon: PencilIcon },
      { id: 'rfm', label: 'RFM Analysis', icon: OrganizationIcon },
      { id: 'products', label: 'Product Intelligence', icon: PackageIcon },
      { id: 'channels', label: 'Channel Activation', icon: MegaphoneIcon },
      { id: 'reports', label: 'Reports', icon: ReportIcon },
      { id: 'roi', label: 'ROI Attribution', icon: GraphIcon },
      { id: 'insights', label: 'AI Insights', icon: LightBulbIcon },
      { id: 'data', label: 'Data Import', icon: Upload },
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
          onClick={() => onSelect(item.id)}
          aria-current={activeSection === item.id ? 'page' : undefined}
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
            backgroundColor: 'var(--bgColor-default, #ffffff)'
          }}
        >
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
            backgroundColor: 'var(--bgColor-default, #ffffff)'
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
              backgroundColor: 'var(--bgColor-default, #ffffff)',
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
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
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
            {/* Navigation */}
            <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
              <Nav
                onSelect={(id) => {
                  onSectionChange(id);
                  setMobileNavOpen(false);
                }}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

