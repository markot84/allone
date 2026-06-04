import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import {
  X,
  Send,
  BookOpen,
  ExternalLink,
  MessageCircle,
  Mic,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { searchArticles, getArticleById } from '../../data/knowledgeBase';
import { FormattedProse } from '../common';
import { shouldSearchWeb, searchWeb, formatSearchResultsForResponse } from '../../services/webSearch';
import {
  formatTenantPackForPrompt,
  formatKnowledgeExcerptsForPrompt,
  formatWebSnippetsForPrompt,
  fallbackKnowledgeAnswer,
  type AssistantTenantPack,
  type RevenueSeries,
} from '../../services/aiAssistantChat';
import {
  loadMarkSession,
  saveMarkSession,
  clearMarkSession,
  generateMarkReply,
  buildProactiveGreeting,
  toGeminiHistory,
  normalizeMarkTranscript,
  type MarkMessage,
} from '../../services/mark';
import { formatCommercialInfoForPrompt, structureCommercialInfo } from '../../services/commercialInfo';
import { formatBrandProfileForPrompt } from '../../services/brandProfile';
import { useCommercialInfo } from '../../hooks/useCommercialInfo';
import { useSpeechToText } from '../../hooks/useSpeechToText';
import { useBrand } from '../../hooks/useBrand';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useBusinessRevenueSummary } from '../../hooks/useBusinessRevenueSummary';
import { useSegments } from '../../hooks/useSegments';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useProductSource } from '../../hooks/useProductSource';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import { calculateCampaignMetrics } from '../../utils/roiUtils';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  relatedArticles?: string[];
  webSources?: Array<{ title: string; url: string; snippet: string }>;
  timestamp: Date;
  /** Proactive καλωσόρισμα — δεν στέλνεται ως context turn στο μοντέλο. */
  proactive?: boolean;
  savedInfoId?: string;
  /** Κείμενο που μπορεί να αποθηκευτεί ως εμπορική πληροφορία από CTA. */
  pendingInfoText?: string;
}

function toMark(m: Message): MarkMessage {
  return {
    id: m.id,
    role: m.type,
    content: m.content,
    ts: m.timestamp.getTime(),
    relatedArticles: m.relatedArticles,
    webSources: m.webSources,
    proactive: m.proactive,
    savedInfoId: m.savedInfoId,
    pendingInfoText: m.pendingInfoText,
  };
}

function fromMark(m: MarkMessage): Message {
  return {
    id: m.id,
    type: m.role,
    content: m.content,
    relatedArticles: m.relatedArticles,
    webSources: m.webSources,
    timestamp: new Date(m.ts || Date.now()),
    proactive: m.proactive,
    savedInfoId: m.savedInfoId,
    pendingInfoText: m.pendingInfoText,
  };
}

function shouldOfferCommercialInfoCta(userQuery: string, response: string): boolean {
  const asksToSave = /καταχωρ|αποθηκεύ|λαμβάνω υπόψη|μελλοντική αναφορά/i.test(response);
  if (!asksToSave) return false;
  return /ακρίβεια|αγορά|τάση|ανταγωνισ|προμηθευ|καλοκαίρ|χειμώνα|σεζόν|ζήτηση|κόστος|τιμ|γεγονός|event|trend/i.test(userQuery)
    || userQuery.trim().length > 80;
}

function buildMarkContextBullets(response: string): string[] {
  const cleaned = response
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .split('\n')
    .map((line) => line.replace(/^[-•\d.]+\s*/, '').trim())
    .filter((line) => line.length > 24 && !/^θέλεις να καταχωρήσω/i.test(line));
  const priority = cleaned.filter((line) =>
    /προτεραι|προτείν|ενέργεια|ρίσκο|καμπάνια|στόχευ|προσφορά|τζίρ|απόθεμα|segment|πελάτ/i.test(line)
  );
  return (priority.length ? priority : cleaned).slice(0, 5);
}

