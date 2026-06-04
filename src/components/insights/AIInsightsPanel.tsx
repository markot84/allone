import { motion } from 'framer-motion';

/** @deprecated Το slide-over αντικαταστάθηκε από τη σελίδα `#insights`. */
export function AIInsightsPanel() {
  return null;
}

export function AIInsightsTrigger({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-xl flex items-center justify-center z-30 overflow-hidden bg-white border-2 border-[var(--nts-accent)]/20"
      aria-label="AI Insights — άνοιγμα σελίδας"
    >
      <img
        src="/nilia.png"
        alt=""
        className="w-12 h-12 object-contain"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          target.parentElement!.style.background = 'var(--nts-accent)';
          target.parentElement!.innerHTML +=
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg>';
        }}
      />
    </motion.button>
  );
}

export function AIInsightsTriggerWrapper({ onClick }: { onClick: () => void }) {
  return <AIInsightsTrigger onClick={onClick} />;
}
