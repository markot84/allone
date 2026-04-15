import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'assistant',
      content: 'Γεια σας! Είμαι ο AI Assistant του Performance+. Μπορώ να σας βοηθήσω με ερωτήσεις σχετικά με τη χρήση της πλατφόρμας, τα features, και τη στρατηγική σας. Τι θα θέλατε να μάθετε;',
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
      const query = userQuery.toLowerCase();
      const relatedArticles = searchArticles(query).slice(0, 3);
      
      let response = '';
      let articleRefs: string[] = [];
      let webSources: Array<{ title: string; url: string; snippet: string }> = [];

      // Check if we should search the web
      const needsWebSearch = shouldSearchWeb(userQuery);
      
      if (needsWebSearch) {
        // Perform web search for marketing-related topics
        try {
          const webResults = await searchWeb(userQuery);
          if (webResults.results.length > 0) {
            response = formatSearchResultsForResponse(webResults);
            webSources = webResults.results.map(r => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet
            }));
            
            // Also check knowledge base for Performance+ specific info
            if (relatedArticles.length > 0) {
              response += '\n\n—\n\nΣχετικά με το Performance+:\n';
              relatedArticles.forEach(article => {
                response += `• ${article.title}\n`;
                articleRefs.push(article.id);
              });
            }
          }
        } catch (webError) {
          console.error('Web search error:', webError);
          // Fallback to knowledge base
        }
      }

      // If no web search or web search failed, use knowledge base
      if (!response || !needsWebSearch) {
        // Generate response based on query and knowledge base
        if (query.includes('import') || query.includes('εισαγωγή') || query.includes('δεδομένα')) {
          response = 'Για την εισαγωγή δεδομένων, μπορείτε να χρησιμοποιήσετε CSV ή XLSX αρχεία. Υπάρχουν templates για κάθε τύπο δεδομένων (Products, Segments, Analytics, Campaigns).';
          articleRefs = ['data-import-basics', 'products-import', 'segments-import'];
        } else if (query.includes('rfm') || query.includes('segment') || query.includes('data analysis')) {
          response = 'Το Data Analysis σας βοηθά να κατανοήσετε τους πελάτες σας μέσω RFM, behavioral και firmographic ανάλυσης, ώστε κάθε segment να αποκτά σαφέστερη εμπορική ερμηνεία.';
          articleRefs = ['rfm-analysis', 'understanding-segments'];
        } else if (query.includes('strategy') || query.includes('στρατηγική') || query.includes('weights')) {
          response = 'Το Commercial Strategy σας επιτρέπει να προσαρμόσετε πώς προτεραιοποιούνται τα προϊόντα. Μπορείτε να χρησιμοποιήσετε preset scenarios ή να δημιουργήσετε custom.';
          articleRefs = ['strategy-weights', 'scenarios'];
        } else if (query.includes('roi') || query.includes('attribution') || query.includes('απόδοση')) {
          response = 'Το ROI & Απόδοση συγκρίνει τζίρο e-shop, έσοδα που αναφέρουν οι πλατφόρμες διαφημίσεων και δαπάνη, για True ROAS και Revenue Gap.';
          articleRefs = ['roi-attribution-basics'];
        } else if (query.includes('dashboard') || query.includes('kpi')) {
          response = 'Το Dashboard σας δίνει μια ολοκληρωμένη εικόνα της απόδοσης. Βλέπετε KPIs όπως Total Revenue, Products, Segments, και Campaigns. Κάθε KPI είναι clickable για λεπτομερή ανάλυση.';
          articleRefs = ['dashboard-overview', 'understanding-kpis'];
        } else if (query.includes('product') || query.includes('inventory') || query.includes('stock')) {
          response = 'Το Product Intelligence σας βοηθά να διαχειριστείτε αποθέματα, να εντοπίσετε excess/dead stock, και να προτεραιοποιήσετε προϊόντα.';
          articleRefs = ['products-intelligence', 'stock-clearance'];
        } else if (query.includes('channel') || query.includes('campaign')) {
          response = 'Το Channel Activation σας δίνει AI-powered recommendations για budget allocation, channel mix optimization, και target segments.';
          articleRefs = ['channel-activation'];
        } else if (relatedArticles.length > 0) {
          const article = relatedArticles[0];
          response = `Βρήκα σχετικό άρθρο: "${article.title}". ${article.description}`;
          articleRefs = [article.id];
        } else {
          response = 'Μπορώ να σας βοηθήσω με ερωτήσεις σχετικά με:\n\n• Εισαγωγή δεδομένων\n• Data Analysis και Segments\n• Commercial Strategy\n• Product Intelligence\n• Channel Activation\n• ROI Attribution\n• Dashboard και KPIs\n• Marketing, Digital Marketing, Analytics, Content Marketing\n\nΤι θα θέλατε να μάθετε;';
        }
      }

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        type: 'assistant',
        content: response,
        relatedArticles: articleRefs.length > 0 ? articleRefs : undefined,
        webSources: webSources.length > 0 ? webSources : undefined,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
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
                      Ερώτησε με οτιδήποτε για το Performance+
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
              <p className="text-xs text-[var(--nts-medium-gray)] mt-2 text-center">
                Το AI Assistant έχει πρόσβαση στο Knowledge Library και στο διαδίκτυο
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
