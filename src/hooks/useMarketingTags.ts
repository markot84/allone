import { useEffect } from 'react';
import { loadMarketingTags } from '../utils/marketingTracking';

/**
 * Φορτώνει τα marketing tracking tags (Google Ads, GA4, Meta Pixel, LinkedIn
 * Insight, Clarity) **δυναμικά** και **μόνο** στη σελίδα που καλεί το hook
 * (marketing/landing). Δεν μπαίνουν στο `index.html`, ώστε να ΜΗΝ φορτώνουν στις
 * σελίδες της εφαρμογής (dashboard, connectors κ.λπ.).
 */
export function useMarketingTags(): void {
  useEffect(() => {
    loadMarketingTags();
  }, []);
}
