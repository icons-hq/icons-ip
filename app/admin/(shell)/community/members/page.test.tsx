const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KakaoUnlinkQueueNotice } from '@/components/admin/screens/KakaoUnlinkWithdrawalQueueScreen';
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
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  membersSection: vi.fn(() => null),
  members: vi.fn(),
  moderation: vi.fn(async () => ({ reports: [] })),
  profiles: vi.fn(async () => []),
  note: vi.fn(),
  kakaoQueue: vi.fn(async (): Promise<unknown[] | null> => []),
}));

vi.mock('@/lib/admin/pii-access-log.server', () => ({ notePiiAccess: mocks.note }));
vi.mock('@/lib/admin/kakao-unlink-withdrawal.server', () => ({ loadKakaoUnlinkWithdrawalQueue: mocks.kakaoQueue }));

/* 화면은 카카오 탈퇴 검토 대기 안내와 회원 관리 섹션을 세로로 둔다. */
function childOf(screen: ReactElement<{ children?: unknown }>, type: unknown) {
  /* key를 그대로 보려고 Children.toArray(키를 바꾼다) 대신 원래 배열을 읽는다. */
  return ([] as unknown[]).concat(screen.props.children).find((child) => isValidElement(child) && child.type === type) as ReactElement<Record<string, unknown>>;
}

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
      isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
    };
    mocks.membersSection.mockClear();
    mocks.moderation.mockClear();
    mocks.profiles.mockClear();
    mocks.members.mockReset();
    mocks.members.mockImplementation(async () => [{ ...suspended }]);
    mocks.kakaoQueue.mockReset();
    mocks.kakaoQueue.mockImplementation(async () => []);
    mocks.note.mockClear();
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
    expect(childOf(screen, mocks.membersSection).props).toMatchObject({
      actor: { id: '11111111-1111-4111-8111-111111111111', role: 'staff' },
      initialMembers: [expect.objectContaining({ maskedEmail: 'f***@icons.gg' })],
    });
    expect(mocks.note).toHaveBeenLastCalledWith({ actorId: '11111111-1111-4111-8111-111111111111', action: 'search', surface: 'member.search',
      path: '/admin/community/members', subjectKind: 'member', subjectIds: [suspended.id], subjectCount: 1, detail: { queried: false } });
  });

  /* key가 그대로면 정지 처리 후 revalidate가 와도 화면은 옛 목록을 계속 쓴다. */
  it('정지 상태가 바뀌면 화면 key가 바뀐다', async () => {
    const before = await AdminCommunityMembersPage();

    mocks.members.mockImplementation(async () => [
      { ...suspended, suspendedAt: '2026-07-16T00:00:00.000Z' },
    ]);
    const after = await AdminCommunityMembersPage();

    expect(childOf(before, mocks.membersSection).key).toBe(JSON.stringify([[suspended.id, 'user', null]]));
    expect(childOf(after, mocks.membersSection).key).toBe(JSON.stringify([[suspended.id, 'user', '2026-07-16T00:00:00.000Z']]));
  });

  it('카카오 연결 해제 탈퇴 검토 대기는 건수만 안내하고(목록을 못 읽으면 0) 접속기록은 회원 검색 하나뿐이다', async () => {
    mocks.kakaoQueue.mockImplementation(async () => [{ userId: suspended.id }, { userId: '22222222-2222-4222-8222-222222222222' }]);
    expect(childOf(await AdminCommunityMembersPage(), KakaoUnlinkQueueNotice).props).toEqual({ count: 2 });
    expect(mocks.note).toHaveBeenCalledTimes(1);
    mocks.kakaoQueue.mockImplementation(async () => null);
    expect(childOf(await AdminCommunityMembersPage(), KakaoUnlinkQueueNotice).props).toEqual({ count: 0 });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCommunityMembersPage();

    expect(mocks.moderation).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
});
