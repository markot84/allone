// Web Search Service for AI Assistant
// Provides internet access for marketing, digital marketing, procurement, analytics, content marketing topics
import { getAuth } from 'firebase/auth';
import { buildFunctionUrl, getAppCheckHeader } from '../config/firebase';
import { logger } from '../utils/logger';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

interface WebSearchResponse {
  results: SearchResult[];
  query: string;
  totalResults?: number;
}

// Marketing-related topics that trigger web search
const MARKETING_TOPICS = [
  'marketing',
  'digital marketing',
  'procurement',
  'analytics',
  'content marketing',
  'seo',
  'sem',
  'ppc',
  'social media',
  'email marketing',
  'conversion',
  'roi',
  'attribution',
  'customer acquisition',
  'retention',
  'segmentation',
  'personalization',
  'automation',
  'crm',
  'ecommerce',
  'inventory management',
  'supply chain',
  'best practices',
  'trends',
  'strategy',
  'tactics',
  'campaign',
  'advertising',
  'promotion',
  'branding'
];

// Check if query should trigger web search
export function shouldSearchWeb(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  
  // Check if query contains marketing-related keywords
  const hasMarketingKeyword = MARKETING_TOPICS.some(topic => 
    lowerQuery.includes(topic.toLowerCase())
  );
  
  // Check if query asks for external information (trends, best practices, etc.)
  const asksForExternalInfo = 
    lowerQuery.includes('trends') ||
    lowerQuery.includes('best practices') ||
    lowerQuery.includes('how to') ||
    lowerQuery.includes('what is') ||
    lowerQuery.includes('examples') ||
    lowerQuery.includes('case study') ||
    lowerQuery.includes('guide') ||
    lowerQuery.includes('tutorial');
  
  // Check if query is about general marketing concepts not in knowledge base
  const isGeneralMarketingQuery = 
    (lowerQuery.includes('marketing') || lowerQuery.includes('digital')) &&
    !lowerQuery.includes('performance+') &&
    !lowerQuery.includes('rfm') &&
    !lowerQuery.includes('import');
  
  return hasMarketingKeyword || asksForExternalInfo || isGeneralMarketingQuery;
}

// Perform web search via the server-side webSearch proxy (DuckDuckGo Instant
// Answer). The browser CSP blocks a direct fetch to api.duckduckgo.com, so the
// lookup runs server-side; the proxy returns the raw DuckDuckGo payload, parsed
// below exactly as before. Falls back to curated resources on any failure.
export async function searchWeb(query: string): Promise<WebSearchResponse> {
  try {
    const idToken = await getAuth().currentUser?.getIdToken();
    if (!idToken) return getCuratedMarketingResources(query);
    const appCheck = await getAppCheckHeader();

    const response = await fetch(buildFunctionUrl('webSearch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...appCheck },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) return getCuratedMarketingResources(query);
    const data = await response.json();
    
    const results: SearchResult[] = [];
    
    // Extract instant answer if available
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.AbstractText,
        source: 'DuckDuckGo Instant Answer'
      });
    }
    
    // Extract related topics
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 3).forEach((topic: { Text?: string; FirstURL?: string }) => {
        if (topic.Text) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text,
            url: topic.FirstURL || '',
            snippet: topic.Text,
            source: 'DuckDuckGo'
          });
        }
      });
    }
    
    // If no results from DuckDuckGo, return curated marketing resources
    if (results.length === 0) {
      return getCuratedMarketingResources(query);
    }
    
    return {
      results: results.slice(0, 5),
      query,
      totalResults: results.length
    };
  } catch (error) {
    logger.error('Web search error:', { err: error });
    // Fallback to curated resources
    return getCuratedMarketingResources(query);
  }
}

