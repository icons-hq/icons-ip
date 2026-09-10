import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAdminCouponAction } from './coupon-actions';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff' as 'staff' | 'user' | 'admin' | null,
    isStaff: true,
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) throw error;
  },
}));

function form(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  for (const [key, value] of Object.entries({
    previousCode: '',
    code: 'AUTUMN-3000',
    name: '가을 프로모션',
    discountType: 'fixed',
    discountValue: '3000',
    maxDiscountAmount: '',
    minSubtotal: '20000',
    startsAt: '2026-09-01T00:00',
    endsAt: '2026-09-30T23:59',
    issueLimit: '',
    status: 'active',
    gradeBenefit: '',
    ...overrides,
  })) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.revalidatePath.mockReset();
});

describe('upsertAdminCouponAction', () => {
  it('preserves the submission when the server request throws unexpectedly', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network unavailable'));
    const result = await upsertAdminCouponAction({}, form({ name: '연결 실패에도 유지' }));
    expect(result).toMatchObject({
      errors: { form: expect.any(String) },
      values: { name: '연결 실패에도 유지', code: 'AUTUMN-3000' },
      attempt: 1,
    });
  });
  it('returns the submitted form values with validation errors', async () => {
    const state = await upsertAdminCouponAction({}, form({
      code: 'bad code',
      name: '입력한 쿠폰 이름',
      discountValue: '0',
    }));

    expect(state.errors?.code).toBeTruthy();
    expect(state.errors?.discountValue).toBeTruthy();
    expect(state.values).toMatchObject({
      code: 'bad code',
      name: '입력한 쿠폰 이름',
      discountValue: '0',
      startsAt: '2026-09-01T00:00',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps a server-failed submission available for a corrected retry', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'temporary database failure' } })
      .mockResolvedValueOnce({ data: null, error: null });

    const first = await upsertAdminCouponAction({}, form({ name: '첫 제출 이름' }));
    expect(first.errors?.form).toContain('저장하지 못했습니다');
    expect(first.values).toMatchObject({ name: '첫 제출 이름', code: 'AUTUMN-3000' });

    const retry = await upsertAdminCouponAction(first, form({ name: '수정한 이름' }));
    expect(retry.message).toContain('AUTUMN-3000');
    expect(retry.values).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/coupons');
  });

  it('does not call the write RPC for a non-staff session', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await upsertAdminCouponAction({}, form());

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
