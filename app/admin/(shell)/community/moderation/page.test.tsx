import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCommunityModerationPage from './page';

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
  moderationSection: vi.fn(() => null),
  moderation: vi.fn(async () => ({ reports: [{ id: 'report-1' }] })),
  insights: vi.fn(async () => ({})),
  members: vi.fn(async () => []),
  profiles: vi.fn(async () => []),
}));

vi.mock('@/components/admin/sections/Moderation', () => ({ ModerationSection: mocks.moderationSection }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: mocks.moderation }));
vi.mock('@/lib/admin/insights.server', () => ({ getAdminInsights: mocks.insights }));
vi.mock('@/lib/admin/members.server', () => ({ getAdminMemberSummaries: mocks.members }));
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

describe('AdminCommunityModerationPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.moderationSection.mockClear();
    mocks.moderation.mockClear();
    mocks.insights.mockClear();
    mocks.members.mockClear();
    mocks.profiles.mockClear();
  });

  it('로그인 전에는 모더레이션 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminCommunityModerationPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcommunity%2Fmoderation',
    );
    expect(mocks.moderation).not.toHaveBeenCalled();
  });

  it('staff에게 신고 목록만 전달한다', async () => {
    const screen = await AdminCommunityModerationPage();

    expect(screen.type).toBe(mocks.moderationSection);
    expect(screen.props).toEqual({ reports: [{ id: 'report-1' }] });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCommunityModerationPage();

    expect(mocks.insights).not.toHaveBeenCalled();
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
});
