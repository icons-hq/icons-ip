import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMemberModerationContext } from './member-moderation.server';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc }) }));
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => rpc.mockReset());
describe('member moderation context', () => {
  it('현재 DB의 대상별 판단만 전달하고 불필요한 정보는 버린다', async () => {
    rpc.mockResolvedValue({ data: [{ profileId: id, managerRole: 'deputy', canModerate: true, loyaltyGrade: 'gold', email: 'private@example.test' }], error: null });
    await expect(getMemberModerationContext(id)).resolves.toEqual({ managerRole: 'deputy', canModerate: true, loyaltyGrade: 'gold' });
    expect(rpc).toHaveBeenCalledWith('admin_member_moderation_context', { p_profile_ids: [id] });
  });
  it('삭제되거나 접근할 수 없는 대상은 제재 버튼을 열지 않는다', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getMemberModerationContext(id)).resolves.toEqual({ managerRole: null, canModerate: false, loyaltyGrade: null });
  });
  it.each([
    { data: null, error: { message: 'private failure' } },
    { data: [{ profileId: 'other', managerRole: null, canModerate: true }], error: null },
    { data: [{ profileId: id, managerRole: 'unknown', canModerate: true }], error: null },
    { data: [{ profileId: id, managerRole: null, canModerate: 'true' }], error: null },
    { data: [{ profileId: id, managerRole: null, canModerate: true }, { profileId: id, managerRole: null, canModerate: true }], error: null },
  ])('실패하거나 섞인 응답을 권한 허용으로 해석하지 않는다', async (response) => {
    rpc.mockResolvedValue(response);
    await expect(getMemberModerationContext(id)).rejects.toThrow('회원 제재 권한을 확인하지 못했습니다.');
  });
});
