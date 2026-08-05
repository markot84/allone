import { useMemo, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { groupIntoSentences, tokenizeBriefing, type BriefingToken } from '../../services/briefingTokens';
import { formatNumber } from '../../utils/format';
import type { BriefingData } from '../../services/morningBriefing';
import type { Campaign, RFMSegment } from '../../types';

/**
 * The briefing paragraph, as navigation.
 *
 * Numbers that match a value we actually hold get a popover naming the source; names that match a
 * segment, campaign, product or channel become links into that module. Everything else stays plain
 * text — see `briefingTokens.ts` for why matching against the data beats asking the model to
 * annotate itself.
 *
 * The reveal staggers by sentence, ~40ms apart, and only on the first read of the day. On every
 * later visit the paragraph is simply there: a briefing that re-animates each time you return to
 * the dashboard stops being an entrance and becomes a delay.
 */

interface BriefingNarrativeProps {
  narrative: string;
  data: BriefingData | null;
  segments?: RFMSegment[];
  campaigns?: Campaign[];
  platforms?: string[];
  onNavigate?: (section: string, opts?: { hashQuery?: string }) => void;
  /** First read of the day — see `claimFirstReadOfDay` in MorningBriefing. */
  animate: boolean;
}

const SENTENCE_STAGGER_S = 0.04;

export function BriefingNarrative({
  narrative,
  data,
  segments,
  campaigns,
  platforms,
  onNavigate,
  animate,
}: BriefingNarrativeProps) {
  const sentences = useMemo(() => {
    if (!data) return [[{ kind: 'text' as const, value: narrative }]];
    return groupIntoSentences(tokenizeBriefing(narrative, data, { segments, campaigns, platforms }));
  }, [campaigns, data, narrative, platforms, segments]);

  return (
    // `whitespace-pre-line` keeps any paragraph break the model produces. The prompt asks for one
    // paragraph, but losing a break silently if it ever sends two is not worth the saved class.
    <p className="whitespace-pre-line text-[14px] leading-relaxed text-[var(--nts-charcoal)]">
      {sentences.map((sentence, index) => (
        <motion.span
          key={index}
          initial={animate ? { opacity: 0, y: 3 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: animate ? index * SENTENCE_STAGGER_S : 0 }}
        >
          {sentence.map((token, tokenIndex) => (
            <TokenView key={tokenIndex} token={token} onNavigate={onNavigate} />
          ))}
        </motion.span>
      ))}
    </p>
  );
}

function TokenView({
  token,
  onNavigate,
}: {
  token: BriefingToken;
  onNavigate?: (section: string, opts?: { hashQuery?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  if (token.kind === 'text') return <>{token.value}</>;

  const { section, hashQuery } = token;
  const navigate =
    section && onNavigate ? () => onNavigate(section, hashQuery ? { hashQuery } : undefined) : undefined;

  // Spans, not buttons. A `<button>` is an atomic inline box however it is styled, and an atomic box
  // creates a line-break opportunity after it — which is how a comma ends up alone at the start of a
  // line. These have to sit inside running prose without disturbing it.
  const activation = navigate
    ? {
        role: 'link',
        tabIndex: 0,
        onClick: navigate,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigate();
          }
        },
      }
    : {};

  if (token.kind === 'entity') {
    return (
      <span
        {...activation}
        className="cursor-pointer rounded font-semibold text-[var(--nts-accent-text)] underline decoration-[var(--nts-accent)]/40 decoration-1 underline-offset-2 transition-colors duration-[var(--dur-state)] hover:bg-[var(--orange-50)] hover:decoration-[var(--nts-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nts-accent)]/40"
        title={`${token.label} — άνοιγμα`}
      >
        {token.value}
      </span>
    );
  }

  // Metric: hover or keyboard focus opens the source popover; a click still navigates when the
  // number has a module behind it.
  //
  // The popover is measured from the trigger and portalled to the body rather than positioned
  // against it in the flow. An inline `position: relative` parent gives absolutely-positioned
  // children a containing block derived from its first line fragment — so on any metric that is not
  // on the first line, the popover lands somewhere else entirely. A portal also escapes the
  // transform framer-motion puts on each sentence, which would otherwise capture `position: fixed`.
  const openPopover = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setAnchor({ left: rect.left + rect.width / 2, top: rect.top });
    setOpen(true);
  };

  return (
    <span>
      <span
        {...activation}
        tabIndex={0}
        onMouseEnter={(event) => openPopover(event.currentTarget)}
        onMouseLeave={() => setOpen(false)}
        onFocus={(event) => openPopover(event.currentTarget)}
        onBlur={() => setOpen(false)}
        className={`rounded font-semibold text-[var(--text-heading)] underline decoration-dotted decoration-1 underline-offset-4 transition-colors duration-[var(--dur-state)] hover:bg-[var(--navy-50)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nts-accent)]/40 ${
          navigate ? 'cursor-pointer' : 'cursor-help'
        }`}
        data-numeric
        aria-label={`${token.value} — ${token.label}`}
      >
        {token.value}
      </span>
      {open && anchor && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-left text-[11px] font-normal leading-snug shadow-lg"
          style={{ left: anchor.left, top: anchor.top - 8 }}
        >
          <span className="block font-semibold text-[var(--text-primary)]">{token.label}</span>
          <span className="mt-0.5 block text-[var(--text-secondary)]">Πηγή: {token.source}</span>
          {typeof token.delta === 'number' && Number.isFinite(token.delta) ? (
            <span
              className="mt-0.5 block font-mono"
              style={{ color: token.delta > 0 ? 'var(--success)' : token.delta < 0 ? 'var(--danger)' : 'var(--text-muted)' }}
            >
              {token.delta > 0 ? '+' : ''}
              {formatNumber(token.delta, 1)}% vs προηγούμενη εβδομάδα
            </span>
          ) : null}
          {navigate ? (
            <span className="mt-1 flex items-center gap-1 text-[var(--nts-accent-text)]">
              <ArrowUpRight size={11} aria-hidden /> Κλικ για άνοιγμα
            </span>
          ) : null}
        </span>,
        document.body
      )}
    </span>
  );
}
