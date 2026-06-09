import { FirestoreService } from './firestore';

export type CommercialActionScope = 'all' | 'categories' | 'products';

export type CommercialActionTargets = {
  revenueUpliftPct?: number;
  minMarginPct?: number;
  maxDeadStockCount?: number;
  minRoas?: number;
};

export interface CommercialAction {
  id: string;
  brandId: string;
  name: string;
  startDate: string;
  endDate: string;
  discountPercent?: number;
  scope: CommercialActionScope;
  selectedCategories?: string[];
  selectedProductIds?: string[];
  targets?: CommercialActionTargets;
  source: 'manual' | 'strategy_seasonal';
  strategyRef?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listCommercialActions(brandId: string): Promise<CommercialAction[]> {
  const rows = await FirestoreService.getDocuments<CommercialAction>(
    'commercial_actions',
    [],
    brandId
  );
  return rows.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

export async function saveCommercialAction(
  brandId: string,
  action: Omit<CommercialAction, 'id' | 'brandId' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<CommercialAction> {
  const now = new Date().toISOString();
  const id = action.id || `ca_${Date.now()}`;
  // LOGIC-18: this is a full-document overwrite, so on update we must carry the ORIGINAL
  // createdAt forward — otherwise every edit re-stamps it to now and the audit trail is lost.
  let createdAt = now;
  if (action.id) {
    const existing = await FirestoreService.getDocument<CommercialAction>('commercial_actions', action.id);
    createdAt = existing?.createdAt ?? now;
  }
  const doc: CommercialAction = {
    id,
    brandId,
    name: action.name,
    startDate: action.startDate,
    endDate: action.endDate,
    discountPercent: action.discountPercent,
    scope: action.scope,
    selectedCategories: action.selectedCategories ?? [],
    selectedProductIds: action.selectedProductIds ?? [],
    targets: action.targets,
    source: action.source,
    strategyRef: action.strategyRef,
    createdAt,
    updatedAt: now,
  };
  await FirestoreService.setDocument('commercial_actions', id, doc as unknown as Record<string, unknown>);
  return doc;
}

export async function deleteCommercialAction(actionId: string): Promise<void> {
  await FirestoreService.deleteDocument('commercial_actions', actionId);
}
