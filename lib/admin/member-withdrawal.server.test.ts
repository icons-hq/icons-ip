import { beforeEach, describe, expect, it, vi } from 'vitest';
import { banWithdrawnMemberSignin, getMemberWithdrawalStatus } from './member-withdrawal.server';

const { rpc, serviceConfig, createServiceClient } = vi.hoisted(() => ({
  rpc: vi.fn(), serviceConfig: vi.fn(), createServiceClient: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/lib/supabase/service', () => ({ getServiceRoleConfig: serviceConfig, createServiceClient }));

const MEMBER = '00000000-0000-4000-8000-000000000301';

beforeEach(() => {
  rpc.mockReset();
  serviceConfig.mockReset();
  createServiceClient.mockReset();
});

describe('탈퇴 처리 상태 읽기', () => {
  it('검증한 상태만 돌려주고 오류·모양 불일치는 null이다', async () => {
    const status = { processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null };
    rpc.mockResolvedValue({ data: status, error: null });
    await expect(getMemberWithdrawalStatus(MEMBER)).resolves.toEqual(status);
    expect(rpc).toHaveBeenCalledWith('admin_member_withdrawal_status', { target_profile_id: MEMBER });
    rpc.mockResolvedValue({ data: { processed: 'yes' }, error: null });
    await expect(getMemberWithdrawalStatus(MEMBER)).resolves.toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    await expect(getMemberWithdrawalStatus(MEMBER)).resolves.toBeNull();
  });
});

describe('재로그인 차단(Auth 관리 API ban)', () => {
  it('100년 ban을 걸고 성공 여부만 돌려준다', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(banWithdrawnMemberSignin(MEMBER, { auth: { admin: { updateUserById } } } as never)).resolves.toBe(true);
    expect(updateUserById).toHaveBeenCalledWith(MEMBER, { ban_duration: '876000h' });

    updateUserById.mockResolvedValue({ data: null, error: { message: 'User not found' } });
    await expect(banWithdrawnMemberSignin(MEMBER, { auth: { admin: { updateUserById } } } as never)).resolves.toBe(false);
    updateUserById.mockRejectedValue(new Error('network'));
    await expect(banWithdrawnMemberSignin(MEMBER, { auth: { admin: { updateUserById } } } as never)).resolves.toBe(false);
  });

  it('service role이 설정되지 않은 배포에서는 부르지 않고 실패로 돌려준다', async () => {
    serviceConfig.mockReturnValue({ url: undefined, key: undefined, isConfigured: false });
    await expect(banWithdrawnMemberSignin(MEMBER)).resolves.toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
