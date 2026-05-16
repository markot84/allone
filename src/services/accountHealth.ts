/**
 * Account Health Score — B2B equivalent of RFM.
 * Score 0–100 from 4 dimensions: Recency, Frequency, Monetary, Engagement.
 */

export type AccountHealthSegment = 'champion' | 'growing' | 'at_risk' | 'dormant' | 'new';

export interface AccountHealthInput {
  lastOrderDate?: string;   // ISO date
  ordersLast6m?: number;
  revenueContribution?: number; // 0–1 (% of total brand revenue)
  openTasks?: number;           // coordination tasks for this account
  totalRevenue?: number;        // absolute EUR value
}

export interface AccountHealthScore {
  total: number;        // 0–100
  recency: number;      // 0–25
  frequency: number;    // 0–25
  monetary: number;     // 0–25
  engagement: number;   // 0–25
  segment: AccountHealthSegment;
}

export function computeAccountHealth(input: AccountHealthInput): AccountHealthScore {
  const today = new Date();

  // Recency (0–25): days since last order
  let recency = 0;
  if (input.lastOrderDate) {
    const daysSince = Math.max(0, (today.getTime() - new Date(input.lastOrderDate).getTime()) / 86400000);
    if (daysSince <= 30) recency = 25;
    else if (daysSince <= 60) recency = 20;
    else if (daysSince <= 90) recency = 15;
    else if (daysSince <= 180) recency = 8;
    else recency = 2;
  }

  // Frequency (0–25): orders in last 6 months
  const freq = input.ordersLast6m ?? 0;
  let frequency = 0;
  if (freq >= 10) frequency = 25;
  else if (freq >= 6) frequency = 20;
  else if (freq >= 3) frequency = 14;
  else if (freq >= 1) frequency = 8;

  // Monetary (0–25): revenue contribution %
  const contrib = input.revenueContribution ?? 0;
  let monetary = 0;
  if (contrib >= 0.2) monetary = 25;
  else if (contrib >= 0.1) monetary = 20;
  else if (contrib >= 0.05) monetary = 14;
  else if (contrib >= 0.01) monetary = 8;
  else if ((input.totalRevenue ?? 0) > 0) monetary = 4;

  // Engagement (0–25): active coordination tasks
  const tasks = input.openTasks ?? 0;
  let engagement = 0;
  if (tasks >= 5) engagement = 25;
  else if (tasks >= 3) engagement = 18;
  else if (tasks >= 1) engagement = 10;

  const total = recency + frequency + monetary + engagement;

  let segment: AccountHealthSegment;
  if (total >= 75) segment = 'champion';
  else if (total >= 55) segment = 'growing';
  else if (total >= 35) segment = 'at_risk';
  else if (total >= 10) segment = 'dormant';
  else segment = 'new';

  return { total, recency, frequency, monetary, engagement, segment };
}

export const SEGMENT_META: Record<AccountHealthSegment, { label: string; color: string; bg: string; description: string }> = {
  champion: { label: 'Champion', color: '#059669', bg: '#ecfdf5', description: 'Υψηλή συχνότητα, πρόσφατη αγορά, σημαντική συνεισφορά εσόδων.' },
  growing: { label: 'Growing', color: '#2563eb', bg: '#eff6ff', description: 'Αυξητική τάση — αξίζει cross-sell & upsell focus.' },
  at_risk: { label: 'At Risk', color: '#d97706', bg: '#fffbeb', description: 'Μειωμένη δραστηριότητα — χρειάζεται proactive επικοινωνία.' },
  dormant: { label: 'Dormant', color: '#9ca3af', bg: '#f9fafb', description: 'Ανενεργός λογαριασμός — rescue motion ή declassification.' },
  new: { label: 'New', color: '#7c3aed', bg: '#f5f3ff', description: 'Νέος λογαριασμός — onboarding & first order focus.' },
};