// Curated marketing resources as fallback
function getCuratedMarketingResources(query: string): WebSearchResponse {
  const lowerQuery = query.toLowerCase();
  
  const resources: SearchResult[] = [];
  
  // Digital Marketing resources
  if (lowerQuery.includes('digital marketing') || lowerQuery.includes('online marketing')) {
    resources.push(
      {
        title: 'Digital Marketing Guide - HubSpot',
        url: 'https://www.hubspot.com/marketing/what-is-digital-marketing',
        snippet: 'Digital marketing encompasses all marketing efforts that use an electronic device or the internet. Businesses leverage digital channels such as search engines, social media, email, and websites to connect with current and prospective customers.',
        source: 'HubSpot'
      },
      {
        title: 'Digital Marketing Strategies - Google Digital Garage',
        url: 'https://learndigital.withgoogle.com/digitalgarage',
        snippet: 'Learn digital marketing skills with free courses from Google. Topics include SEO, SEM, social media, analytics, and more.',
        source: 'Google Digital Garage'
      }
    );
  }
  
  // Content Marketing resources
  if (lowerQuery.includes('content marketing')) {
    resources.push(
      {
        title: 'Content Marketing Institute',
        url: 'https://contentmarketinginstitute.com/',
        snippet: 'Content marketing is a strategic marketing approach focused on creating and distributing valuable, relevant, and consistent content to attract and retain a clearly defined audience.',
        source: 'Content Marketing Institute'
      }
    );
  }
  
  // Analytics resources
  if (lowerQuery.includes('analytics') || lowerQuery.includes('data analysis')) {
    resources.push(
      {
        title: 'Google Analytics Academy',
        url: 'https://analytics.google.com/analytics/academy/',
        snippet: 'Learn Google Analytics for free. Master the fundamentals of digital analytics and improve your marketing performance.',
        source: 'Google Analytics'
      },
      {
        title: 'Marketing Analytics Guide - Moz',
        url: 'https://moz.com/learn/seo/marketing-analytics',
        snippet: 'Marketing analytics helps you measure, manage, and analyze marketing performance to maximize effectiveness and optimize ROI.',
        source: 'Moz'
      }
    );
  }
  
  // Procurement resources
  if (lowerQuery.includes('procurement') || lowerQuery.includes('supply chain')) {
    resources.push(
      {
        title: 'Procurement Best Practices - CIPS',
        url: 'https://www.cips.org/',
        snippet: 'Procurement involves the process of selecting vendors, establishing payment terms, strategic vetting, selection, the negotiation of contracts, and actual purchasing of goods.',
        source: 'CIPS'
      }
    );
  }
  
  // General marketing strategy
  if (lowerQuery.includes('strategy') || lowerQuery.includes('marketing strategy')) {
    resources.push(
      {
        title: 'Marketing Strategy Framework - HBR',
        url: 'https://hbr.org/topic/marketing',
        snippet: 'A marketing strategy is a business\'s overall game plan for reaching prospective consumers and turning them into customers.',
        source: 'Harvard Business Review'
      }
    );
  }
  
  // ROI and Attribution
  if (lowerQuery.includes('roi') || lowerQuery.includes('attribution')) {
    resources.push(
      {
        title: 'Marketing Attribution Models - Google',
        url: 'https://support.google.com/analytics/answer/1662518',
        snippet: 'Attribution models help you understand which touchpoints contribute to conversions and how to assign credit to each interaction.',
        source: 'Google Analytics'
      }
    );
  }
  
  // If no specific match, provide general marketing resources
  if (resources.length === 0) {
    resources.push(
      {
        title: 'Marketing Best Practices - Marketing Land',
        url: 'https://marketingland.com/',
        snippet: 'Stay updated with the latest marketing trends, strategies, and best practices in digital marketing.',
        source: 'Marketing Land'
      },
      {
        title: 'Digital Marketing Resources - Moz',
        url: 'https://moz.com/learn',
        snippet: 'Free resources and guides for SEO, content marketing, social media, and digital marketing.',
        source: 'Moz'
      }
    );
  }
  
  return {
    results: resources.slice(0, 5),
    query,
    totalResults: resources.length
  };
}

// Format search results for AI Assistant response
export function formatSearchResultsForResponse(searchResponse: WebSearchResponse): string {
  if (searchResponse.results.length === 0) {
    return 'Δεν βρήκα συγκεκριμένες πληροφορίες στο διαδίκτυο για αυτή την ερώτηση.';
  }
  
  let response = 'Βρήκα τις ακόλουθες πληροφορίες:\n\n';
  
  searchResponse.results.forEach((result, index) => {
    response += `${index + 1}. **${result.title}**\n`;
    response += `${result.snippet}\n`;
    if (result.url) {
      response += `[Δείτε περισσότερα](${result.url})\n`;
    }
    response += '\n';
  });
  
  response += '\n*Πηγές: Διαδίκτυο - Ενημερωμένο περιεχόμενο*';
  
  return response;
}
