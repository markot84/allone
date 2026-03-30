import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let _db: Firestore;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

interface ProductAggregates {
  totalSkus: number;
  totalInventoryValue: number;
  deadStock: { count: number; value: number };
  lowStock: { count: number };
  healthyStock: { count: number };
  excessStock: { count: number; value: number };
  avgMargin: number;
  withStockLevel: number;
  withMargin: number;
}

interface SegmentAggregates {
  totalCustomers: number;
  segments: Record<string, { count: number; percentage: number; revenue: number }>;
  atRiskPercentage: number;
  championsPercentage: number;
}

interface CampaignAggregates {
  totalCampaigns: number;
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  avgRoas: number;
  topByRoas: { name: string; roas: number; spend: number; revenue: number }[];
  worstByRoas: { name: string; roas: number; spend: number; revenue: number }[];
  byMonth: Record<string, { spend: number; revenue: number; conversions: number }>;
}

function classifyStock(p: Record<string, unknown>, supplierTod = 60): string {
  const stockLevel = (p.stock_level as number) || 0;
  const stockAge = (p.stock_age_days as number) || 0;
  const avgDailySales = (p.avg_daily_sales as number) || 0;

  if (stockLevel === 0 && stockAge > supplierTod * 1.5) return 'dead';
  if (stockLevel > 0 && stockAge > supplierTod * 2) return 'dead';
  if (avgDailySales > 0 && stockLevel < avgDailySales * 7) return 'low';
  if (stockLevel === 0) return 'low';
  if (avgDailySales > 0 && stockLevel > avgDailySales * supplierTod * 2) return 'excess';
  return 'healthy';
}

async function aggregateProducts(brandId: string): Promise<ProductAggregates> {
  const snap = await db().collection('products').where('brandId', '==', brandId).get();
  const result: ProductAggregates = {
    totalSkus: snap.size,
    totalInventoryValue: 0,
    deadStock: { count: 0, value: 0 },
    lowStock: { count: 0 },
    healthyStock: { count: 0 },
    excessStock: { count: 0, value: 0 },
    avgMargin: 0,
    withStockLevel: 0,
    withMargin: 0,
  };

  if (snap.empty) return result;

  let marginSum = 0;
  let marginCount = 0;

  for (const doc of snap.docs) {
    const p = doc.data();
    const price = (p.price as number) || 0;
    const stockLevel = (p.stock_level as number) || 0;
    const margin = (p.margin_percentage as number) || 0;
    const value = price * stockLevel;

    result.totalInventoryValue += value;
    if (stockLevel > 0) result.withStockLevel++;
    if (margin > 0) {
      result.withMargin++;
      marginSum += margin;
      marginCount++;
    }

    const health = classifyStock(p);
    switch (health) {
      case 'dead':
        result.deadStock.count++;
        result.deadStock.value += value;
        break;
      case 'low':
        result.lowStock.count++;
        break;
      case 'excess':
        result.excessStock.count++;
        result.excessStock.value += value;
        break;
      default:
        result.healthyStock.count++;
    }
  }

  result.avgMargin = marginCount > 0 ? marginSum / marginCount : 0;
  return result;
}

async function aggregateSegments(brandId: string): Promise<SegmentAggregates> {
  const snap = await db().collection('segments').where('brandId', '==', brandId).get();
  const result: SegmentAggregates = {
    totalCustomers: 0,
    segments: {},
    atRiskPercentage: 0,
    championsPercentage: 0,
  };

  if (snap.empty) return result;

  let totalCustomers = 0;
  for (const doc of snap.docs) {
    const s = doc.data();
    const count = (s.count as number) || 0;
    totalCustomers += count;
    result.segments[s.segment_name as string || doc.id] = {
      count,
      percentage: 0,
      revenue: (s.total_revenue as number) || 0,
    };
  }

  result.totalCustomers = totalCustomers;

  if (totalCustomers > 0) {
    for (const key of Object.keys(result.segments)) {
      result.segments[key].percentage = (result.segments[key].count / totalCustomers) * 100;
    }

    const atRisk = Object.entries(result.segments)
      .filter(([k]) => k.toLowerCase().includes('at risk') || k.toLowerCase().includes('risk'))
      .reduce((sum, [, v]) => sum + v.count, 0);
    result.atRiskPercentage = (atRisk / totalCustomers) * 100;

    const champions = Object.entries(result.segments)
      .filter(([k]) => k.toLowerCase().includes('champion'))
      .reduce((sum, [, v]) => sum + v.count, 0);
    result.championsPercentage = (champions / totalCustomers) * 100;
  }

  return result;
}

async function aggregateCampaigns(brandId: string): Promise<CampaignAggregates> {
  const snap = await db().collection('campaigns').where('brandId', '==', brandId).get();
  const result: CampaignAggregates = {
    totalCampaigns: snap.size,
    totalSpend: 0,
    totalRevenue: 0,
    totalConversions: 0,
    avgRoas: 0,
    topByRoas: [],
    worstByRoas: [],
    byMonth: {},
  };

  if (snap.empty) return result;

  const campaignsWithRoas: { name: string; roas: number; spend: number; revenue: number }[] = [];

  for (const doc of snap.docs) {
    const c = doc.data();
    const spend = (c.amount_spent as number) || 0;
    const revenue = (c.conversion_value as number) || 0;
    const conversions = (c.conversions as number) || 0;

    result.totalSpend += spend;
    result.totalRevenue += revenue;
    result.totalConversions += conversions;

    if (spend > 0) {
      campaignsWithRoas.push({
        name: (c.campaign_name as string) || doc.id,
        roas: revenue / spend,
        spend,
        revenue,
      });
    }

    const dateStr = (c.start_date as string) || (c.date as string) || '';
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
        if (!result.byMonth[key]) result.byMonth[key] = { spend: 0, revenue: 0, conversions: 0 };
        result.byMonth[key].spend += spend;
        result.byMonth[key].revenue += revenue;
        result.byMonth[key].conversions += conversions;
      }
    }
  }

  result.avgRoas = result.totalSpend > 0 ? result.totalRevenue / result.totalSpend : 0;

  campaignsWithRoas.sort((a, b) => b.roas - a.roas);
  result.topByRoas = campaignsWithRoas.slice(0, 5);
  result.worstByRoas = campaignsWithRoas.filter(c => c.roas < 1).slice(-5).reverse();

  return result;
}

export async function computeAggregatesForBrand(brandId: string): Promise<void> {
  logger.info(`[Aggregates] Computing for brand ${brandId}`);

  const [products, segments, campaigns] = await Promise.all([
    aggregateProducts(brandId),
    aggregateSegments(brandId),
    aggregateCampaigns(brandId),
  ]);

  const aggRef = db().collection('brands').doc(brandId).collection('aggregates');
  const now = new Date().toISOString();

  await Promise.all([
    aggRef.doc('products').set({ ...products, updatedAt: now }),
    aggRef.doc('segments').set({ ...segments, updatedAt: now }),
    aggRef.doc('campaigns').set({ ...campaigns, updatedAt: now }),
  ]);

  logger.info(`[Aggregates] Done for ${brandId}: ${products.totalSkus} products, ${segments.totalCustomers} customers, ${campaigns.totalCampaigns} campaigns`);
}

export async function computeAggregatesForAllBrands(): Promise<number> {
  const brandsSnap = await db().collection('brands').get();
  let count = 0;

  for (const doc of brandsSnap.docs) {
    try {
      await computeAggregatesForBrand(doc.id);
      count++;
    } catch (err) {
      logger.error(`[Aggregates] Failed for brand ${doc.id}:`, err);
    }
  }

  return count;
}
