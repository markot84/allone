import { describe, expect, it } from 'vitest';
import { validateProduct } from './import';

const base = { 'κωδικός': 'X-1', 'περιγραφή': 'Test', 'λιανικής': '100' };

describe('avg-cost columns (PER-330 follow-up)', () => {
  it('averages up to 3 Avg_Cost_N columns', () => {
    expect(validateProduct({ ...base, 'Avg_Cost_1': '60', 'Avg_Cost_2': '50', 'Avg_Cost_3': '40' }, 0).data?.avg_cost).toBe(50);
  });
  it('averages only the non-empty slots and accepts Greek headers', () => {
    expect(validateProduct({ ...base, 'Κόστος Κτήσης 1': '60', 'Κόστος Κτήσης 3': '40' }, 0).data?.avg_cost).toBe(50);
  });
  it('legacy single Avg_Cost still maps; all-empty omits avg_cost', () => {
    expect(validateProduct({ ...base, 'Avg_Cost': '57.5' }, 0).data?.avg_cost).toBe(57.5);
    expect(validateProduct({ ...base }, 0).data?.avg_cost).toBeUndefined();
  });
});