function buildInstantWelcome(brandName: string | null): Message {
  return {
    id: `mark-welcome-${Date.now()}`,
    type: 'assistant',
    content: brandName
      ? `Γεια σου, πώς μπορώ να βοηθήσω;\n\nΜπορείς να μου ζητήσεις εξήγηση για KPI, ανάλυση τζίρου/καμπανιών, ιδέες για Marketing Plan ή να μου δώσεις μια νέα εμπορική πληροφορία.`
      : 'Γεια σου, πώς μπορώ να βοηθήσω;\n\nΕπίλεξε brand για να σου απαντήσω με βάση τα σωστά δεδομένα.',
    timestamp: new Date(),
    proactive: true,
  };
}

/**
 * Memoized bubble — ΚΡΙΣΙΜΟ για performance: χωρίς αυτό, κάθε πάτημα πλήκτρου στο input
 * ξανα-render-άρει ΟΛΑ τα μηνύματα (markdown + DOMPurify parsing), παγώνοντας το tab σε μεγάλες
 * απαντήσεις. Με `memo`, τα bubbles ξανα-render-άρουν μόνο όταν αλλάξει το ίδιο το μήνυμα.
 */
const MarkMessageItem = memo(function MarkMessageItem({
  message,
  onClose,
  onSaveInfo,
  savingInfo,
}: {
  message: Message;
  onClose: () => void;
  onSaveInfo: (text: string, options?: {
    appendUserMessage?: boolean;
    openMarketingPlan?: boolean;
    markResponse?: string;
    markMessageId?: string;
  }) => void;
  savingInfo: boolean;
}) {
  return (
    <div className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
      {message.type === 'assistant' && (
        <div className="mark-avatar-orb w-8 h-8 rounded-lg bg-white border border-[var(--nts-accent)]/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img
            src="/mark-orb.png"
            alt="Mark"
            className="mark-orb-img w-full h-full object-cover scale-110"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              target.parentElement!.innerHTML =
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg>';
            }}
          />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          message.type === 'user'
            ? 'bg-[var(--nts-accent)] text-white'
            : 'bg-[var(--nts-light-gray)] text-[var(--nts-charcoal)]'
        }`}
      >
        {message.type === 'assistant' ? (
          <div className="text-sm [&_p]:text-sm [&_li]:text-sm">
            <FormattedProse content={message.content} variant="compact" />
          </div>
        ) : (
          <p className="text-sm whitespace-pre-line">{message.content}</p>
        )}

        {message.webSources && message.webSources.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--nts-border-gray)]/20">
            <p className="text-xs font-medium mb-2 flex items-center gap-1">
              <ExternalLink size={12} />
              Πηγές από το διαδίκτυο:
            </p>
            <div className="space-y-2">
              {message.webSources.map((source, idx) => (
                <a
                  key={idx}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs p-2 bg-white/80 hover:bg-white rounded border border-[var(--nts-border-gray)]/30 text-[var(--nts-charcoal)] hover:text-[var(--nts-accent)] transition-colors"
                >
                  <div className="font-medium mb-1 flex items-center gap-1">
                    {source.title}
                    <ExternalLink size={10} />
                  </div>
                  <div className="text-[11px] text-[var(--nts-medium-gray)] line-clamp-2">{source.snippet}</div>
                </a>
              ))}
            </div>
          </div>
        )}

        {message.relatedArticles && message.relatedArticles.length > 0 && (
          <div className={`mt-3 pt-3 border-t border-[var(--nts-border-gray)]/20 ${message.webSources ? '' : 'mt-3'}`}>
            <p className="text-xs font-medium mb-2 flex items-center gap-1">
              <BookOpen size={12} />
              Σχετικά άρθρα από το Knowledge Library:
            </p>
            <div className="flex flex-wrap gap-2">
              {message.relatedArticles.map((articleId) => {
                const article = getArticleById(articleId);
                if (!article) return null;
                return (
                  <a
                    key={articleId}
                    href={`#help?article=${articleId}`}
                    onClick={(e) => {
                      e.preventDefault();
                      window.location.hash = `help?article=${articleId}`;
                      window.dispatchEvent(new HashChangeEvent('hashchange'));
                      window.dispatchEvent(new CustomEvent('navigate-to-help'));
                      onClose();
                    }}
                    className="text-xs px-2 py-1 bg-white/80 hover:bg-white rounded border border-[var(--nts-border-gray)]/30 text-[var(--nts-charcoal)] hover:text-[var(--nts-accent)] transition-colors flex items-center gap-1"
                  >
                    {article.title}
                    <ExternalLink size={10} />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {message.type === 'assistant' && message.pendingInfoText && !message.savedInfoId && (
          <div className="mt-3 pt-3 border-t border-[var(--nts-border-gray)]/20">
            <button
              type="button"
              onClick={() => onSaveInfo(message.pendingInfoText!, {
                appendUserMessage: false,
                openMarketingPlan: true,
                markResponse: message.content,
                markMessageId: message.id,
              })}
              disabled={savingInfo}
              className="w-full rounded-lg bg-[var(--nts-accent)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--nts-accent)]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingInfo ? 'Καταχώριση…' : 'Καταχώριση & άνοιγμα Marketing Plan'}
            </button>
            <p className="mt-1.5 text-[11px] text-[var(--nts-medium-gray)]">
              Θα αποθηκευτεί ως ενεργή εμπορική πληροφορία και θα επηρεάσει το νέο Marketing Plan.
            </p>
          </div>
        )}
      </div>
      {message.type === 'user' && (
        <div className="w-8 h-8 rounded-full bg-[var(--nts-accent)] flex items-center justify-center flex-shrink-0">
          <MessageCircle size={16} className="text-white" />
        </div>
      )}
    </div>
  );
});

