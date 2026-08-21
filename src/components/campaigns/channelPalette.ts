import { token } from '../../styles/chartTheme';

/**
 * One ad-channel palette for the whole campaigns module.
 *
 * There were three of these — the ROAS history card, the geo Mekko and the channel insight row —
 * and all three disagreed: Google Ads was a #22C55E green in one, a #F97316 orange in another and
 * Google's own #4285F4 blue in the third. A reader moving down this page had to re-learn the
 * legend at every card.
 *
 * The ramp is the shared one: the biggest spender is orange (the board's primary measure), what it
 * is compared against is sky, and the rest follow the categorical steps. Vendor brand colours are
 * deliberately NOT used — the chart is about spend and return, not about logos.
 */
const AD_CHANNEL_TOKENS: Record<string, string> = {
  'Google Ads': '--orange-500',
  'Google Shopping': '--orange-700',
  Meta: '--sky-500',
  Facebook: '--sky-500',
  Instagram: '--seg-potential',
  TikTok: '--navy-500',
  LinkedIn: '--sky-700',
  Pinterest: '--danger-700',
  Skroutz: '--gold-700',
  Email: '--orange-700',
  SMS: '--seg-potential',
  Other: '--text-muted',
};

export function adChannelColor(channel: string): string {
  return token(AD_CHANNEL_TOKENS[channel] ?? '--text-muted');
}
