import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantAdminDrawTicketsAction } from './reward-grant-actions';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const POOL_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
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
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function grantForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values: Record<string, string> = {
    operationId: OPERATION_ID,
    profileId: PROFILE_ID,
    poolId: POOL_ID,
    quantity: '3',
    reason: '소프트런칭 초기 구매자 소급 발급',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe('grantAdminDrawTicketsAction', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    mocks.revalidatePath.mockReset();
  });

  it('비로그인은 관리자 로그인으로 보내고 RPC를 호출하지 않는다', async () => {
    mocks.adminState = { ...mocks.adminState, user: null, isStaff: false };

    await expect(grantAdminDrawTicketsAction({}, grantForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('staff가 아니면 거절하고 RPC를 호출하지 않는다', async () => {
    mocks.adminState = { ...mocks.adminState, isStaff: false };

    const state = await grantAdminDrawTicketsAction({}, grantForm());

    expect(state.errors?.form).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('사유 없이 보내면 RPC를 호출하지 않는다', async () => {
    const state = await grantAdminDrawTicketsAction({}, grantForm({ reason: '' }));

    expect(state.errors?.reason).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('멱등키·대상·수량·사유를 그대로 audited RPC에 넘긴다', async () => {
    const state = await grantAdminDrawTicketsAction({}, grantForm());

    expect(mocks.rpc).toHaveBeenCalledWith('admin_grant_draw_tickets', {
      target_operation_id: OPERATION_ID,
      target_profile_id: PROFILE_ID,
      target_pool_id: POOL_ID,
      target_quantity: 3,
      target_reason: '소프트런칭 초기 구매자 소급 발급',
    });
    expect(state.message).toContain('3');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
  });

  it('성공하면 다음 요청용 멱등키를 새로 준다', async () => {
    const state = await grantAdminDrawTicketsAction({}, grantForm());

    expect(state.nextOperationId).toBeTruthy();
    expect(state.nextOperationId).not.toBe(OPERATION_ID);
  });

  it('RPC 오류는 운영자 문구로 옮기고 내부 원문을 노출하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'reward_pool_not_ready' } });

    const state = await grantAdminDrawTicketsAction({}, grantForm());

    expect(state.errors?.form).toContain('카드풀');
    expect(state.errors?.form).not.toContain('reward_pool_not_ready');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