interface AIAssistantProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MarkAgent({ isOpen, onClose }: AIAssistantProps) {
  const { currentBrand } = useBrand();
  const commercialInfo = useCommercialInfo();
  // Light path: ο Mark χρειάζεται ΜΟΝΟ revenue/orders/platforms — όχι SKU stats / stock movement
  // chunks (βαρύ multi-doc fetch). Αποφεύγει αργή/αποτυχημένη φόρτωση που εμφάνιζε το e-shop ως κενό.
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const businessRev = useBusinessRevenueSummary();
  const {
    segments: rfmSegments,
    totalCustomers,
    dataSource: segmentsDataSource,
    orderRfmMeta,
  } = useSegments();
  const campaignsHook = useCampaigns();
  const ga4 = useGA4Data();
  const productSrc = useProductSource();
  const productIntelligence = useProductIntelligenceAggregate('all', 1, { pageSize: 150 });
  const campaignMetrics = useMemo(
    () => calculateCampaignMetrics(campaignsHook.campaigns),
    [campaignsHook.campaigns]
  );
  const campaignSignals = useMemo(() => {
    const active = campaignsHook.campaigns.filter((c) => (c.amount_spent || 0) > 0);
    if (active.length === 0) return { topCampaign: null, weakCampaign: null };
    const ranked = [...active].sort((a, b) => (b.roas || 0) - (a.roas || 0));
    const top = ranked[0];
    const weak = ranked.length > 1 ? ranked[ranked.length - 1] : null;
    return {
      topCampaign: top
        ? { name: top.name, roas: top.roas || 0 }
        : null,
      weakCampaign: weak
        ? { name: weak.name, roas: weak.roas || 0, spend: weak.amount_spent || 0 }
        : null,
    };
  }, [campaignsHook.campaigns]);

