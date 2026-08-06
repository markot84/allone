import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Book,
  MessageCircle,
  Mail,
  ChevronRight,
  Search,
  ArrowLeft,
  CheckCircle2,
  Lightbulb,
  HelpCircle,
  X
} from 'lucide-react';
import { Card, CardHeader, Button, useToast, FormattedProse } from '../common';
import {
  knowledgeCategories,
  knowledgeArticles,
  getArticlesByCategory,
  searchArticles,
  getArticleById
} from '../../data/knowledgeBase';

const SUPPORT_MAIL = 'noreply@performanceplus.gr';

export function Help() {
  const toast = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Handle hash navigation: #help?article=… or #help?q=… (search from header)
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash.startsWith('help')) return;
      const queryPart = hash.includes('?') ? hash.split('?').slice(1).join('?') : '';
      const params = new URLSearchParams(queryPart);
      const articleId = params.get('article');
      const qRaw = params.get('q');
      if (articleId) {
        const article = getArticleById(articleId);
        if (article) {
          setSelectedCategory(article.category);
          setSelectedArticle(articleId);
          setSearchQuery('');
        }
        return;
      }
      if (qRaw != null && qRaw !== '') {
        setSearchQuery(qRaw);
        setSelectedCategory(null);
        setSelectedArticle(null);
      }
    };

    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  const filteredArticles = useMemo(() => {
    if (searchQuery.trim()) {
      return searchArticles(searchQuery);
    }
    if (selectedCategory) {
      return getArticlesByCategory(selectedCategory);
    }
    return [];
  }, [selectedCategory, searchQuery]);

  const currentArticle = selectedArticle ? getArticleById(selectedArticle) : null;

  const handleCategoryClick = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setSelectedArticle(null);
    setSearchQuery('');
  };

  const handleArticleClick = (articleId: string) => {
    setSelectedArticle(articleId);
  };

  const handleBack = () => {
    if (selectedArticle) {
      setSelectedArticle(null);
    } else if (selectedCategory) {
      setSelectedCategory(null);
    }
    setSearchQuery('');
  };

  // Article View
  if (currentArticle) {
    const category = knowledgeCategories.find(c => c.id === currentArticle.category);
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <button
            onClick={handleBack}
            className="shrink-0 self-start rounded-lg p-2 transition-colors hover:bg-[var(--surface-2)]"
          >
            <ArrowLeft size={20} className="text-[var(--text-secondary)]" />
          </button>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
              <span>{category?.icon}</span>
              <span>{category?.title}</span>
            </div>
            <h1 className="break-words text-xl font-bold text-[var(--text-primary)] sm:text-2xl">{currentArticle.title}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{currentArticle.description}</p>
          </div>
        </div>

        {/* Article Content */}
        <Card padding="lg">
          <div className="max-w-none">
            <FormattedProse content={currentArticle.content} variant="article" />

            {/* Steps */}
            {currentArticle.steps && currentArticle.steps.length > 0 && (
              <div className="mt-6 p-4 bg-[var(--surface-2)] rounded-xl">
                <h4 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-[#22C55E]" />
                  Βήματα:
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-[var(--text-secondary)]">
                  {currentArticle.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Tips */}
            {currentArticle.tips && currentArticle.tips.length > 0 && (
              <div className="mt-6 p-4 bg-[var(--nts-light-gray)] rounded-xl border border-[var(--nts-accent)]/20">
                <h4 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <Lightbulb size={18} className="text-[var(--nts-accent-text)]" />
                  Συμβουλές:
                </h4>
                <ul className="list-disc list-inside space-y-2 text-[var(--text-secondary)]">
                  {currentArticle.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* FAQ */}
            {currentArticle.faq && currentArticle.faq.length > 0 && (
              <div className="mt-6">
                <h4 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <HelpCircle size={18} className="text-[var(--text-secondary)]" />
                  Συχνές Ερωτήσεις:
                </h4>
                <div className="space-y-3">
                  {currentArticle.faq.map((item, i) => (
                    <div key={i} className="p-3 bg-white border border-[var(--border)] rounded-lg">
                      <p className="font-medium text-[var(--text-primary)] mb-1">{item.question}</p>
                      <p className="text-sm text-[var(--text-secondary)]">{item.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Articles */}
            {currentArticle.related && currentArticle.related.length > 0 && (
              <div className="mt-6 pt-6 border-t border-[var(--border)]">
                <h4 className="font-semibold text-[var(--text-primary)] mb-3">Σχετικά Άρθρα:</h4>
                <div className="flex flex-wrap gap-2">
                  {currentArticle.related.map((relatedId) => {
                    const related = getArticleById(relatedId);
                    if (!related) return null;
                    return (
                      <button
                        key={relatedId}
                        onClick={() => handleArticleClick(relatedId)}
                        className="px-3 py-1.5 bg-[var(--surface-2)] hover:bg-[var(--nts-light-gray)] rounded-lg text-sm text-[var(--text-primary)] transition-colors"
                      >
                        {related.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // Category Articles List
  if (selectedCategory) {
    const category = knowledgeCategories.find(c => c.id === selectedCategory);
    const articles = getArticlesByCategory(selectedCategory);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <button
            onClick={handleBack}
            className="shrink-0 self-start rounded-lg p-2 transition-colors hover:bg-[var(--surface-2)]"
          >
            <ArrowLeft size={20} className="text-[var(--text-secondary)]" />
          </button>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
              <span>{category?.icon}</span>
              {category?.title}
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{category?.description}</p>
          </div>
        </div>

        {/* Articles List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((article, index) => (
            <motion.div
              key={article.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card padding="md" hover onClick={() => handleArticleClick(article.id)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-[var(--text-primary)] mb-1">{article.title}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">{article.description}</p>
                    {article.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {article.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 bg-[var(--surface-2)] rounded text-[var(--text-muted)]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-[var(--text-muted)] flex-shrink-0" />
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  // Main Help Page
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center py-8">
        <h2 className="text-3xl font-bold text-[var(--text-primary)]">Βιβλιοθήκη γνώσης</h2>
        <p className="text-[var(--text-secondary)] mt-2 max-w-md mx-auto">
          Βρείτε απαντήσεις και οδηγούς για τη χρήση του allone
        </p>

        {/* Search */}
        <div className="relative max-w-xl mx-auto mt-6">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Αναζήτηση άρθρων..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--nts-accent)] shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-[var(--surface-2)] rounded"
            >
              <X size={16} className="text-[var(--text-muted)]" />
            </button>
          )}
        </div>
      </div>

      {/* Search Results */}
      {searchQuery && filteredArticles.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Αποτελέσματα αναζήτησης ({filteredArticles.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredArticles.map((article) => (
              <Card
                key={article.id}
                padding="md"
                hover
                onClick={() => handleArticleClick(article.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-[var(--text-primary)] mb-1">{article.title}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">{article.description}</p>
                  </div>
                  <ChevronRight size={18} className="text-[var(--text-muted)]" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {searchQuery && filteredArticles.length === 0 && (
        <Card padding="lg">
          <div className="text-center py-8">
            <p className="text-[var(--text-secondary)]">Δεν βρέθηκαν άρθρα για "{searchQuery}"</p>
            <p className="text-sm text-[var(--text-muted)] mt-2">Δοκιμάστε διαφορετικούς όρους αναζήτησης</p>
          </div>
        </Card>
      )}

      {/* Categories */}
      {!searchQuery && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {knowledgeCategories.map((category, index) => {
              const articlesCount = getArticlesByCategory(category.id).length;
              return (
                <motion.div
                  key={category.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    padding="md"
                    hover
                    onClick={() => handleCategoryClick(category.id)}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="w-12 h-12 rounded-xl border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center text-xs font-semibold text-[var(--nts-medium-gray)]"
                      >
                        {category.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-[var(--text-primary)]">{category.title}</h3>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">{category.description}</p>
                        <p className="text-xs mt-2 text-[var(--nts-medium-gray)]">
                          {articlesCount} άρθρα
                        </p>
                      </div>
                      <ChevronRight size={18} className="text-[var(--text-muted)]" />
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Popular Articles */}
          <Card padding="lg">
            <CardHeader
              title="Δημοφιλή Άρθρα"
              subtitle="Τα πιο χρήσιμα άρθρα"
              icon={<Book size={20} className="text-[var(--nts-accent-text)]" />}
            />
            <div className="space-y-3 mt-4">
              {knowledgeArticles
                .slice(0, 5)
                .map((article) => (
                  <motion.button
                    key={article.id}
                    onClick={() => handleArticleClick(article.id)}
                    className="w-full flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg hover:bg-[var(--nts-light-gray)] transition-colors group text-left"
                  >
                    <span className="text-sm text-[var(--text-primary)] group-hover:text-[var(--nts-accent-text)]">
                      {article.title}
                    </span>
                    <ChevronRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--nts-accent-text)]" />
                  </motion.button>
                ))}
            </div>
          </Card>

          {/* Contact Support */}
          <Card padding="lg">
            <CardHeader
              title="Επικοινωνία με Support"
              subtitle="Είμαστε εδώ για να βοηθήσουμε"
              icon={<MessageCircle size={20} className="text-[var(--nts-accent-text)]" />}
            />
            <div className="space-y-4 mt-4">
              <div className="p-4 bg-[var(--surface-2)] rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-[#22C55E]/20 rounded-lg flex items-center justify-center">
                    <MessageCircle size={20} className="text-[#22C55E]" />
                  </div>
                  <div>
                    <h4 className="font-medium text-[var(--text-primary)]">Live Chat</h4>
                    <p className="text-xs text-[#22C55E]">Διαθέσιμο τώρα</p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    window.location.href = `mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent('allone — επικοινωνία')}`;
                    toast.info('Ανοίγει το πρόγραμμα αλληλογραφίας για μήνυμα προς την ομάδα υποστήριξης.');
                  }}
                >
                  Ξεκινήστε Chat
                </Button>
              </div>

              <div className="p-4 border border-[var(--border)] rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-[var(--surface-2)] rounded-lg flex items-center justify-center">
                    <Mail size={20} className="text-[var(--text-secondary)]" />
                  </div>
                  <div>
                    <h4 className="font-medium text-[var(--text-primary)]">Email Support</h4>
                    <p className="text-xs text-[var(--text-secondary)]">noreply@performanceplus.gr</p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    window.location.href = `mailto:${SUPPORT_MAIL}`;
                  }}
                >
                  Στείλτε Email
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Footer */}
      <div className="text-center py-8 border-t border-[var(--border)]">
        <p className="text-[var(--text-secondary)]">
          Δεν βρίσκετε αυτό που ψάχνετε;{' '}
          <a href={`mailto:${SUPPORT_MAIL}`} className="text-[var(--nts-accent-text)] hover:underline">
            Επικοινωνήστε με την ομάδα μας
          </a>
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          allone by notthesame.ai | www.notthesame.ai
        </p>
      </div>
    </div>
  );
}
