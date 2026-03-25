import type { TriggerDefinition } from '../types';

export const TRIGGER_GROUPS = [
  { id: 'inventory', label: 'Απόθεμα & Προϊόντα' },
  { id: 'campaigns', label: 'Καμπάνιες & Απόδοση' },
  { id: 'customers', label: 'Πελατολόγιο & Segments' },
  { id: 'seasonal', label: 'Εποχικότητα' },
  { id: 'competitive', label: 'Ανταγωνισμός & Τιμές' },
  { id: 'procurement', label: 'Procurement (Enterprise)' },
] as const;

export const TRIGGERS_CATALOG: TriggerDefinition[] = [
  // ── Inventory & Products ──
  {
    id: 'dead_stock_alert',
    label: 'Dead stock',
    description: 'Ειδοποίηση όταν το ποσοστό dead stock ξεπεράσει το κατώφλι',
    group: 'inventory',
    planRequired: 'growth',
    defaultThreshold: 15,
    thresholdLabel: 'Dead stock %',
    thresholdUnit: '%',
    defaultInterval: 7,
  },
  {
    id: 'excess_stock_alert',
    label: 'Excess stock',
    description: 'Ειδοποίηση όταν η αξία excess stock ξεπεράσει το κατώφλι',
    group: 'inventory',
    planRequired: 'growth',
    defaultThreshold: 10000,
    thresholdLabel: 'Αξία excess stock',
    thresholdUnit: '€',
    defaultInterval: 7,
  },
  {
    id: 'low_stock_critical',
    label: 'Χαμηλό απόθεμα (high-margin)',
    description: 'Κρίσιμα χαμηλό απόθεμα σε SKUs υψηλού margin',
    group: 'inventory',
    planRequired: 'growth',
    defaultThreshold: 5,
    thresholdLabel: 'Πλήθος SKUs',
    thresholdUnit: 'SKUs',
    defaultInterval: 3,
  },
  {
    id: 'new_products_imported',
    label: 'Νέα προϊόντα',
    description: 'Ειδοποίηση όταν εισαχθούν νέα προϊόντα στον κατάλογο',
    group: 'inventory',
    planRequired: 'growth',
    defaultThreshold: 7,
    thresholdLabel: 'Εντός ημερών',
    thresholdUnit: 'ημ.',
    defaultInterval: 1,
  },
  {
    id: 'stock_growth',
    label: 'Μεγέθυνση αποθέματος',
    description: 'Ειδοποίηση όταν το συνολικό stock level ξεπεράσει κατώφλι',
    group: 'inventory',
    planRequired: 'growth',
    defaultThreshold: 10000,
    thresholdLabel: 'Σύνολο μονάδων',
    thresholdUnit: 'τμχ.',
    defaultInterval: 7,
  },

  // ── Campaigns ──
  {
    id: 'campaign_high_roas',
    label: 'Υψηλή απόδοση campaign',
    description: 'Ειδοποίηση όταν κάποιο campaign πετύχει εξαιρετικό ROAS',
    group: 'campaigns',
    planRequired: 'growth',
    defaultThreshold: 4,
    thresholdLabel: 'ROAS >',
    thresholdUnit: 'x',
    defaultInterval: 3,
  },
  {
    id: 'campaign_underperform',
    label: 'Campaign σε αδυναμία',
    description: 'Ειδοποίηση όταν κάποιο ενεργό campaign έχει χαμηλό ROAS',
    group: 'campaigns',
    planRequired: 'growth',
    defaultThreshold: 1,
    thresholdLabel: 'ROAS <',
    thresholdUnit: 'x',
    defaultInterval: 3,
  },

  // ── Customers / Segments ──
  {
    id: 'segment_churn_risk',
    label: 'Αύξηση churn risk',
    description: 'Ειδοποίηση όταν το at-risk segment ξεπεράσει ποσοστό',
    group: 'customers',
    planRequired: 'growth',
    defaultThreshold: 20,
    thresholdLabel: 'At-risk %',
    thresholdUnit: '%',
    defaultInterval: 7,
  },
  {
    id: 'segment_vip_growth',
    label: 'Ανάπτυξη VIP segment',
    description: 'Ειδοποίηση όταν οι Champions/VIP πελάτες αυξάνονται',
    group: 'customers',
    planRequired: 'growth',
    defaultThreshold: 10,
    thresholdLabel: 'Αύξηση >',
    thresholdUnit: '%',
    defaultInterval: 7,
  },

  // ── Seasonal ──
  {
    id: 'seasonal_approaching',
    label: 'Εποχική περίοδος πλησιάζει',
    description: 'Ειδοποίηση πριν από εποχικές περιόδους (Black Friday, Χριστούγεννα κ.α.)',
    group: 'seasonal',
    planRequired: 'growth',
    defaultThreshold: 14,
    thresholdLabel: 'Ημέρες πριν',
    thresholdUnit: 'ημ.',
    defaultInterval: 1,
  },

  // ── Competitive ──
  {
    id: 'price_above_benchmark',
    label: 'Τιμή πάνω από αγορά',
    description: 'Ειδοποίηση όταν SKUs σας είναι ακριβότερα από τη μέση τιμή αγοράς (Google Merchant Center)',
    group: 'competitive',
    planRequired: 'growth',
    defaultThreshold: 10,
    thresholdLabel: 'Απόκλιση >',
    thresholdUnit: '%',
    defaultInterval: 7,
  },
  {
    id: 'competitor_new_ads',
    label: 'Νέες ads ανταγωνιστών',
    description: 'Ειδοποίηση όταν εντοπιστούν νέες διαφημίσεις ανταγωνιστών (Meta Ad Library)',
    group: 'competitive',
    planRequired: 'growth',
    defaultThreshold: 3,
    thresholdLabel: 'Νέες ads >',
    thresholdUnit: 'ads',
    defaultInterval: 7,
  },

  // ── Procurement (Enterprise) ──
  {
    id: 'procurement_low_coverage',
    label: 'Χαμηλές ημέρες επάρκειας',
    description: 'Ειδοποίηση όταν οι ημέρες επάρκειας αποθέματος πέσουν κάτω από κατώφλι',
    group: 'procurement',
    planRequired: 'enterprise',
    defaultThreshold: 15,
    thresholdLabel: 'Ημέρες επάρκειας <',
    thresholdUnit: 'ημ.',
    defaultInterval: 3,
  },
  {
    id: 'procurement_high_surplus',
    label: 'Πλεόνασμα αποθέματος',
    description: 'Ειδοποίηση για υψηλό πλεόνασμα αποθέματος στο ERP',
    group: 'procurement',
    planRequired: 'enterprise',
    defaultThreshold: 50000,
    thresholdLabel: 'Αξία πλεονάσματος >',
    thresholdUnit: '€',
    defaultInterval: 7,
  },
  {
    id: 'procurement_new_brand',
    label: 'Νέο brand εισαγωγής',
    description: 'Ειδοποίηση όταν εντοπιστεί νέο brand στα δεδομένα procurement',
    group: 'procurement',
    planRequired: 'enterprise',
    defaultInterval: 1,
  },
  {
    id: 'procurement_pricing_drift',
    label: 'Τιμολογιακή απόκλιση',
    description: 'Ειδοποίηση όταν οι τιμές αποκλίνουν από την τιμολογιακή πολιτική',
    group: 'procurement',
    planRequired: 'enterprise',
    defaultThreshold: 10,
    thresholdLabel: 'Απόκλιση >',
    thresholdUnit: '%',
    defaultInterval: 7,
  },
  {
    id: 'procurement_supplier_delay',
    label: 'Καθυστέρηση προμηθευτή',
    description: 'Ειδοποίηση όταν ο χρόνος παράδοσης υπερβαίνει τον αναμενόμενο',
    group: 'procurement',
    planRequired: 'enterprise',
    defaultThreshold: 5,
    thresholdLabel: 'Υπέρβαση >',
    thresholdUnit: 'ημ.',
    defaultInterval: 3,
  },
];

export function getDefaultTriggerConfigs(): Record<string, import('../types').TriggerConfig> {
  const configs: Record<string, import('../types').TriggerConfig> = {};
  for (const t of TRIGGERS_CATALOG) {
    configs[t.id] = {
      enabled: false,
      threshold: t.defaultThreshold,
      checkIntervalDays: t.defaultInterval,
      autoBriefing: false,
    };
  }
  return configs;
}