  // Χρονοσειρές τζίρου (ERP + e-shop) ώστε ο Mark να απαντά για ΟΠΟΙΑΔΗΠΟΤΕ περίοδο με δεδομένα.
  // Κρατάμε πλήρη ημερήσια σειρά όπου υπάρχει, γιατί ερωτήσεις τύπου «πέρυσι την ίδια ημέρα»
  // χρειάζονται ακριβή daily lookup και όχι μόνο τα τελευταία 90 ημερήσια σημεία.
  const revenueSeries = useMemo((): AssistantTenantPack['revenue'] => {
    const buildYoyDailyPairs = (daily: Array<{ date: string; revenue: number }>) => {
      const byDate = new Map(daily.map((d) => [d.date, d.revenue]));
      return daily
        .slice(-21)
        .map((d) => {
          const previousYearDate = `${String(Number(d.date.slice(0, 4)) - 1)}${d.date.slice(4)}`;
          const previousYearRevenue = byDate.get(previousYearDate);
          return previousYearRevenue == null
            ? null
            : {
                date: d.date,
                revenue: d.revenue,
                previousYearDate,
                previousYearRevenue,
              };
        })
        .filter((d): d is { date: string; revenue: number; previousYearDate: string; previousYearRevenue: number } => d != null);
    };

    const businessDaily = Object.entries(businessRev.revenueByDayRecord)
      .map(([date, revenue]) => ({ date, revenue: Number(revenue) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const business: RevenueSeries | undefined = businessRev.hasErpRevenueData
      ? {
          label: `ERP (${businessRev.source})`,
          totalRevenue: businessRev.totalRevenue,
          orderCount: businessRev.orderCount,
          monthly: businessRev.monthlyRevenue,
          recentDaily: businessDaily,
          yoyDaily: buildYoyDailyPairs(businessDaily),
        }
      : undefined;

    const eshopDaily = ecomm.dailyRevenue.map((d) => ({ date: d.date, revenue: Number(d.revenue) || 0 }));
    const ecommerce: RevenueSeries | undefined =
      ecomm.dailyRevenue.length > 0 || ecomm.monthlyRevenue.length > 0
        ? {
            label: 'E-shop',
            totalRevenue: ecomm.totalRevenue,
            orderCount: ecomm.orderCount,
            monthly: ecomm.monthlyRevenue,
            recentDaily: eshopDaily,
            yoyDaily: buildYoyDailyPairs(eshopDaily),
          }
        : undefined;

    if (!business && !ecommerce) return undefined;
    return { business, ecommerce };
  }, [
    businessRev.hasErpRevenueData,
    businessRev.source,
    businessRev.totalRevenue,
    businessRev.orderCount,
    businessRev.monthlyRevenue,
    businessRev.revenueByDayRecord,
    ecomm.dailyRevenue,
    ecomm.monthlyRevenue,
    ecomm.totalRevenue,
    ecomm.orderCount,
  ]);

  const tenantPack = useMemo((): AssistantTenantPack => {
    const rows = [...rfmSegments]
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 12)
      .map((s) => ({
        name: s.name,
        count: s.count,
        percentage: s.percentage,
        revenue_share: s.revenue_share,
      }));

    return {
      brandName: currentBrand?.name ?? null,
      brandId: currentBrand?.id ?? null,
      brandProfileContext: formatBrandProfileForPrompt(currentBrand?.brandProfile),
      ecommerce: {
        hasData: ecomm.hasData,
        totalRevenue: ecomm.totalRevenue,
        orderCount: ecomm.orderCount,
        aov: ecomm.aov,
        connectedPlatforms: ecomm.connectedPlatforms,
      },
      revenue: revenueSeries,
      revenueLoading: { ecommerce: ecomm.isLoading, business: businessRev.isLoading },
      commercial: {
        adSpend: campaignMetrics.totalSpend,
        attributedRevenue: campaignMetrics.totalRevenue,
        platformRoas: campaignMetrics.roas,
        trueRoas: campaignMetrics.totalSpend > 0 && ecomm.hasData
          ? ecomm.totalRevenue / campaignMetrics.totalSpend
          : undefined,
        revenueGap: ecomm.hasData
          ? ecomm.totalRevenue - campaignMetrics.totalRevenue
          : undefined,
        topCampaign: campaignSignals.topCampaign,
        weakCampaign: campaignSignals.weakCampaign,
      },
      inventory: productIntelligence.aggregate?.summary
        ? {
            sourceLabel: productIntelligence.aggregate.sourceLabel,
            totalProducts: productIntelligence.aggregate.summary.total_skus,
            totalValue: productIntelligence.aggregate.summary.total_value,
            healthyStock: productIntelligence.aggregate.summary.healthy_stock.count,
            deadStock: productIntelligence.aggregate.summary.dead_stock.count,
            deadStockValue: productIntelligence.aggregate.summary.dead_stock.value,
            lowStock: productIntelligence.aggregate.summary.low_stock.count,
            excessStock: productIntelligence.aggregate.summary.excess_stock.count,
            excessStockValue: productIntelligence.aggregate.summary.excess_stock.value,
          }
        : undefined,
      segments: {
        dataSource: segmentsDataSource,
        totalCustomers,
        guestOrdersSkipped: orderRfmMeta?.guestOrdersSkipped,
        ordersAttributed: orderRfmMeta?.ordersAttributed,
        rows,
      },
      campaigns: {
        count: campaignsHook.count,
        hasImported: campaignsHook.hasImported,
      },
      products: {
        count: productSrc.count,
        hasImported: productSrc.hasImported,
      },
      ga4: {
        hasData: ga4.hasData,
        propertyName: ga4.propertyName,
        sessions: ga4.totals.sessions,
        users: ga4.totals.users,
        conversions: ga4.totals.conversions,
      },
    };
  }, [
    currentBrand?.id,
    currentBrand?.name,
    currentBrand?.brandProfile,
    ecomm.hasData,
    ecomm.totalRevenue,
    ecomm.orderCount,
    ecomm.aov,
    ecomm.connectedPlatforms,
    ecomm.isLoading,
    businessRev.isLoading,
    revenueSeries,
    campaignMetrics.totalSpend,
    campaignMetrics.totalRevenue,
    campaignMetrics.roas,
    campaignSignals.topCampaign,
    campaignSignals.weakCampaign,
    productIntelligence.aggregate,
    segmentsDataSource,
    totalCustomers,
    orderRfmMeta?.guestOrdersSkipped,
    orderRfmMeta?.ordersAttributed,
    rfmSegments,
    campaignsHook.count,
    campaignsHook.hasImported,
    productSrc.count,
    productSrc.hasImported,
    ga4.hasData,
    ga4.propertyName,
    ga4.totals.sessions,
    ga4.totals.users,
    ga4.totals.conversions,
  ]);

  const tenantSnapshotText = useMemo(() => formatTenantPackForPrompt(tenantPack), [tenantPack]);

  const brandId = currentBrand?.id ?? null;
  const brandName = currentBrand?.name ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldAutoScrollRef = useRef(true);
  /** Το brandId του οποίου το session είναι φορτωμένο — guard κατά mismatch. */
  const loadedBrandRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  const activeInfoText = useMemo(
    () => formatCommercialInfoForPrompt(commercialInfo.items.filter((i) => i.status === 'active')),
    [commercialInfo.items]
  );
  const openInfoCount = useMemo(
    () => commercialInfo.items.filter((i) => i.status === 'active').length,
    [commercialInfo.items]
  );

  // ── BRAND ISOLATION: φόρτωση session του ΕΝΕΡΓΟΥ brand.
  // Σημαντικό: σε auth/data refresh το currentBrand μπορεί να γίνει προσωρινά null.
  // Δεν καθαρίζουμε τα messages σε τέτοιο transient state, γιατί ο χρήστης βλέπει το chat να "χάνεται".
  // Reset κάνουμε μόνο σε πραγματική αλλαγή από ένα non-null brand σε άλλο non-null brand.
  useEffect(() => {
    let cancelled = false;
    const previousLoadedBrand = loadedBrandRef.current;

    if (!brandId) {
      setIsTyping(false);
      return () => {
        cancelled = true;
      };
    }

    if (previousLoadedBrand === brandId && hydratedRef.current) {
      return () => {
        cancelled = true;
      };
    }

    hydratedRef.current = false;
    loadedBrandRef.current = brandId;
    if (previousLoadedBrand && previousLoadedBrand !== brandId) {
      setMessages([]);
      setInput('');
    }
    setIsTyping(false);

    (async () => {
      if (!previousLoadedBrand || previousLoadedBrand !== brandId) {
        setMessages([buildInstantWelcome(brandName)]);
      }
      const stored = await loadMarkSession(brandId);
      if (cancelled || loadedBrandRef.current !== brandId) return;

      if (stored.length > 0) {
        setMessages(stored.map(fromMark));
        hydratedRef.current = true;
        return;
      }

      if (previousLoadedBrand === brandId) {
        // Αν το Firestore read γυρίσει προσωρινά άδειο/αποτύχει, μη σβήσεις το υπάρχον in-memory chat.
        hydratedRef.current = true;
        return;
      }

      // Νέα συνομιλία: proactive καλωσόρισμα + brief.
      const greeting = await buildProactiveGreeting({ brandId, brandName, openInfoCount });
      if (cancelled || loadedBrandRef.current !== brandId) return;
      setMessages([
        { ...buildInstantWelcome(brandName), content: greeting },
      ]);
      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
    // openInfoCount/brandName σκόπιμα εκτός deps: το greeting χτίζεται μία φορά ανά brand load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  // Persist συνομιλίας (μόνο μετά το hydrate, μόνο για το φορτωμένο brand).
  useEffect(() => {
    if (!brandId || !hydratedRef.current || loadedBrandRef.current !== brandId) return;
    if (messages.length === 0) return;
    void saveMarkSession(brandId, messages.map(toMark));
  }, [messages, brandId]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 96;
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping]);

  const handleSend = async (overrideText?: string) => {
    const userQuery = (overrideText ?? input).trim();
    if (!userQuery || isTyping) return;

    // BRAND GUARD: «κλειδώνουμε» το brand στην έναρξη του αιτήματος.
    const requestBrandId = brandId;
    const requestBrandName = brandName;
    if (!requestBrandId) return;

    const historyTurns = toGeminiHistory(messages.map(toMark));
    shouldAutoScrollRef.current = true;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userQuery,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const articleCandidates = searchArticles(userQuery).slice(0, 5);
      const articleRefs = articleCandidates.map((a) => a.id);
      let webSources: Array<{ title: string; url: string; snippet: string }> = [];
      const needsWebSearch = shouldSearchWeb(userQuery);

      if (needsWebSearch) {
        try {
          const webResults = await searchWeb(userQuery);
          if (webResults.results.length > 0) {
            webSources = webResults.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }));
          }
        } catch (webError) {
          console.error('Web search error:', webError);
        }
      }

      let response = '';
      const firebaseUser = getAuth().currentUser;

      if (firebaseUser) {
        try {
          const kbExcerpts = formatKnowledgeExcerptsForPrompt(userQuery);
          const webBlock = webSources.length > 0 ? formatWebSnippetsForPrompt(webSources) : undefined;
          response = await generateMarkReply({
            brandId: requestBrandId,
            brandName: requestBrandName,
            userQuery,
            tenantSnapshotText,
            commercialInfoText: activeInfoText,
            history: historyTurns,
            knowledgeExcerpts: kbExcerpts,
            webContext: webBlock,
          });
        } catch (geminiErr) {
          console.error('[Mark] Gemini:', geminiErr);
          response = fallbackKnowledgeAnswer(userQuery, articleCandidates);
          const errMsg = geminiErr instanceof Error ? geminiErr.message : '';
          if (errMsg.includes('Rate limit') || errMsg.includes('429')) {
            response += '\n\n_Προσωρινό όριο αιτημάτων AI — δοκίμασε ξανά αργότερα._';
          }
          if (needsWebSearch && webSources.length > 0) {
            response +=
              '\n\n---\n\n' +
              formatSearchResultsForResponse({ query: userQuery, results: webSources, totalResults: webSources.length });
          }
        }
      } else {
        response = fallbackKnowledgeAnswer(userQuery, articleCandidates);
        response += '\n\n_Συνδέσου στο Performance+ για απαντήσεις με βάση τα πραγματικά δεδομένα του brand._';
      }

      // BRAND GUARD: αν άλλαξε brand όσο τρέχαμε, απόρριψη απάντησης (όχι cross-brand mix).
      if (loadedBrandRef.current !== requestBrandId) {
        setIsTyping(false);
        return;
      }

      const assistantMessage: Message = {
        id: `mark-${Date.now()}`,
        type: 'assistant',
        content: response,
        relatedArticles: articleRefs.length > 0 ? articleRefs : undefined,
        webSources: webSources.length > 0 ? webSources : undefined,
        pendingInfoText: shouldOfferCommercialInfoCta(userQuery, response) ? userQuery : undefined,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    } catch (error) {
      console.error('Error generating response:', error);
      if (loadedBrandRef.current !== requestBrandId) {
        setIsTyping(false);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: `mark-error-${Date.now()}`, type: 'assistant', content: 'Συγγνώμη, προέκυψε σφάλμα. Δοκίμασε ξανά.', timestamp: new Date() },
      ]);
      setIsTyping(false);
    }
  };

