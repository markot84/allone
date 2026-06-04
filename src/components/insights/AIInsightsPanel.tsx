import { motion } from 'framer-motion';

/** @deprecated Το slide-over αντικαταστάθηκε από τη σελίδα `#insights`. */
export function AIInsightsPanel() {
  return null;
}

export function AIInsightsTrigger({ onClick }: { onClick: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-30 w-14 h-14">
      <motion.button
        type="button"
        onClick={onClick}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="mark-launcher-orb relative w-14 h-14 rounded-full flex items-center justify-center overflow-hidden bg-white border border-[var(--nts-accent)]/20"
        aria-label="AI Insights — άνοιγμα σελίδας"
      >
        <img
          src="/mark-orb.png"
          alt=""
          className="mark-orb-img w-full h-full object-cover scale-110"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            target.parentElement!.style.background = 'var(--nts-accent)';
            target.parentElement!.innerHTML +=
              '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg>';
          }}
        />
      </motion.button>
    </div>
  );
}

export function AIInsightsTriggerWrapper({ onClick }: { onClick: () => void }) {
  return <AIInsightsTrigger onClick={onClick} />;
}
