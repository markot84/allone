import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MainContentProps {
  children: ReactNode;
  sidebarCollapsed: boolean;
}

export function MainContent({ children, sidebarCollapsed }: MainContentProps) {
  return (
    <main
      className={`min-h-screen bg-[var(--nts-light-gray)] transition-[margin] duration-200
        ml-0
        ${sidebarCollapsed ? 'md:ml-20' : 'md:ml-[280px]'}
      `}
    >
      <AnimatePresence mode="wait">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="p-4 sm:p-6 lg:p-8"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
