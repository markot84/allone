import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  SlidersHorizontal,
  Users,
  Package,
  Megaphone,
  FileText,
  BarChart3,
  Euro,
  Sparkles,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Link2,
  X,
  Lightbulb,
  Target
} from 'lucide-react';

interface NavItem {
  id: string;
  name: string;
  icon: React.ReactNode;
  badge?: string;
  linked?: boolean; // For visual connection indicator
}

const mainNavItems: NavItem[] = [
  { id: 'dashboard', name: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'strategy', name: 'Commercial Strategy', icon: <SlidersHorizontal size={18} />, linked: true },
  { id: 'products', name: 'Product Intelligence', icon: <Package size={18} /> },
  { id: 'rfm', name: 'Data Analysis', icon: <Users size={18} /> },
  { id: 'channels', name: 'Channel Activation', icon: <Megaphone size={18} /> },
  { id: 'campaigns', name: 'Campaigns', icon: <Target size={18} /> },
  { id: 'roi', name: 'ROI', icon: <Euro size={18} /> },
  { id: 'calendar', name: 'Content Strategy', icon: <FileText size={18} />, linked: true },
  { id: 'reports', name: 'Reports', icon: <BarChart3 size={18} /> }
];

const secondaryNavItems: NavItem[] = [
  { id: 'invite', name: 'Καλέστε χρήστη', icon: <Users size={18} /> },
  { id: 'concept', name: 'Concept', icon: <Lightbulb size={18} /> },
  { id: 'insights', name: 'AI Insights', icon: <Sparkles size={18} /> },
  { id: 'help', name: 'Help & Support', icon: <HelpCircle size={18} /> }
];

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ 
  activeSection, 
  onSectionChange, 
  collapsed, 
  onToggleCollapse,
  mobileOpen = false,
  onMobileClose
}: SidebarProps) {
  const handleNav = (id: string) => {
    onSectionChange(id);
    onMobileClose?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`md:hidden fixed inset-0 bg-black/30 z-40 transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onMobileClose}
      />

      <motion.aside
        initial={false}
        animate={{
          x: mobileOpen ? 0 : -320
        }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={`
          h-screen bg-white border-r border-[var(--nts-border-gray)] flex flex-col fixed left-0 top-0 z-50
          w-[280px] md:w-auto
          md:translate-x-0 md:!transform-none
          ${collapsed ? 'md:w-20' : 'md:w-[280px]'}
        `}
      >
      {/* Logo */}
      <div className="p-4 md:p-6 border-b border-[var(--nts-border-gray)]">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-white rounded-lg border border-[var(--nts-border-gray)] flex items-center justify-center flex-shrink-0">
            <span className="text-[var(--nts-charcoal)] font-bold text-lg">P+</span>
          </div>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="min-w-0"
            >
              <h1 className="font-semibold text-[var(--nts-charcoal)] text-[15px] leading-tight">Performance+</h1>
              <p className="text-[13px] text-[var(--nts-medium-gray)]">by notthesame.ai</p>
            </motion.div>
          )}

          {/* Mobile close */}
          <button
            type="button"
            onClick={onMobileClose}
            className="md:hidden ml-auto p-2 rounded-md hover:bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)]"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 md:py-6 px-3 md:px-4">
        <div className="space-y-1.5">
          {mainNavItems.map((item, index) => {
            const prevItem = index > 0 ? mainNavItems[index - 1] : null;
            const showConnection = !collapsed && item.linked && prevItem?.linked;

            return (
              <div key={item.id} className="relative">
                {/* Connection indicator line */}
                {showConnection && (
                  <div className="absolute left-5 -top-1 w-0.5 h-2 bg-[var(--nts-border-gray)]" />
                )}
                
                <NavButton
                  item={item}
                  isActive={activeSection === item.id}
                  collapsed={collapsed}
                  onClick={() => handleNav(item.id)}
                  showConnectionDot={!collapsed && item.linked}
                />

                {/* Connection label */}
                {/* Keep subtle connection, but avoid extra text noise */}
                {!collapsed && item.id === 'strategy' && (
                  <div className="flex items-center gap-1 ml-10 mt-0.5 mb-0.5">
                    <div className="w-0.5 h-4 bg-[var(--nts-border-gray)]" />
                    <Link2 size={12} className="text-[var(--nts-medium-gray)]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="my-3 md:my-6 border-t border-[var(--nts-border-gray)]" />

        <div className="space-y-1.5">
          {secondaryNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={activeSection === item.id}
              collapsed={collapsed}
              onClick={() => handleNav(item.id)}
            />
          ))}
        </div>
      </nav>

      {/* Collapse Toggle */}
      <div className="hidden md:block p-4 border-t border-[var(--nts-border-gray)]">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 p-2.5 rounded-md text-[var(--nts-medium-gray)] hover:bg-[var(--nts-light-gray)] transition-colors"
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          {!collapsed && <span className="text-[14px] font-medium">Collapse</span>}
        </button>
      </div>
    </motion.aside>
    </>
  );
}

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  showConnectionDot?: boolean;
}

function NavButton({ item, isActive, collapsed, onClick, showConnectionDot }: NavButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.97 }}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-md relative
        transition-colors duration-150 font-medium
        ${isActive
          ? 'bg-[var(--nts-light-gray)] text-[var(--nts-charcoal)] border border-[var(--nts-border-gray)]'
          : 'text-[var(--nts-medium-gray)] hover:bg-[var(--nts-light-gray)] hover:text-[var(--nts-charcoal)]'
        }
      `}
    >
      {/* Connection dot */}
      {showConnectionDot && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-[var(--nts-border-gray)] rounded-full" />
      )}
      
      <span className={`flex-shrink-0 text-[var(--nts-medium-gray)] ${isActive ? 'text-[var(--nts-charcoal)]' : ''}`}>
        {item.icon}
      </span>
      {!collapsed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between flex-1 min-w-0"
        >
          <span className="text-[14px] leading-5 truncate">{item.name}</span>
          {item.badge && (
            <span className={`
              text-[11px] px-2 py-0.5 rounded-full font-semibold
              bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] border border-[var(--nts-border-gray)]
            `}>
              {item.badge}
            </span>
          )}
        </motion.div>
      )}
    </motion.button>
  );
}
