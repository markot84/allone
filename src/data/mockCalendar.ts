import type { ContentCalendar } from '../types';

export const contentCalendar: ContentCalendar = {
  month: 'January 2026',
  theme: 'New Year, Fresh Start',
  customer_journey_focus: 'Consideration → Sales',
  content_items: [
    {
      week: 1,
      topic: 'New Year Resolutions Guide',
      formats: ['Blog Article', 'Newsletter', 'Instagram Carousel', 'LinkedIn Post'],
      target_segments: ['Champions', 'Loyal'],
      products_featured: ['Fitness', 'Wellness', 'Productivity'],
      status: 'published',
      performance: { views: 4523, engagement: '4.2%', conversions: 45 }
    },
    {
      week: 2,
      topic: 'Winter Clearance Event',
      formats: ['Landing Page', 'Email Series', 'Facebook Ads', 'Google Ads'],
      target_segments: ['At Risk', 'Potential Loyalists'],
      products_featured: ['Seasonal items', 'Excess stock'],
      status: 'published',
      performance: { views: 8934, engagement: '6.8%', conversions: 234 }
    },
    {
      week: 3,
      topic: 'Home Office Productivity',
      formats: ['Blog Article', 'Email Campaign', 'Pinterest Pins', 'YouTube Video'],
      target_segments: ['Champions', 'Potential Loyalists'],
      products_featured: ['Computing', 'Home & Living', 'Premium Electronics'],
      status: 'in_production'
    },
    {
      week: 4,
      topic: 'Valentine\'s Day Preview',
      formats: ['Gift Guide', 'Email Teaser', 'Instagram Stories', 'TikTok'],
      target_segments: ['All Segments'],
      products_featured: ['Beauty & Wellness', 'Fashion Accessories', 'Premium Electronics'],
      status: 'scheduled'
    }
  ]
};

export const upcomingMonths = [
  {
    month: 'February 2026',
    theme: 'Love & Connection',
    focus: 'Valentine\'s Day + Post-holiday engagement',
    key_events: ['Valentine\'s Day (14th)', 'Clean Monday (2nd)']
  },
  {
    month: 'March 2026',
    theme: 'Spring Awakening',
    focus: 'Seasonal transition + Spring cleaning',
    key_events: ['Women\'s Day (8th)', 'Greek Independence Day (25th)']
  },
  {
    month: 'April 2026',
    theme: 'Easter Celebrations',
    focus: 'Easter preparation + Family gatherings',
    key_events: ['Greek Easter', 'Spring Sales']
  }
];

export const contentFormats = [
  { id: 'blog', name: 'Blog Article', icon: '📝', channel: 'Website' },
  { id: 'email', name: 'Email Campaign', icon: '✉️', channel: 'Email' },
  { id: 'newsletter', name: 'Newsletter', icon: '📰', channel: 'Email' },
  { id: 'instagram_post', name: 'Instagram Post', icon: '📸', channel: 'Social' },
  { id: 'instagram_story', name: 'Instagram Stories', icon: '📱', channel: 'Social' },
  { id: 'instagram_carousel', name: 'Instagram Carousel', icon: '🎠', channel: 'Social' },
  { id: 'facebook_post', name: 'Facebook Post', icon: '👍', channel: 'Social' },
  { id: 'facebook_ads', name: 'Facebook Ads', icon: '🎯', channel: 'Paid' },
  { id: 'linkedin', name: 'LinkedIn Post', icon: '💼', channel: 'Social' },
  { id: 'pinterest', name: 'Pinterest Pins', icon: '📌', channel: 'Social' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', channel: 'Social' },
  { id: 'youtube', name: 'YouTube Video', icon: '🎬', channel: 'Video' },
  { id: 'google_ads', name: 'Google Ads', icon: '🔍', channel: 'Paid' },
  { id: 'landing', name: 'Landing Page', icon: '🖥️', channel: 'Website' },
  { id: 'gift_guide', name: 'Gift Guide', icon: '🎁', channel: 'Website' }
];
