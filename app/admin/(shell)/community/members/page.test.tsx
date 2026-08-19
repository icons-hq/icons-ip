import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCommunityMembersPage from './page';

const suspended = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  nickname: '팬',
  maskedEmail: 'f***@icons.gg',
  role: 'user',
  createdAt: '2026-07-01T00:00:00.000Z',
  suspendedAt: null as string | null,
};

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  membersSection: vi.fn(() => null),
  members: vi.fn(),
  moderation: vi.fn(async () => ({ reports: [] })),
  profiles: vi.fn(async () => []),
}));

vi.mock('@/components/admin/sections/Members', () => ({ MembersSection: mocks.membersSection }));
vi.mock('@/lib/admin/members.server', () => ({ getAdminMemberSummaries: mocks.members }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: mocks.moderation }));
vi.mock('@/lib/admin/roles.server', () => ({ getAdminProfileRecords: mocks.profiles }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminCommunityMembersPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.membersSection.mockClear();
    mocks.moderation.mockClear();
    mocks.profiles.mockClear();
    mocks.members.mockReset();
    mocks.members.mockImplementation(async () => [{ ...suspended }]);
  });

  it('일반 사용자에게는 회원 목록을 읽기 전에 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminCommunityMembersPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it('빈 질의로 목록을 불러 세션 주체와 마스킹 목록을 전달한다', async () => {
    const screen = await AdminCommunityMembersPage();

    expect(mocks.members).toHaveBeenCalledWith('');
    expect(screen.type).toBe(mocks.membersSection);
    expect(screen.props).toMatchObject({
      actor: { id: '11111111-1111-4111-8111-111111111111', role: 'staff' },
      initialMembers: [expect.objectContaining({ maskedEmail: 'f***@icons.gg' })],
    });
  });

  /* key가 그대로면 정지 처리 후 revalidate가 와도 화면은 옛 목록을 계속 쓴다. */
  it('정지 상태가 바뀌면 화면 key가 바뀐다', async () => {
    const before = await AdminCommunityMembersPage();

    mocks.members.mockImplementation(async () => [
      { ...suspended, suspendedAt: '2026-07-16T00:00:00.000Z' },
    ]);
    const after = await AdminCommunityMembersPage();

    expect(before.key).toBe(JSON.stringify([[suspended.id, 'user', null]]));
    expect(after.key).toBe(JSON.stringify([[suspended.id, 'user', '2026-07-16T00:00:00.000Z']]));
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCommunityMembersPage();

    expect(mocks.moderation).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
});
