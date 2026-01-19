import { Bell, Menu, Search, Settings, User } from 'lucide-react';
import { motion } from 'framer-motion';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenSidebar?: () => void;
}

export function Header({ title, subtitle, onOpenSidebar }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-[var(--nts-border-gray)] px-6 flex items-center justify-between sticky top-0 z-40">
      {/* Page Title */}
      <div className="flex items-start gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="md:hidden mt-0.5 p-2 -ml-2 rounded-md hover:bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)]"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <motion.h1
          key={title}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xl font-semibold text-[var(--nts-charcoal)] tracking-tight truncate"
        >
          {title}
        </motion.h1>
        {subtitle && <p className="hidden sm:block text-[13px] text-[var(--nts-medium-gray)] mt-0.5 truncate">{subtitle}</p>}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
          <input
            type="text"
            placeholder="Search..."
            className="w-72 pl-10 pr-3 py-2 bg-white border border-[var(--nts-border-gray)] rounded-md text-[14px] focus:outline-none focus:border-[#0969da] transition-colors placeholder:text-[#8c959f]"
          />
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-md hover:bg-[var(--nts-light-gray)] transition-colors">
          <Bell size={18} className="text-[var(--nts-medium-gray)]" />
        </button>

        {/* Settings */}
        <button className="p-2 rounded-md hover:bg-[var(--nts-light-gray)] transition-colors">
          <Settings size={18} className="text-[var(--nts-medium-gray)]" />
        </button>

        {/* User Menu */}
        <div className="flex items-center gap-3 pl-3 border-l border-[var(--nts-border-gray)]">
          <div className="w-8 h-8 bg-white rounded-full border border-[var(--nts-border-gray)] flex items-center justify-center">
            <User size={16} className="text-[var(--nts-medium-gray)]" />
          </div>
          <div className="hidden lg:block">
            <p className="text-[14px] font-semibold text-[var(--nts-charcoal)]">Marketing Team</p>
            <p className="text-[12px] text-[var(--nts-medium-gray)]">Admin</p>
          </div>
        </div>
      </div>
    </header>
  );
}
