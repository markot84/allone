import { motion } from 'framer-motion';

/** @deprecated Το slide-over αντικαταστάθηκε από τη σελίδα `#insights`. */
export function AIInsightsPanel() {
  return null;
}

export function AIInsightsTrigger({ onClick }: { onClick: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-30 w-14 h-14">
      {/* Ακτινωτή λάμψη — δαχτυλίδια που εκπέμπονται προς τα έξω */}
      {[0, 1].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(245,130,32,0.45) 0%, rgba(245,130,32,0) 70%)' }}
          initial={{ scale: 0.8, opacity: 0.6 }}
          animate={{ scale: 2.1, opacity: 0 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut', delay: i * 1.2 }}
        />
      ))}
      <motion.button
        type="button"
        onClick={onClick}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          boxShadow: [
            '0 0 0 0 rgba(245,130,32,0.0)',
            '0 0 18px 4px rgba(245,130,32,0.55)',
            '0 0 0 0 rgba(245,130,32,0.0)',
          ],
        }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        className="relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center overflow-hidden"
        aria-label="AI Insights — άνοιγμα σελίδας"
      >
        <img
          src="/nilia.png"
          alt=""
          className="w-full h-full object-cover"
          style={{ filter: 'contrast(1.15) saturate(1.2)' }}
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
