import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLoyaltyBenefitsPage } from './loyalty-benefits.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  configured: true,
  rpc: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  calls: [] as string[],
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      mocks.calls.push(name);
      return mocks.rpc[name] ?? { data: null, error: { message: 'missing' } };
    },
  }),
}));

const STATUS = {
  grade: 'welcome',
  windowSpend: 0,
  windowItemCount: 0,
  policy: { tiers: [
    { grade: 'silver', enabled: true, amount: 150000, itemCount: null },
    { grade: 'gold', enabled: false, amount: null, itemCount: null },
    { grade: 'platinum', enabled: false, amount: null, itemCount: null },
  ], revision: 1, updatedAt: '2026-10-20T00:00:00.000Z' },
};
const BENEFITS = {
  creditRatesEnabled: false,
  grades: ['welcome', 'silver', 'gold', 'platinum'].map((grade) => ({ grade, creditRateBps: null, coupons: [] })),
};

describe('loadLoyaltyBenefitsPage', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.calls = [];
    mocks.rpc = {
      get_my_loyalty_status: { data: STATUS, error: null },
      get_loyalty_grade_benefits: { data: BENEFITS, error: null },
    };
  });

  it('reads my standing and the grade benefits together', async () => {
    const data = await loadLoyaltyBenefitsPage();

    expect(mocks.calls.sort()).toEqual(['get_loyalty_grade_benefits', 'get_my_loyalty_status']);
    expect(data.standing).toMatchObject({ grade: 'welcome', nextNote: 'SILVER까지 150,000원' });
    expect(data.benefits?.grades).toHaveLength(4);
  });

  /* 한쪽이 실패해도 다른 쪽 안내는 맞아야 한다 — 각자 null 로 접는다. */
  it('folds each failed or malformed read to null on its own', async () => {
    mocks.rpc.get_loyalty_grade_benefits = { data: null, error: { message: 'permission denied' } };
    expect(await loadLoyaltyBenefitsPage()).toMatchObject({ benefits: null, standing: { grade: 'welcome' } });

    mocks.rpc.get_loyalty_grade_benefits = { data: BENEFITS, error: null };
    mocks.rpc.get_my_loyalty_status = { data: { ...STATUS, grade: 'vip' }, error: null };
    const data = await loadLoyaltyBenefitsPage();
    expect(data.standing).toBeNull();
    expect(data.benefits).not.toBeNull();
  });

  it('does not query without a configured backend', async () => {
    mocks.configured = false;
    expect(await loadLoyaltyBenefitsPage()).toEqual({ standing: null, benefits: null });
    expect(mocks.calls).toEqual([]);
  });
});
