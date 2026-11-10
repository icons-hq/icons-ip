import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimCouponCodeAction } from './actions';
const mocks = vi.hoisted(() => ({ auth: { isConfigured: true, user: { id: 'user-1' } as { id: string } | null }, rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
beforeEach(() => { mocks.auth.user = { id: 'user-1' }; mocks.rpc.mockReset().mockResolvedValue({ error: null }); mocks.revalidatePath.mockReset(); });
describe('claimCouponCodeAction', () => {
  it('requires a user and valid code before issuing', async () => {
    mocks.auth.user = null;
    expect((await claimCouponCodeAction('SCHEDULE-7')).ok).toBe(false);
    mocks.auth.user = { id: 'user-1' };
    expect((await claimCouponCodeAction('bad code')).ok).toBe(false);
    expect((await claimCouponCodeAction(123)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('claims independently of the cart and refreshes held coupon views', async () => {
    expect(await claimCouponCodeAction(' schedule-7 ')).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_coupon_code', { p_code: 'SCHEDULE-7' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/my/coupons');
  });
  it('surfaces the issuance period and leaves network failure retryable', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'coupon_issue_ended' } });
    expect(await claimCouponCodeAction('SCHEDULE-7')).toEqual({ ok: false, message: '발급 기간이 끝난 쿠폰이에요.' });
    mocks.rpc.mockRejectedValueOnce(new Error('offline'));
    expect(await claimCouponCodeAction('SCHEDULE-7')).toEqual({ ok: false, message: '쿠폰을 등록하지 못했습니다. 다시 시도해주세요.' });
  });
});
