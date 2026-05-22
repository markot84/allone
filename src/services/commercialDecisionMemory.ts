import { limit, orderBy } from 'firebase/firestore';
import { FirestoreService } from './firestore';
import type { ActiveStrategy } from '../hooks/useActiveStrategy';
import type { ChannelActivationStatus } from './channelActivationService';
import type { CommercialAction } from './commercialActions';
import type { Product, Campaign } from '../types';
import type { ProductSignal } from '../hooks/useProductSignals';

export type CommercialDecisionEventType =
  | 'pricing'
  | 'discount'
  | 'campaign'
  | 'channel'
  | 'assortment'
  | 'stock'
  | 'strategy'
  | 'manual';

export type CommercialDecisionSource =
  | 'manual'
  | 'legacy_action'
  | 'strategy'
  | 'campaigns'
  | 'channel_activation'
  | 'product_signals';

export type CommercialDecisionStatus = 'planned' | 'active' | 'completed' | 'paused' | 'detected';

export type CommercialDecisionVerdict = 'winning' | 'neutral' | 'losing' | 'learning';

export interface CommercialDecisionScope {
  channels?: string[];
  categories?: string[];
  productIds?: string[];
  skus?: string[];
  description?: string;
}

export interface CommercialDecisionChange {
  label: string;
  before?: string | number | null;
  after?: string | number | null;
}

