import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import {
  X,
  Send,
  BookOpen,
  ExternalLink,
  MessageCircle
} from 'lucide-react';
import { searchArticles, getArticleById } from '../../data/knowledgeBase';
import { FormattedProse } from '../common';
import { shouldSearchWeb, searchWeb, formatSearchResultsForResponse } from '../../services/webSearch';
import {
  formatTenantPackForPrompt,
  formatKnowledgeExcerptsForPrompt,
  formatWebSnippetsForPrompt,
  generateAssistantReply,
  fallbackKnowledgeAnswer,
  type AssistantTenantPack,
} from '../../services/aiAssistantChat';
import { useBrand } from '../../hooks/useBrand';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useSegments } from '../../hooks/useSegments';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useProductSource } from '../../hooks/useProductSource';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  relatedArticles?: string[];
  webSources?: Array<{ title: string; url: string; snippet: string }>;
  timestamp: Date;
}

interface AIAssistantProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIAssistant({ isOpen, onClose }: AIAssistantProps) {
  const { currentBrand } = useBrand();
  const ecomm = useEcommerceSummary();
  const {
    segments: rfmSegments,
    totalCustomers,
    dataSource: segmentsDataSource,
    orderRfmMeta,
  } = useSegments();
  const campaignsHook = useCampaigns();
  const ga4 = useGA4Data();
  const productSrc = useProductSource();

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
      ecommerce: {
        hasData: ecomm.hasData,
        totalRevenue: ecomm.totalRevenue,
        orderCount: ecomm.orderCount,
        aov: ecomm.aov,
        connectedPlatforms: ecomm.connectedPlatforms,
      },
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
    ecomm.hasData,
    ecomm.totalRevenue,
    ecomm.orderCount,
    ecomm.aov,
    ecomm.connectedPlatforms,
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

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'assistant',
      content:
        'Γεια σας! Είμαι ο AI Assistant του Performance+. Με σύνδεση στο λογαριασμό σας χρησιμοποιώ και μια σύνοψη των τρεχόντων δεδομένων του brand (e-shop, segments, καμπάνιες κ.λπ.) μαζί με το Help και — όταν χρειάζεται — διαδικτυακές πηγές. Ρωτήστε με για τη χρήση της πλατφόρμας ή για ερμηνεία των δεδομένων σας.',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userQuery = input.trim();
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userQuery,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const articleCandidates = searchArticles(userQuery).slice(0, 5);
      let articleRefs = articleCandidates.map((a) => a.id);
      let webSources: Array<{ title: string; url: string; snippet: string }> = [];
      const needsWebSearch = shouldSearchWeb(userQuery);

      if (needsWebSearch) {
        try {
          const webResults = await searchWeb(userQuery);
          if (webResults.results.length > 0) {
            webSources = webResults.results.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
            }));
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
          const webBlock =
            webSources.length > 0 ? formatWebSnippetsForPrompt(webSources) : undefined;
          response = await generateAssistantReply({
            userQuery,
            tenantSnapshotText,
            knowledgeExcerpts: kbExcerpts,
            webContext: webBlock,
          });
        } catch (geminiErr) {
          console.error('[AIAssistant] Gemini:', geminiErr);
          response = fallbackKnowledgeAnswer(userQuery, articleCandidates);
          const errMsg = geminiErr instanceof Error ? geminiErr.message : '';
          if (errMsg.includes('Rate limit') || errMsg.includes('429')) {
            response +=
              '\n\n_Προσωρινό όριο αιτημάτων AI — δοκίμασε σε λίγα λεπτά._';
          }
          if (needsWebSearch && webSources.length > 0) {
            response +=
              '\n\n---\n\n' +
              formatSearchResultsForResponse({
                query: userQuery,
                results: webSources,
                totalResults: webSources.length,
              });
          }
        }
      } else {
        if (needsWebSearch && webSources.length > 0) {
          response = formatSearchResultsForResponse({
            query: userQuery,
            results: webSources,
            totalResults: webSources.length,
          });
          if (articleCandidates.length > 0) {
            response += '\n\n—\n\nΣχετικά με το Performance+:\n';
            articleCandidates.forEach((article) => {
              response += `• ${article.title}\n`;
            });
          }
        } else {
          response = fallbackKnowledgeAnswer(userQuery, articleCandidates);
          response +=
            '\n\n_Για απαντήσεις με βάση τα πραγματικά δεδομένα του brand σου (μέσω AI), συνδέσου στο λογαριασμό Performance+._';
        }
      }

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        type: 'assistant',
        content: response,
        relatedArticles: articleRefs.length > 0 ? articleRefs : undefined,
        webSources: webSources.length > 0 ? webSources : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    } catch (error) {
      console.error('Error generating response:', error);
      const errorMessage: Message = {
        id: `assistant-error-${Date.now()}`,
        type: 'assistant',
        content: 'Συγγνώμη, προέκυψε ένα σφάλμα. Παρακαλώ δοκιμάστε ξανά.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsTyping(false);
    }
  };

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
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--nts-accent)] to-[var(--nts-accent-hover)] flex items-center justify-center overflow-hidden">
                    <img
                      src="/mascot.png"
                      alt="AI Assistant"
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.parentElement!.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg>';
                      }}
                    />
                  </div>
                  <div>
                    <h2 className="font-bold text-[var(--nts-charcoal)] text-[15px]">AI Assistant</h2>
                    <p className="text-[13px] text-[var(--nts-medium-gray)]">
                      AI με σύνοψη λογαριασμού, Help και διαδίκτυο
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-md hover:bg-[var(--nts-light-gray)] transition-colors"
                >
                  <X size={18} className="text-[var(--nts-medium-gray)]" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.type === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--nts-accent)] to-[var(--nts-accent-hover)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <img
                        src="/mascot.png"
                        alt="AI Assistant"
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          target.parentElement!.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg>';
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
                    
                    {/* Web Sources */}
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
                              <div className="text-[11px] text-[var(--nts-medium-gray)] line-clamp-2">
                                {source.snippet}
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Related Articles */}
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
                  </div>
                  {message.type === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-[var(--nts-accent)] flex items-center justify-center flex-shrink-0">
                      <MessageCircle size={16} className="text-white" />
                    </div>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--nts-accent)] to-[var(--nts-accent-hover)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img src="/mascot.png" alt="" className="w-full h-full object-contain animate-pulse" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
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
              <div className="flex gap-2">
                <input
                  id="ai-assistant-input"
                  name="ai-assistant-input"
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ρωτήστε κάτι..."
                  className="flex-1 px-4 py-2 border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
                  disabled={isTyping}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="p-2 bg-[var(--nts-accent)] text-white rounded-lg hover:bg-[var(--nts-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={18} />
                </button>
              </div>
              <p className="text-xs text-[var(--nts-medium-gray)] mt-2 text-center leading-snug">
                Με σύνδεση: απαντήσεις μέσω cloud AI με βάση τα τρέχοντα KPIs του brand σας, αποσπάσματα Knowledge Library και (όταν χρειάζεται) διαδικτυακές πηγές. Όριο χρήσης για προστασία κόστους.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
