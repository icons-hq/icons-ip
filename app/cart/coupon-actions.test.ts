import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCouponAction,
  applyCouponCodeAction,
  clearCouponAction,
} from './coupon-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'user-1' } } as {
    isConfigured: boolean;
    user: { id: string } | null;
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

const userCouponId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  mocks.auth = { isConfigured: true, user: { id: 'user-1' } };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.revalidatePath.mockClear();
});

describe('applyCouponCodeAction', () => {
  it('코드를 RPC에 그대로 넘기고 카트를 재검증한다', async () => {
    const result = await applyCouponCodeAction(' welcome-5000 ');

    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('apply_cart_coupon_code', { p_code: 'welcome-5000' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/cart');
  });

  it('로그인 전에는 RPC를 부르지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null };

    const result = await applyCouponCodeAction('WELCOME-5000');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('로그인');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('빈 코드는 RPC 전에 거른다', async () => {
    const result = await applyCouponCodeAction('   ');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('입력');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('도메인 거부 사유를 구매자 언어로 옮기고 재검증하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'coupon_exhausted' } });

    const result = await applyCouponCodeAction('CPNONE');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('소진');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('applyCouponAction', () => {
  it('보유 쿠폰 id를 RPC에 넘긴다', async () => {
    const result = await applyCouponAction(userCouponId);

    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('apply_cart_coupon', { p_user_coupon_id: userCouponId });
  });

  it('uuid가 아닌 입력은 RPC 전에 거른다', async () => {
    const result = await applyCouponAction('not-a-uuid');

    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('남의 쿠폰 거부를 번역한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'coupon_not_owned' } });

    const result = await applyCouponAction(userCouponId);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('보유하지 않은');
  });
});

describe('clearCouponAction', () => {
  it('선택 해제를 RPC로 위임하고 카트를 재검증한다', async () => {
    const result = await clearCouponAction();

    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('clear_cart_coupon');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/cart');
  });

  it('알 수 없는 실패는 일반 문구로 접는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } });

    const result = await clearCouponAction();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('다시 시도');
  });
});
