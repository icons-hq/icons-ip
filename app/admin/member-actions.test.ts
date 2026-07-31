import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadAdminMemberDetailAction,
  searchAdminMembersAction,
  suspendAdminMemberAction,
  unsuspendAdminMemberAction,
} from './member-actions';

const profileId = '11111111-1111-4111-8111-111111111111';
const members = [{
  id: profileId,
  nickname: '팬일호',
  maskedEmail: 'f***@icons.gg',
  role: 'user' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
  suspendedAt: null,
}];

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
  getDetail: vi.fn(),
  getSummaries: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/admin/members.server', () => ({
  getAdminMemberDetail: mocks.getDetail,
  getAdminMemberSummaries: mocks.getSummaries,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

function form(entries: Record<string, string> = {}) {
  const data = new FormData();
  data.set('profileId', profileId);
  data.set('reason', '  반복적인 운영 방해  ');
  data.set('query', '  fan  ');
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('admin member actions', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.getDetail.mockReset();
    mocks.getSummaries.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockReset();
    mocks.getSummaries.mockResolvedValue(members);
    mocks.getDetail.mockResolvedValue({ ...members[0], email: 'fan@example.test' });
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
  });

  it('검색과 상세는 POST 입력을 검증하고 staff loader만 호출한다', async () => {
    await expect(searchAdminMembersAction({ members: [], query: '' }, form())).resolves.toEqual({
      members,
      query: 'fan',
    });
    expect(mocks.getSummaries).toHaveBeenCalledWith('fan');

    await expect(loadAdminMemberDetailAction({ member: null }, form())).resolves.toEqual({
      member: expect.objectContaining({ id: profileId, email: 'fan@example.test' }),
    });
    expect(mocks.getDetail).toHaveBeenCalledWith(profileId);
  });

  it('비staff는 모든 RPC·loader 전에 차단한다', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(searchAdminMembersAction({ members: [], query: '' }, form())).resolves.toEqual({
      members: [],
      query: '',
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    await expect(suspendAdminMemberAction({}, form())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.getSummaries).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정지·해제는 정규화된 최소 입력만 audited RPC에 넘기고 admin을 재검증한다', async () => {
    await expect(suspendAdminMemberAction({}, form())).resolves.toEqual({ message: '회원을 정지했습니다.' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_suspend_user', {
      target_profile_id: profileId,
      target_reason: '반복적인 운영 방해',
    });

    await expect(unsuspendAdminMemberAction({}, form())).resolves.toEqual({ message: '회원 정지를 해제했습니다.' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_unsuspend_user', { target_profile_id: profileId });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/admin'], ['/admin']]);
  });

  it('DB 오류 원문을 숨기고 stale/권한 오류를 안전한 문구로 매핑한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'cannot_suspend_admin: private detail' } });
    await expect(suspendAdminMemberAction({}, form())).resolves.toEqual({
      errors: { form: '본인 또는 admin 계정은 정지할 수 없습니다.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('상세 로드 실패 시 이전 회원 PII와 제재 대상을 폐기한다', async () => {
    mocks.getDetail.mockRejectedValue(new Error('private db detail'));

    await expect(loadAdminMemberDetailAction({
      member: {
        id: profileId,
        nickname: '이전 회원',
        email: 'previous@example.test',
        role: 'user',
        createdAt: '2026-07-01T00:00:00.000Z',
        consents: { terms: true, privacy: true, marketing: false },
        suspendedAt: null,
        suspensionReason: null,
        goodsOrderCount: 0,
        ticketOrderCount: 0,
        submittedReportCount: 0,
        receivedReportCount: 0,
      },
    }, form())).resolves.toEqual({
      member: null,
      errors: { form: '회원 상세를 불러오지 못했습니다. 다시 시도해주세요.' },
    });
  });

  it('검색 실패 시 이전 회원 목록을 폐기한다', async () => {
    mocks.getSummaries.mockRejectedValue(new Error('private db detail'));

    await expect(searchAdminMembersAction({ members, query: '' }, form())).resolves.toEqual({
      members: [],
      query: 'fan',
      errors: { form: '회원을 검색하지 못했습니다. 다시 시도해주세요.' },
    });
  });
});
