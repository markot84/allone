import { useState, useMemo } from 'react';
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
import { Card, CardHeader, Button } from '../common';
import {
  knowledgeCategories,
  knowledgeArticles,
  getArticlesByCategory,
  searchArticles,
  getArticleById
} from '../../data/knowledgeBase';

export function Help() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-[#4A4A4A]" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-sm text-[#9CA3AF] mb-1">
              <span>{category?.icon}</span>
              <span>{category?.title}</span>
            </div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">{currentArticle.title}</h1>
            <p className="text-sm text-[#4A4A4A] mt-1">{currentArticle.description}</p>
          </div>
        </div>

        {/* Article Content */}
        <Card padding="lg">
          <div className="prose prose-sm max-w-none">
            <div className="whitespace-pre-line text-[#1A1A1A] leading-relaxed">
              {currentArticle.content.split('\n').map((line, i) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                  return (
                    <h3 key={i} className="font-semibold text-lg mt-6 mb-3 text-[#1A1A1A]">
                      {line.replace(/\*\*/g, '')}
                    </h3>
                  );
                }
                if (line.startsWith('- **')) {
                  const match = line.match(/- \*\*(.+?)\*\*: (.+)/);
                  if (match) {
                    return (
                      <div key={i} className="my-2">
                        <span className="font-semibold text-[#1A1A1A]">{match[1]}:</span>{' '}
                        <span className="text-[#4A4A4A]">{match[2]}</span>
                      </div>
                    );
                  }
                }
                if (line.trim() === '') {
                  return <br key={i} />;
                }
                return (
                  <p key={i} className="mb-3 text-[#4A4A4A]">
                    {line}
                  </p>
                );
              })}
            </div>

            {/* Steps */}
            {currentArticle.steps && currentArticle.steps.length > 0 && (
              <div className="mt-6 p-4 bg-[#F5F5F5] rounded-xl">
                <h4 className="font-semibold text-[#1A1A1A] mb-3 flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-[#22C55E]" />
                  Βήματα:
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-[#4A4A4A]">
                  {currentArticle.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Tips */}
            {currentArticle.tips && currentArticle.tips.length > 0 && (
              <div className="mt-6 p-4 bg-[#FFF0EB] rounded-xl border border-[#FF6B35]/20">
                <h4 className="font-semibold text-[#1A1A1A] mb-3 flex items-center gap-2">
                  <Lightbulb size={18} className="text-[#FF6B35]" />
                  Συμβουλές:
                </h4>
                <ul className="list-disc list-inside space-y-2 text-[#4A4A4A]">
                  {currentArticle.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* FAQ */}
            {currentArticle.faq && currentArticle.faq.length > 0 && (
              <div className="mt-6">
                <h4 className="font-semibold text-[#1A1A1A] mb-3 flex items-center gap-2">
                  <HelpCircle size={18} className="text-[#3B82F6]" />
                  Συχνές Ερωτήσεις:
                </h4>
                <div className="space-y-3">
                  {currentArticle.faq.map((item, i) => (
                    <div key={i} className="p-3 bg-white border border-[#E5E5E5] rounded-lg">
                      <p className="font-medium text-[#1A1A1A] mb-1">{item.question}</p>
                      <p className="text-sm text-[#4A4A4A]">{item.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Articles */}
            {currentArticle.related && currentArticle.related.length > 0 && (
              <div className="mt-6 pt-6 border-t border-[#E5E5E5]">
                <h4 className="font-semibold text-[#1A1A1A] mb-3">Σχετικά Άρθρα:</h4>
                <div className="flex flex-wrap gap-2">
                  {currentArticle.related.map((relatedId) => {
                    const related = getArticleById(relatedId);
                    if (!related) return null;
                    return (
                      <button
                        key={relatedId}
                        onClick={() => handleArticleClick(relatedId)}
                        className="px-3 py-1.5 bg-[#F5F5F5] hover:bg-[#FFF0EB] rounded-lg text-sm text-[#1A1A1A] transition-colors"
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
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-[#4A4A4A]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A] flex items-center gap-2">
              <span>{category?.icon}</span>
              {category?.title}
            </h1>
            <p className="text-sm text-[#4A4A4A] mt-1">{category?.description}</p>
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
                    <h3 className="font-semibold text-[#1A1A1A] mb-1">{article.title}</h3>
                    <p className="text-sm text-[#4A4A4A]">{article.description}</p>
                    {article.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {article.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 bg-[#F5F5F5] rounded text-[#6B7280]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-[#9CA3AF] flex-shrink-0" />
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
        <h2 className="text-3xl font-bold text-[#1A1A1A]">Knowledge Library</h2>
        <p className="text-[#4A4A4A] mt-2 max-w-md mx-auto">
          Βρείτε απαντήσεις και οδηγούς για τη χρήση του Performance+
        </p>

        {/* Search */}
        <div className="relative max-w-xl mx-auto mt-6">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Αναζήτηση άρθρων..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-[#E5E5E5] rounded-xl text-sm focus:outline-none focus:border-[#FF6B35] shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-[#F5F5F5] rounded"
            >
              <X size={16} className="text-[#9CA3AF]" />
            </button>
          )}
        </div>
      </div>

      {/* Search Results */}
      {searchQuery && filteredArticles.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#1A1A1A]">
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
                    <h3 className="font-semibold text-[#1A1A1A] mb-1">{article.title}</h3>
                    <p className="text-sm text-[#4A4A4A]">{article.description}</p>
                  </div>
                  <ChevronRight size={18} className="text-[#9CA3AF]" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {searchQuery && filteredArticles.length === 0 && (
        <Card padding="lg">
          <div className="text-center py-8">
            <p className="text-[#4A4A4A]">Δεν βρέθηκαν άρθρα για "{searchQuery}"</p>
            <p className="text-sm text-[#9CA3AF] mt-2">Δοκιμάστε διαφορετικούς όρους αναζήτησης</p>
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
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                        style={{ backgroundColor: `${category.color}15` }}
                      >
                        {category.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-[#1A1A1A]">{category.title}</h3>
                        <p className="text-sm text-[#4A4A4A] mt-1">{category.description}</p>
                        <p className="text-xs mt-2" style={{ color: category.color }}>
                          {articlesCount} άρθρα
                        </p>
                      </div>
                      <ChevronRight size={18} className="text-[#9CA3AF]" />
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
              icon={<Book size={20} className="text-[#FF6B35]" />}
            />
            <div className="space-y-3 mt-4">
              {knowledgeArticles
                .slice(0, 5)
                .map((article) => (
                  <motion.button
                    key={article.id}
                    onClick={() => handleArticleClick(article.id)}
                    className="w-full flex items-center justify-between p-3 bg-[#F5F5F5] rounded-lg hover:bg-[#FFF0EB] transition-colors group text-left"
                  >
                    <span className="text-sm text-[#1A1A1A] group-hover:text-[#FF6B35]">
                      {article.title}
                    </span>
                    <ChevronRight size={16} className="text-[#9CA3AF] group-hover:text-[#FF6B35]" />
                  </motion.button>
                ))}
            </div>
          </Card>

          {/* Contact Support */}
          <Card padding="lg">
            <CardHeader
              title="Επικοινωνία με Support"
              subtitle="Είμαστε εδώ για να βοηθήσουμε"
              icon={<MessageCircle size={20} className="text-[#FF6B35]" />}
            />
            <div className="space-y-4 mt-4">
              <div className="p-4 bg-[#F5F5F5] rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-[#22C55E]/20 rounded-lg flex items-center justify-center">
                    <MessageCircle size={20} className="text-[#22C55E]" />
                  </div>
                  <div>
                    <h4 className="font-medium text-[#1A1A1A]">Live Chat</h4>
                    <p className="text-xs text-[#22C55E]">Διαθέσιμο τώρα</p>
                  </div>
                </div>
                <Button variant="primary" className="w-full">
                  Ξεκινήστε Chat
                </Button>
              </div>

              <div className="p-4 border border-[#E5E5E5] rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-[#3B82F6]/20 rounded-lg flex items-center justify-center">
                    <Mail size={20} className="text-[#3B82F6]" />
                  </div>
                  <div>
                    <h4 className="font-medium text-[#1A1A1A]">Email Support</h4>
                    <p className="text-xs text-[#4A4A4A]">support@notthesame.ai</p>
                  </div>
                </div>
                <Button variant="secondary" className="w-full">
                  Στείλτε Email
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Footer */}
      <div className="text-center py-8 border-t border-[#E5E5E5]">
        <p className="text-[#4A4A4A]">
          Δεν βρίσκετε αυτό που ψάχνετε;{' '}
          <a href="mailto:support@notthesame.ai" className="text-[#FF6B35] hover:underline">
            Επικοινωνήστε με την ομάδα μας
          </a>
        </p>
        <p className="text-xs text-[#9CA3AF] mt-2">
          Performance+ by notthesame.ai | www.notthesame.ai
        </p>
      </div>
    </div>
  );
}
