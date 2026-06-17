import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAutomationEvaluation } from './automationEngine';
import { TRIGGERS_CATALOG } from '../data/triggersCatalog';
import type { Campaign, TriggerConfig } from '../types';

const { updateTriggerSpy, createAlertSpy } = vi.hoisted(() => ({
  updateTriggerSpy: vi.fn<(brandId: string, triggerId: string, config: Record<string, unknown>) => Promise<void>>(async () => {}),
  createAlertSpy: vi.fn<(alert: { triggerId: string } & Record<string, unknown>) => Promise<string>>(async () => 'alert-1'),
}));

// Mock the Firestore services so the engine runs purely in-memory (node env).
vi.mock('./automationSettings', () => ({
  AutomationSettingsService: {
    get: vi.fn(async () => ({ triggers: allEnabledTriggers(), updatedAt: '' })),
    updateTrigger: updateTriggerSpy,
  },
  AutomationAlertsService: {
    getAll: vi.fn(async () => []),
    create: createAlertSpy,
    updateStatus: vi.fn(async () => {}),
  },
}));

vi.mock('./coordination', () => ({
  DecisionsService: { create: vi.fn(async () => 'dec-1') },
  logAndNotify: vi.fn(async () => {}),
}));

const INVENTORY_IDS = TRIGGERS_CATALOG.filter(t => t.group === 'inventory').map(t => t.id);

function allEnabledTriggers(): Record<string, TriggerConfig> {
  return Object.fromEntries(
    TRIGGERS_CATALOG.map(t => [
      t.id,
      { enabled: true, threshold: t.defaultThreshold, checkIntervalDays: t.defaultInterval, autoBriefing: false },
    ])
  );
}

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1',
    name: 'Search GR',
    channel: 'Google Ads',
    is_active: true,
    roas: 9,
    amount_spent: 500,
    ...overrides,
  };
}

describe('runAutomationEvaluation — server-only inventory skip', () => {
  beforeEach(() => {
    updateTriggerSpy.mockClear();
    createAlertSpy.mockClear();
  });

  it('with products: [] the 5 inventory triggers are skipped BEFORE any updateTrigger write', async () => {
    await runAutomationEvaluation({
      brandId: 'b1',
      userId: 'u1',
      userName: 'tester',
      plan: 'growth',
      products: [],
      segments: [],
      campaigns: [makeCampaign()],
      suppliers: [],
    });

    expect(INVENTORY_IDS).toHaveLength(5);
    const stampedIds = updateTriggerSpy.mock.calls.map(call => call[1]);
    for (const id of INVENTORY_IDS) {
      expect(stampedIds).not.toContain(id);
    }
  });

  it('due non-inventory triggers keep being evaluated and writing lastCheckedAt', async () => {
    const results = await runAutomationEvaluation({
      brandId: 'b1',
      userId: 'u1',
      userName: 'tester',
      plan: 'growth',
      products: [],
      segments: [],
      campaigns: [makeCampaign()],
      suppliers: [],
    });

    const stampedIds = updateTriggerSpy.mock.calls.map(call => call[1]);
    expect(stampedIds).toContain('campaign_high_roas');
    // roas 9 > default threshold 4 ⇒ the trigger fires normally without products.
    expect(results.map(r => r.triggerId)).toContain('campaign_high_roas');
  });

  it('no alert doc is created for inventory trigger ids', async () => {
    await runAutomationEvaluation({
      brandId: 'b1',
      userId: 'u1',
      userName: 'tester',
      plan: 'growth',
      products: [],
      segments: [],
      campaigns: [makeCampaign()],
      suppliers: [],
    });

    const alertTriggerIds = createAlertSpy.mock.calls.map(call => call[0].triggerId);
    for (const id of INVENTORY_IDS) {
      expect(alertTriggerIds).not.toContain(id);
    }
    expect(alertTriggerIds).toContain('campaign_high_roas');
  });
});
