import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), configured: true }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { loadLoyaltyStatus } from './coupons.server';
beforeEach(() => { vi.clearAllMocks(); mocks.configured = true; mocks.getUser.mockResolvedValue({ data: { user: { id: 'self' } }, error: null }); });
describe('loyalty display aggregate', () => {
  it('uses the self-only database aggregate and current count-only policy', async () => {
    mocks.rpc.mockResolvedValue({ data: { grade: 'welcome', windowSpend: 9000000, windowItemCount: 1001,
      policy: { revision: 8, updatedAt: '2026-10-13T03:00:00Z', tiers: [
        { grade: 'silver', enabled: true, amount: null, itemCount: 1002 },
        { grade: 'gold', enabled: true, amount: null, itemCount: 2000 },
        { grade: 'platinum', enabled: false, amount: null, itemCount: null },
      ] } }, error: null });
    expect(await loadLoyaltyStatus()).toEqual({ grade: 'welcome', windowSpend: 9000000, windowItemCount: 1001, nextNote: 'SILVER까지 굿즈 주문 항목 1건' });
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_loyalty_status');
  });
  it('does not report zero spend or stale thresholds when reading fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await loadLoyaltyStatus()).toBeNull();
  });
  it('does not query private status before login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await loadLoyaltyStatus()).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