export interface CommercialDecisionEvent {
  id: string;
  brandId: string;
  eventType: CommercialDecisionEventType;
  title: string;
  description?: string;
  source: CommercialDecisionSource;
  entityRef?: {
    collection?: string;
    id?: string;
    type?: string;
  };
  decisionDate: string;
  startDate?: string;
  endDate?: string;
  status: CommercialDecisionStatus;
  scope?: CommercialDecisionScope;
  changes?: CommercialDecisionChange[];
  hypothesis?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

function toIsoDate(value: unknown): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function stableId(...parts: Array<string | number | undefined | null>): string {
  return parts
    .filter((p) => p !== undefined && p !== null && String(p).trim().length > 0)
    .map((p) =>
      String(p)
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
    )
    .join('__');
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
}

function inferStatus(startDate?: string, endDate?: string, fallback: CommercialDecisionStatus = 'detected') {
  const today = new Date().toISOString().slice(0, 10);
  if (endDate && endDate < today) return 'completed';
  if (startDate && startDate > today) return 'planned';
  if (startDate || endDate) return 'active';
  return fallback;
}

export async function listCommercialDecisionEvents(brandId: string): Promise<CommercialDecisionEvent[]> {
  const rows = await FirestoreService.getDocuments<CommercialDecisionEvent>(
    'commercial_decision_events',
    [orderBy('decisionDate', 'desc'), limit(250)],
    brandId
  );
  return rows.sort((a, b) => (b.decisionDate || '').localeCompare(a.decisionDate || ''));
}

export async function saveCommercialDecisionEvent(
  brandId: string,
  event: Omit<CommercialDecisionEvent, 'id' | 'brandId' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<CommercialDecisionEvent> {
  const now = new Date().toISOString();
  const id = event.id || stableId('manual', brandId, event.eventType, event.title, event.decisionDate) || `cde_${Date.now()}`;
  const doc: CommercialDecisionEvent = {
    id,
    brandId,
    eventType: event.eventType,
    title: event.title,
    description: event.description,
    source: event.source,
    entityRef: event.entityRef,
    decisionDate: event.decisionDate,
    startDate: event.startDate,
    endDate: event.endDate,
    status: event.status,
    scope: event.scope,
    changes: event.changes ?? [],
    hypothesis: event.hypothesis,
    tags: event.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await FirestoreService.setDocument('commercial_decision_events', id, doc as unknown as Record<string, unknown>);
  return doc;
}

export function buildLegacyActionDecisionEvents(actions: CommercialAction[], brandId: string): CommercialDecisionEvent[] {
  return actions.map((action) => ({
    id: stableId('legacy', action.id),
    brandId,
    eventType: action.discountPercent ? 'discount' : 'manual',
    title: action.name,
    description: action.source === 'strategy_seasonal' ? 'Seasonal discount from Strategy.' : 'Manual commercial action.',
    source: 'legacy_action',
    entityRef: { collection: 'commercial_actions', id: action.id, type: action.source },
    decisionDate: action.startDate || toIsoDate(action.createdAt),
    startDate: action.startDate,
    endDate: action.endDate,
    status: inferStatus(action.startDate, action.endDate),
    scope: {
      categories: action.selectedCategories,
      productIds: action.selectedProductIds,
      description: action.scope === 'all' ? 'Όλο το assortment' : undefined,
    },
    changes: action.discountPercent
      ? [{ label: 'Έκπτωση', before: null, after: `${action.discountPercent}%` }]
      : [],
    hypothesis: action.targets?.revenueUpliftPct
      ? `Στόχος αύξησης τζίρου τουλάχιστον ${action.targets.revenueUpliftPct}% YoY.`
      : undefined,
    tags: unique([action.source, action.scope]),
    createdAt: toIsoDate(action.createdAt),
    updatedAt: toIsoDate(action.updatedAt),
  }));
}

export function buildStrategyDecisionEvents(
  strategy: ActiveStrategy | null | undefined,
  getStrategyName?: (scenarioId: string) => string
): CommercialDecisionEvent[] {
  if (!strategy?.brandId || strategy.id.startsWith('default_')) return [];
  const events: CommercialDecisionEvent[] = [];
  const strategyName = getStrategyName?.(strategy.scenarioId) ?? strategy.scenarioId;
  events.push({
    id: stableId('strategy', strategy.id, strategy.scenarioId),
    brandId: strategy.brandId,
    eventType: 'strategy',
    title: `Ενεργή πολιτική: ${strategyName}`,
    description: 'Αλλαγή ή επιβεβαίωση εμπορικής στρατηγικής.',
    source: 'strategy',
    entityRef: { collection: 'active_strategies', id: strategy.id, type: 'strategy' },
    decisionDate: toIsoDate(strategy.implementedAt ?? strategy.approvedAt ?? strategy.updatedAt),
    startDate: toIsoDate(strategy.implementedAt ?? strategy.approvedAt ?? strategy.updatedAt),
    status: strategy.approvalStatus === 'draft' || strategy.approvalStatus === 'pending_review' ? 'planned' : 'active',
    scope: {
      skus: strategy.triageOrigin?.skus?.slice(0, 20),
      description: strategy.triageOrigin?.label ?? (strategy.salesBaseScope ? 'Sales Optimization scope' : undefined),
    },
    changes: [
      { label: 'Scenario', before: null, after: strategyName },
      ...(strategy.monthlyBudget ? [{ label: 'Monthly budget', before: null, after: strategy.monthlyBudget }] : []),
    ],
    hypothesis: strategy.triageOrigin
      ? `Η στρατηγική στοχεύει το bucket “${strategy.triageOrigin.label}”.`
      : 'Η στρατηγική πρέπει να βελτιώσει το συνολικό εμπορικό αποτέλεσμα.',
    tags: unique(['strategy', strategy.approvalStatus, strategy.triageOrigin?.bucket]),
    createdAt: toIsoDate(strategy.createdAt),
    updatedAt: toIsoDate(strategy.updatedAt),
  });

  const seasonal = strategy.seasonalDiscount;
  if (seasonal?.periodName) {
    events.push({
      id: stableId('strategy', strategy.id, 'seasonal', seasonal.periodId ?? seasonal.periodName),
      brandId: strategy.brandId,
      eventType: 'discount',
      title: `Seasonal offer: ${seasonal.periodName}`,
      description: 'Εκπτωτική εμπορική ενέργεια από τη Strategy.',
      source: 'strategy',
      entityRef: { collection: 'active_strategies', id: strategy.id, type: 'seasonalDiscount' },
      decisionDate: seasonal.startDate || toIsoDate(strategy.updatedAt),
      startDate: seasonal.startDate,
      endDate: seasonal.endDate,
      status: inferStatus(seasonal.startDate, seasonal.endDate),
      scope: {
        categories: seasonal.selectedCategories,
        productIds: seasonal.selectedProductIds,
        description: seasonal.scope === 'all' ? 'Όλο το assortment' : seasonal.scope,
      },
      changes: [{ label: 'Έκπτωση', before: null, after: `${seasonal.discountPercent}%` }],
      hypothesis: 'Να επιταχύνει ζήτηση και conversion στην επιλεγμένη περίοδο.',
      tags: unique(['discount', 'seasonal', seasonal.scope]),
      createdAt: toIsoDate(strategy.createdAt),
      updatedAt: toIsoDate(strategy.updatedAt),
    });
  }

  return events;
}

export function buildCampaignDecisionEvents(campaigns: Campaign[], brandId: string): CommercialDecisionEvent[] {
  return campaigns
    .filter((c) => c.brandId === undefined || c.brandId === brandId)
    .filter((c) => c.name && (c.start_date || c.createdAt || c.importedAt))
    .slice(0, 120)
    .map((c) => {
      const spend = Number(c.amount_spent ?? 0);
      const value = Number(c.purchase_conversion_value ?? c.conversion_value ?? 0);
      return {
        id: stableId('campaign', c.id || c.name, c.start_date ?? toIsoDate(c.createdAt ?? c.importedAt)),
        brandId,
        eventType: 'campaign',
        title: `Campaign: ${c.name}`,
        description: `${c.channel}${c.status ? ` · ${c.status}` : ''}`,
        source: 'campaigns',
        entityRef: { collection: 'campaigns', id: c.id, type: c.channel },
        decisionDate: c.start_date || toIsoDate(c.createdAt ?? c.importedAt),
        startDate: c.start_date,
        endDate: c.end_date,
        status: c.status?.toLowerCase().includes('paused')
          ? 'paused'
          : inferStatus(c.start_date, c.end_date, c.is_active === false ? 'completed' : 'active'),
        scope: { channels: [c.channel] },
        changes: [
          ...(c.budget ? [{ label: 'Budget', before: null, after: c.budget }] : []),
          ...(spend > 0 ? [{ label: 'Spend', before: null, after: spend }] : []),
          ...(value > 0 ? [{ label: 'Purchase value', before: null, after: value }] : []),
        ],
        hypothesis: 'Να δημιουργήσει incremental revenue μέσω paid media.',
        tags: unique(['campaign', c.channel, c.status]),
        createdAt: toIsoDate(c.createdAt ?? c.importedAt),
        updatedAt: toIsoDate(c.importedAt ?? c.createdAt),
      } satisfies CommercialDecisionEvent;
    });
}

export function buildChannelDecisionEvents(activations: ChannelActivationStatus[], brandId: string): CommercialDecisionEvent[] {
  return activations
    .filter((a) => a.brandId === brandId)
    .map((a) => ({
      id: stableId('channel', a.id),
      brandId,
      eventType: 'channel',
      title: `${a.included === false ? 'Απενεργοποίηση' : 'Ενεργοποίηση'} καναλιού: ${a.channel}`,
      description: a.note || 'Status από Channel Activation.',
      source: 'channel_activation',
      entityRef: { collection: 'channel_activations', id: a.id, type: a.channel },
      decisionDate: toIsoDate(a.updatedAt),
      startDate: toIsoDate(a.updatedAt),
      status: a.status === 'done' ? 'completed' : a.status === 'in_progress' ? 'active' : 'planned',
      scope: { channels: [a.channel] },
      changes: [
        { label: 'Included', before: null, after: a.included === false ? 'No' : 'Yes' },
        { label: 'Status', before: null, after: a.status },
      ],
      hypothesis: 'Να αξιοποιήσει ή να ελέγξει την απόδοση του επιλεγμένου καναλιού.',
      tags: unique(['channel', a.channel, a.status, a.included === false ? 'excluded' : 'included']),
      createdAt: toIsoDate(a.updatedAt),
      updatedAt: toIsoDate(a.updatedAt),
    }));
}

export function buildProductSignalDecisionEvents(
  products: Product[],
  signalsBySku: Map<string, ProductSignal>,
  brandId: string
): CommercialDecisionEvent[] {
  const discounted = products
    .filter((p) => {
      const list = Number(p.compare_at_price ?? p.list_price ?? 0);
      return list > 0 && Number(p.price ?? 0) > 0 && list > Number(p.price);
    })
    .slice(0, 12);
  const lowStock = [...signalsBySku.values()]
    .filter((s) => typeof s.resolved.days_of_cover === 'number' && s.resolved.days_of_cover <= 14)
    .slice(0, 20);
  const marginRisk = [...signalsBySku.values()]
    .filter((s) => typeof s.resolved.margin_pct === 'number' && s.resolved.margin_pct < 15)
    .slice(0, 20);

  const now = new Date().toISOString();
  const events: CommercialDecisionEvent[] = [];

  if (discounted.length > 0) {
    events.push({
      id: stableId('product_signals', brandId, 'pricing_discounted'),
      brandId,
      eventType: 'pricing',
      title: `${discounted.length} προϊόντα με ενεργή έκπτωση τιμής`,
      description: 'Ανιχνεύτηκε τιμή πώλησης κάτω από list/compare price.',
      source: 'product_signals',
      entityRef: { collection: 'products', type: 'pricing' },
      decisionDate: now.slice(0, 10),
      status: 'detected',
      scope: {
        categories: unique(discounted.map((p) => p.category)).slice(0, 8),
        productIds: discounted.map((p) => p.id),
        skus: discounted.map((p) => p.sku).filter(Boolean),
      },
      changes: [{ label: 'Detected price markdowns', before: null, after: discounted.length }],
      hypothesis: 'Οι markdowns πρέπει να μεταφράζονται σε υψηλότερη ταχύτητα πωλήσεων χωρίς υπερβολική απώλεια margin.',
      tags: ['pricing', 'discount', 'auto-detected'],
      createdAt: now,
      updatedAt: now,
    });
  }

  if (lowStock.length > 0) {
    events.push({
      id: stableId('product_signals', brandId, 'stock_risk'),
      brandId,
      eventType: 'stock',
      title: `${lowStock.length} SKU με κίνδυνο stockout`,
      description: 'Ανιχνεύτηκε χαμηλό days of cover από procurement/product signals.',
      source: 'product_signals',
      entityRef: { collection: 'procurement_signals', type: 'stock' },
      decisionDate: now.slice(0, 10),
      status: 'detected',
      scope: { skus: lowStock.map((s) => s.resolved.sku), description: 'Low days of cover' },
      changes: [{ label: 'Low-cover SKUs', before: null, after: lowStock.length }],
      hypothesis: 'Η εμπορική πολιτική πρέπει να προστατεύσει διαθέσιμα best sellers και να αποφύγει wasted demand.',
      tags: ['stock', 'procurement', 'auto-detected'],
      createdAt: now,
      updatedAt: now,
    });
  }

  if (marginRisk.length > 0) {
    events.push({
      id: stableId('product_signals', brandId, 'margin_bleeders'),
      brandId,
      eventType: 'pricing',
      title: `${marginRisk.length} SKU με χαμηλό margin`,
      description: 'Ανιχνεύτηκε margin κάτω από 15%.',
      source: 'product_signals',
      entityRef: { collection: 'procurement_signals', type: 'margin' },
      decisionDate: now.slice(0, 10),
      status: 'detected',
      scope: { skus: marginRisk.map((s) => s.resolved.sku), description: 'Low margin watchlist' },
      changes: [{ label: 'Low-margin SKUs', before: null, after: marginRisk.length }],
      hypothesis: 'Να αποφευχθούν επαναλήψεις σεναρίων που αυξάνουν τζίρο αλλά καίνε μικτό κέρδος.',
      tags: ['pricing', 'margin', 'auto-detected'],
      createdAt: now,
      updatedAt: now,
    });
  }

  return events;
}

export function mergeCommercialDecisionEvents(
  stored: CommercialDecisionEvent[],
  derived: CommercialDecisionEvent[]
): CommercialDecisionEvent[] {
  const byId = new Map<string, CommercialDecisionEvent>();
  for (const event of derived) byId.set(event.id, event);
  for (const event of stored) byId.set(event.id, { ...byId.get(event.id), ...event });
  return [...byId.values()].sort((a, b) => (b.decisionDate || '').localeCompare(a.decisionDate || ''));
}
