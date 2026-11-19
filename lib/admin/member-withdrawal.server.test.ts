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
  const PREFIX = `${MEMBER}/profile/`;
  /* 접두 아래 파일 이름 목록을 회차마다 돌려주는 Storage 흉내. */
  const storage = (rounds: string[][], removeError: unknown = null, listError: unknown = null) => {
    const list = vi.fn();
    for (const names of rounds) list.mockResolvedValueOnce({ data: names.map((name) => ({ name, id: `id-${name}` })), error: listError });
    list.mockResolvedValue({ data: [], error: listError });
    const remove = vi.fn().mockResolvedValue({ error: removeError });
    return { list, remove, service: { storage: { from: vi.fn(() => ({ list, remove })) } } };
  };
  const prefixRpc = (prefix: string | null) => rpc.mockImplementation(async (name: string) => (
    name === 'admin_member_withdrawal_avatar_prefix' ? { data: prefix, error: null } : { data: {}, error: null }));

  it('접두 아래 파일을 전부 지운 뒤 DB 확인을 남긴다(이전 파일·후보 포함)', async () => {
    const { list, remove, service } = storage([['a.png', 'c.webp']]);
    prefixRpc(PREFIX);
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, service as never)).resolves.toBe(true);
    expect(service.storage.from).toHaveBeenCalledWith('user-uploads');
    expect(list).toHaveBeenCalledWith(`${MEMBER}/profile`, { limit: 100 });
    expect(remove).toHaveBeenCalledWith([`${PREFIX}a.png`, `${PREFIX}c.webp`]);
    expect(rpc).toHaveBeenLastCalledWith('admin_confirm_member_withdrawal_avatar_erased', { target_profile_id: MEMBER });
  });

  it('한 쪽에 다 담기지 않으면 한 번 더 목록을 읽어 지운다', async () => {
    const first = Array.from({ length: 100 }, (_, index) => `f${index}.png`);
    const { remove, service } = storage([first, ['last.png']]);
    prefixRpc(PREFIX);
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, service as never)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('지울 사진이 없으면 Storage도 확인 RPC도 부르지 않고 성공이다', async () => {
    const { list, service } = storage([]);
    prefixRpc(null);
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, service as never)).resolves.toBe(true);
    expect(list).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('조회·목록·삭제·DB 확인 중 하나라도 실패하면 false다. 남의 접두는 지우지 않는다', async () => {
    prefixRpc(PREFIX);
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, storage([['a.png']], { message: 'down' }).service as never)).resolves.toBe(false);
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, storage([], null, { message: 'down' }).service as never)).resolves.toBe(false);

    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => (name === 'admin_member_withdrawal_avatar_prefix'
      ? { data: PREFIX, error: null } : { data: null, error: { message: 'member_withdrawal_avatar_not_erased' } }));
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, storage([['a.png']]).service as never)).resolves.toBe(false);

    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, storage([['a.png']]).service as never)).resolves.toBe(false);

    const other = storage([['x.png']]);
    prefixRpc('00000000-0000-4000-8000-000000000999/profile/');
    await expect(eraseWithdrawnMemberAvatar({ rpc } as never, MEMBER, other.service as never)).resolves.toBe(false);
    expect(other.remove).not.toHaveBeenCalled();
  });
});
