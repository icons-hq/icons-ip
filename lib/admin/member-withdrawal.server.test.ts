import { beforeEach, describe, expect, it, vi } from 'vitest';
import { banWithdrawnMemberSignin, eraseWithdrawnMemberAvatar, getMemberWithdrawalStatus } from './member-withdrawal.server';

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

describe('프로필 사진 파일 삭제', () => {
  const PATH = `${MEMBER}/profile/aaaaaaaa-0000-4000-8000-000000000003.png`;
  const storage = (error: unknown = null) => {
    const remove = vi.fn().mockResolvedValue({ error });
    return { remove, service: { storage: { from: vi.fn(() => ({ remove })) } } };
  };

  it('DB가 준 경로의 객체를 지운 뒤 DB 확인을 남긴다', async () => {
    const { remove, service } = storage();
    rpc.mockImplementation(async (name: string) => (name === 'admin_member_withdrawal_avatar_path' ? { data: PATH, error: null } : { data: {}, error: null }));
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, service)).resolves.toBe(true);
    expect(service.storage.from).toHaveBeenCalledWith('user-uploads');
    expect(remove).toHaveBeenCalledWith([PATH]);
    expect(rpc).toHaveBeenLastCalledWith('admin_confirm_member_withdrawal_avatar_erased', { target_profile_id: MEMBER });
  });

  it('지울 사진이 없으면 Storage도 확인 RPC도 부르지 않고 성공이다', async () => {
    const { remove, service } = storage();
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, service)).resolves.toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('경로 조회·Storage 삭제·DB 확인 중 하나라도 실패하면 false다. 남의 경로는 지우지 않는다', async () => {
    const failing = storage({ message: 'down' });
    rpc.mockResolvedValue({ data: PATH, error: null });
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, failing.service)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);

    const ok = storage();
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => (name === 'admin_member_withdrawal_avatar_path'
      ? { data: PATH, error: null } : { data: null, error: { message: 'member_withdrawal_avatar_not_erased' } }));
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, ok.service)).resolves.toBe(false);

    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, ok.service)).resolves.toBe(false);

    const other = storage();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: '00000000-0000-4000-8000-000000000999/profile/x.png', error: null });
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, other.service)).resolves.toBe(false);
    expect(other.remove).not.toHaveBeenCalled();
  });
});
