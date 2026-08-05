import { describe, expect, it } from 'vitest';
import { groupIntoSentences, parseGreekNumber, tokenizeBriefing, type BriefingToken } from './briefingTokens';
import type { BriefingData } from './morningBriefing';

const data: BriefingData = {
  revenue: {
    totalOrganic: 4200,
    totalCampaignRevenue: 18500,
    storeRevenue: 32450,
    ecommerceSourceActive: true,
    trueRoas: 4.7,
    revenueGap: 0,
    orderCount: 214,
    aov: 151.6,
    totalSpend: 6900,
    roas: 2.68,
    campaignCount: 5,
  },
  dataQuality: {
    ecommerceLatestPositiveRevenueDay: null,
    ecommerceDaysSinceLatestRevenue: null,
    ecommerceAggregateSyncedHoursAgo: null,
    suspectedEcommerceSyncGap: false,
  },
  ga4: {
    sessions: 12800,
    users: 9400,
    newUsers: 6100,
    bounceRate: 41.2,
    conversions: 318,
    weeklyChange: { sessions: 12.4, users: null, conversions: -3.1 },
  },
  inventory: {
    totalProducts: 4500,
    deadStock: 320,
    lowStock: 88,
    excessStock: 140,
    deadStockValue: 27300,
    lowStockTopNames: ['Καφετιέρα Espresso Pro'],
  },
  segments: {
    total: 5,
    totalCustomers: 3450,
    atRiskPct: 22.4,
    championsPct: 11.8,
    topSegment: { name: 'Hibernating', pct: 30.2 },
  },
  campaigns: {
    topPerformer: { name: 'Black Friday Retargeting', roas: 6.2 },
    worstPerformer: { name: 'Generic Prospecting', roas: 0.8, spend: 1450 },
  },
  alerts: { count: 7, critical: 2, topAlerts: [] },
  brandName: 'Demo',
};

const metrics = (tokens: BriefingToken[]) => tokens.filter((t) => t.kind === 'metric');
const entities = (tokens: BriefingToken[]) => tokens.filter((t) => t.kind === 'entity');

describe('parseGreekNumber', () => {
  it('reads Greek thousands and decimals', () => {
    expect(parseGreekNumber('32.450')).toBe(32450);
    expect(parseGreekNumber('1.234,5')).toBe(1234.5);
    expect(parseGreekNumber('4,7')).toBe(4.7);
  });

  it('reads the English convention too — the model produces both', () => {
    expect(parseGreekNumber('1,234.5')).toBe(1234.5);
    expect(parseGreekNumber('12,800')).toBe(12800);
  });

  it('leaves a plain decimal alone', () => {
    expect(parseGreekNumber('2.68')).toBe(2.68);
  });
});

describe('tokenizeBriefing', () => {
  it('links a number that matches a value we hold, with its real source', () => {
    const tokens = tokenizeBriefing('Τα έσοδα έφτασαν τα 32.450 € τον μήνα.', data);
    const found = metrics(tokens);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'metric',
      label: 'Έσοδα ηλεκτρονικού καταστήματος',
      source: 'Παραγγελίες e-shop',
      section: 'ecommerce',
    });
  });

  it('leaves an invented number as plain text', () => {
    const tokens = tokenizeBriefing('Τα έσοδα έφτασαν τα 99.999 € τον μήνα.', data);
    expect(metrics(tokens)).toHaveLength(0);
  });

  it('carries the week-over-week delta when the source has one', () => {
    const tokens = tokenizeBriefing('Καταγράφηκαν 12.800 επισκέψεις.', data);
    expect(metrics(tokens)[0]).toMatchObject({ label: 'Επισκέψεις', delta: 12.4 });
  });

  it('stays silent when two different quantities share a value', () => {
    const ambiguous: BriefingData = {
      ...data,
      inventory: { ...data.inventory, deadStock: 88 },
    };
    // 88 is now both lowStock and deadStock — attributing it either way would be a guess.
    expect(metrics(tokenizeBriefing('Υπάρχουν 88 προϊόντα σε πρόβλημα.', ambiguous))).toHaveLength(0);
  });

  it('ignores a bare single digit — prose, not a figure', () => {
    // 2 is genuinely the critical-alert count, but "2 φορές" is far likelier to be a turn of phrase.
    expect(metrics(tokenizeBriefing('Το ελέγξαμε 2 φορές.', data))).toHaveLength(0);
  });

  it('still links a small number when it is written as a figure', () => {
    expect(metrics(tokenizeBriefing('Η συνολική απόδοση είναι 4,7×.', data))[0]).toMatchObject({
      label: 'Συνολική απόδοση δαπάνης',
    });
  });

  it('links entities that appear in the data', () => {
    const tokens = tokenizeBriefing('Η «Black Friday Retargeting» αποδίδει καλύτερα.', data, {
      campaigns: [],
    });
    const found = entities(tokens);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'entity', section: 'campaigns', value: 'Black Friday Retargeting' });
  });

  it('links a product by name into a filtered Product Intelligence', () => {
    const tokens = tokenizeBriefing('Η Καφετιέρα Espresso Pro τελειώνει.', data);
    expect(entities(tokens)[0]).toMatchObject({
      section: 'products',
      hashQuery: `q=${encodeURIComponent('Καφετιέρα Espresso Pro')}`,
    });
  });

  it('reproduces the narrative exactly when the tokens are concatenated', () => {
    const narrative = 'Τα έσοδα έφτασαν τα 32.450 €, με 214 παραγγελίες και μέση αξία 151,6 €.';
    const tokens = tokenizeBriefing(narrative, data);
    expect(tokens.map((t) => t.value).join('')).toBe(narrative);
  });

  it('never overlaps a metric with an entity', () => {
    const narrative = 'Το segment Hibernating κρατά 30,2% των πελατών.';
    const tokens = tokenizeBriefing(narrative, data);
    expect(tokens.map((t) => t.value).join('')).toBe(narrative);
  });
});

describe('groupIntoSentences', () => {
  it('splits on sentence ends and keeps the delimiter', () => {
    const groups = groupIntoSentences(tokenizeBriefing('Πρώτη πρόταση. Δεύτερη πρόταση.', data));
    expect(groups).toHaveLength(2);
    expect(groups[0].map((t) => t.value).join('')).toBe('Πρώτη πρόταση. ');
  });

  it('keeps a metric in the sentence that contains it', () => {
    const groups = groupIntoSentences(tokenizeBriefing('Έσοδα 32.450 €. Επόμενη πρόταση.', data));
    expect(groups[0].some((t) => t.kind === 'metric')).toBe(true);
    expect(groups[1].some((t) => t.kind === 'metric')).toBe(false);
  });
});
