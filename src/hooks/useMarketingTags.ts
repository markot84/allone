import { useEffect } from 'react';
import { loadMarketingTags } from '../utils/marketingTracking';

/** Loads marketing tags (Google Ads, GA4, Meta Pixel, LinkedIn Insight, Clarity) only on the
 * calling page; kept out of `index.html` so app pages stay clean. */
export function useMarketingTags(): void {
  useEffect(() => {
    loadMarketingTags();
  }, []);
}
