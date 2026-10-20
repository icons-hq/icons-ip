import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCommunityRolesPage from './page';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import type { OperatorAccess } from '@/lib/admin/access';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'admin@icons.gg' },
    role: 'admin',
    isStaff: true,
    operatorAccess: undefined,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
    operatorAccess?: OperatorAccess;
  },
  rolesSection: vi.fn(() => null),
  profiles: vi.fn(async () => [{ id: 'profile-1' }]),
  members: vi.fn(async () => []),
  moderation: vi.fn(async () => ({ reports: [] })),
}));

vi.mock('@/components/admin/screens/OperatorDirectoryScreen', () => ({ OperatorDirectoryScreen: mocks.rolesSection }));
vi.mock('@/lib/admin/operator-directory.server', () => ({ loadOperatorDirectory: mocks.profiles }));
vi.mock('@/lib/admin/members.server', () => ({ getAdminMemberSummaries: mocks.members }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: mocks.moderation }));
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

describe('AdminCommunityRolesPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'admin@icons.gg' },
      role: 'admin',
      isStaff: true,
      operatorAccess: legacyOperatorAccessFixture(),
    };
    mocks.rolesSection.mockClear();
    mocks.profiles.mockClear();
    mocks.members.mockClear();
    mocks.moderation.mockClear();
  });

  /*
   * 예전에는 Admin.tsx가 admin일 때만 역할 섹션을 렌더해서 감췄다. 라우트가
   * 생긴 뒤로는 staff가 URL로 바로 들어올 수 있어 게이트가 유일한 방어선이다.
   */
  it('staff에게는 역할 화면을 404로 감추고 프로필을 읽지 않는다', async () => {
    mocks.authState.role = 'staff';
    mocks.authState.operatorAccess = legacyOperatorAccessFixture('staff');

    await expect(AdminCommunityRolesPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.profiles).not.toHaveBeenCalled();
  });

  it('일반 사용자에게도 역할 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminCommunityRolesPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.profiles).not.toHaveBeenCalled();
  });

  it('로그인 전에는 역할 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminCommunityRolesPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcommunity%2Froles',
    );
    expect(mocks.profiles).not.toHaveBeenCalled();
  });

  it('admin에게 프로필 목록과 자기 id를 전달한다', async () => {
    const screen = await AdminCommunityRolesPage();

    expect(screen.type).toBe(mocks.rolesSection);
    expect(screen.props).toEqual({
      adminId: '11111111-1111-4111-8111-111111111111',
      data: [{ id: 'profile-1' }],
      invitations: undefined,
    });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCommunityRolesPage();

    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.moderation).not.toHaveBeenCalled();
  });
  it('raw staff인 계정 주매니저도 매니저 관리에 접근한다', async () => {
    mocks.authState.role = 'staff';
    mocks.authState.operatorAccess = configuredOperatorAccessFixture('primary');
    await expect(AdminCommunityRolesPage()).resolves.toHaveProperty('type', mocks.rolesSection);
  });
  it('raw admin이어도 부매니저로 배정되면 목록을 읽지 않는다', async () => {
    mocks.authState.operatorAccess = configuredOperatorAccessFixture('deputy');
    await expect(AdminCommunityRolesPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
});
