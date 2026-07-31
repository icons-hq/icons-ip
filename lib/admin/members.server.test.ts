import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminMemberDetail, getAdminMemberSummaries } from './members.server';

const profileId = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  auth: {
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
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/admin/members', async () => await import('./members'));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

describe('admin member loaders', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.rpc.mockReset();
  });

  it('목록에는 DB가 마스킹한 이메일과 최소 필드만 반환한다', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{
        profile_id: profileId,
        nickname: '팬일호',
        masked_email: 'f***@icons.gg',
        role: 'user',
        created_at: '2026-07-01T00:00:00.000Z',
        suspended_at: null,
      }],
      error: null,
    });

    const result = await getAdminMemberSummaries('fan');
    expect(result).toEqual([{
      id: profileId,
      nickname: '팬일호',
      maskedEmail: 'f***@icons.gg',
      role: 'user',
      createdAt: '2026-07-01T00:00:00.000Z',
      suspendedAt: null,
    }]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_members', { target_query: 'fan' });
    expect(result[0]).not.toHaveProperty('suspensionReason');
  });

  it('명시적으로 연 상세에만 전체 이메일·현재 동의·내부 사유·집계를 반환한다', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{
        profile_id: profileId,
        nickname: '팬일호',
        email: 'fan@example.test',
        role: 'user',
        created_at: '2026-07-01T00:00:00.000Z',
        consents: { terms: true, privacy: true, marketing: false },
        suspended_at: '2026-07-17T01:00:00.000Z',
        suspension_reason: '내부 사유',
        goods_order_count: '2',
        ticket_order_count: '3',
        submitted_report_count: '4',
        received_report_count: '5',
      }],
      error: null,
    });

    await expect(getAdminMemberDetail(profileId)).resolves.toMatchObject({
      id: profileId,
      email: 'fan@example.test',
      consents: { terms: true, privacy: true, marketing: false },
      suspensionReason: '내부 사유',
      goodsOrderCount: 2,
      ticketOrderCount: 3,
      submittedReportCount: 4,
      receivedReportCount: 5,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_get_member_detail', { target_profile_id: profileId });
  });

  it('비로그인과 비staff는 PII RPC 전에 차단한다', async () => {
    mocks.auth = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(getAdminMemberSummaries()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin');

    mocks.auth = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };
    await expect(getAdminMemberDetail(profileId)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB 오류 원문을 브라우저 경계로 전달하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } });
    await expect(getAdminMemberSummaries()).rejects.toThrow('Failed to load admin members');
    await expect(getAdminMemberDetail(profileId)).rejects.toThrow('Failed to load admin member detail');
  });
});