  /** Καταχώριση εμπορικής πληροφορίας: δομεί το κείμενο και το αποθηκεύει (brand-scoped). */
  const handleSaveInfo = useCallback(
    async (text: string, options: {
      appendUserMessage?: boolean;
      openMarketingPlan?: boolean;
      markResponse?: string;
      markMessageId?: string;
    } = {}) => {
      const raw = text.trim();
      const requestBrandId = brandId;
      if (!raw || savingInfo || !requestBrandId) return;
      setSavingInfo(true);
      setInput('');
      if (options.appendUserMessage !== false) {
        setMessages((prev) => [...prev, { id: `user-info-${Date.now()}`, type: 'user', content: raw, timestamp: new Date() }]);
      }
      try {
        const structured = await structureCommercialInfo(raw, { brandName });
        if (loadedBrandRef.current !== requestBrandId) {
          setSavingInfo(false);
          return;
        }
        const id = await commercialInfo.addInfo.mutateAsync({
          rawText: raw,
          structured,
          source: 'mark',
          markContext: options.markResponse
            ? {
                summaryBullets: buildMarkContextBullets(options.markResponse),
                assistantResponse: options.markResponse,
                sourceMessageId: options.markMessageId,
              }
            : undefined,
        });
        const scope = [
          structured.brands.length ? `επωνυμίες: ${structured.brands.join(', ')}` : '',
          structured.categories.length ? `κατηγορίες: ${structured.categories.join(', ')}` : '',
          structured.parentSkus.length ? `parent SKU: ${structured.parentSkus.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const confirm = `Καταχώρισα την εμπορική πληροφορία ✓\n\n**${structured.summary}**\n${scope ? `\n${scope}` : ''}\n\nΘα τη λαμβάνω υπόψη στο Marketing Plan και στις προτάσεις. Θες να φτιάξουμε ένα πλάνο ενεργειών γύρω από αυτό;`;
        setMessages((prev) => [
          ...prev.map((m) =>
            m.pendingInfoText === raw ? { ...m, pendingInfoText: undefined, savedInfoId: id } : m
          ),
          { id: `mark-info-${Date.now()}`, type: 'assistant', content: confirm, timestamp: new Date(), savedInfoId: id },
        ]);
        if (options.openMarketingPlan) {
          window.location.hash = 'marketing-plan';
          window.dispatchEvent(new HashChangeEvent('hashchange'));
          onClose();
        }
      } catch (e) {
        console.error('[Mark] save info:', e);
        setMessages((prev) => [
          ...prev,
          { id: `mark-info-err-${Date.now()}`, type: 'assistant', content: 'Δεν κατάφερα να καταχωρήσω την πληροφορία. Δοκίμασε ξανά.', timestamp: new Date() },
        ]);
      } finally {
        setSavingInfo(false);
      }
    },
    [brandId, brandName, savingInfo, commercialInfo.addInfo, onClose]
  );

  const handleResetSession = useCallback(async () => {
    if (!brandId) return;
    await clearMarkSession(brandId);
    const greeting = await buildProactiveGreeting({ brandId, brandName, openInfoCount });
    setMessages([{ ...buildInstantWelcome(brandName), content: greeting }]);
  }, [brandId, brandName, openInfoCount]);

  const stt = useSpeechToText({
    onResult: (text) => {
      const normalized = normalizeMarkTranscript(text);
      setInput((prev) => (prev ? `${prev} ${normalized}` : normalized));
    },
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-screen w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="p-5 border-b border-[var(--nts-border-gray)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="mark-avatar-orb w-10 h-10 rounded-lg bg-white border border-[var(--nts-accent)]/20 flex items-center justify-center overflow-hidden">
                    <img
                      src="/mark-orb.png"
                      alt="Mark"
                      className="mark-orb-img w-full h-full object-cover scale-110"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.parentElement!.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg>';
                      }}
                    />
                  </div>
                  <div>
                    <h2 className="font-bold text-[var(--nts-charcoal)] text-[15px]">Mark</h2>
                    <p className="text-[12px] text-[var(--nts-medium-gray)]">
                      {brandName ? (
                        <>Brand: <span className="font-semibold text-[var(--nts-charcoal)]">{brandName}</span></>
                      ) : (
                        'Επίλεξε brand για προτάσεις'
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleResetSession}
                    title="Νέα συνομιλία"
                    className="p-2 rounded-md hover:bg-[var(--nts-light-gray)] transition-colors"
                  >
                    <RotateCcw size={16} className="text-[var(--nts-medium-gray)]" />
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-md hover:bg-[var(--nts-light-gray)] transition-colors"
                  >
                    <X size={18} className="text-[var(--nts-medium-gray)]" />
                  </button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={messagesScrollRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {messages.map((message) => (
                <MarkMessageItem
                  key={message.id}
                  message={message}
                  onClose={onClose}
                  onSaveInfo={handleSaveInfo}
                  savingInfo={savingInfo}
                />
              ))}

              {isTyping && (
                <div className="flex gap-3 justify-start">
                  <div className="mark-avatar-orb mark-avatar-orb-thinking w-8 h-8 rounded-lg bg-white border border-[var(--nts-accent)]/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img src="/mark-orb.png" alt="" className="mark-orb-img w-full h-full object-cover scale-110" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                  <div className="bg-[var(--nts-light-gray)] rounded-lg p-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-[var(--nts-medium-gray)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-[var(--nts-medium-gray)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-[var(--nts-medium-gray)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-[var(--nts-border-gray)]">
              {/* Quick actions */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                  onClick={() => handleSend('Διάβασέ μου το brief της ημέρας και πες μου τι αξίζει να προσέξω.')}
                  disabled={isTyping || !brandId}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--nts-light-gray)] text-[var(--nts-charcoal)] hover:bg-[var(--nts-border-gray)] transition-colors disabled:opacity-50"
                >
                  Διάβασέ μου το brief
                </button>
                <button
                  onClick={() => { if (input.trim()) { handleSaveInfo(input); } else { inputRef.current?.focus(); } }}
                  disabled={savingInfo || !brandId}
                  title="Καταχώριση εμπορικής πληροφορίας (γράψε στο πεδίο και πάτησε εδώ)"
                  className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] hover:bg-[var(--nts-accent)]/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <Plus size={12} /> Νέα εμπορική πληροφορία
                </button>
                <button
                  onClick={() => handleSend('Εξήγησέ μου ένα σημαντικό KPI του brand και τι σημαίνει εμπορικά.')}
                  disabled={isTyping || !brandId}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--nts-light-gray)] text-[var(--nts-charcoal)] hover:bg-[var(--nts-border-gray)] transition-colors disabled:opacity-50"
                >
                  Εξήγησε ένα KPI
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  id="mark-input"
                  name="mark-input"
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={savingInfo ? 'Καταχώριση πληροφορίας…' : 'Γράψε στον Mark ή πάτησε το μικρόφωνο…'}
                  className="flex-1 px-4 py-2 border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
                  disabled={isTyping || savingInfo}
                />
                <button
                  onClick={stt.supported ? stt.toggle : undefined}
                  disabled={!stt.supported}
                  title={
                    !stt.supported
                      ? 'Ο browser δεν υποστηρίζει φωνητική είσοδο (δοκίμασε Chrome/Edge)'
                      : stt.listening
                        ? 'Διακοπή'
                        : 'Ομιλία (μικρόφωνο)'
                  }
                  className={`p-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    stt.listening
                      ? 'bg-red-500 text-white border-red-500 animate-pulse'
                      : 'bg-white text-[var(--nts-medium-gray)] border-[var(--nts-border-gray)] hover:text-[var(--nts-accent)]'
                  }`}
                >
                  <Mic size={18} />
                </button>
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isTyping || savingInfo}
                  className="p-2 bg-[var(--nts-accent)] text-white rounded-lg hover:bg-[var(--nts-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={18} />
                </button>
              </div>
              {stt.listening && (
                <p className="mt-2 text-center text-xs font-medium text-red-500">Μίλα τώρα…</p>
              )}
              {stt.error && (
                <p className="mt-2 text-center text-xs text-red-500">{stt.error}</p>
              )}
              <p className="text-xs text-[var(--nts-medium-gray)] mt-2 text-center leading-snug">
                Απαντά με βάση τα τρέχοντα δεδομένα του brand, το Help και (όταν χρειάζεται) το διαδίκτυο. Υπάρχουν όρια χρήσης.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Backward-compatible alias — ο Mark είναι η εξέλιξη του παλιού AI Assistant. */
export const AIAssistant = MarkAgent;
