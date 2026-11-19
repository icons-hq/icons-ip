import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), note: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/admin/kakao-unlink-withdrawal.server', () => ({ loadKakaoUnlinkWithdrawalQueue: mocks.load }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ notePiiAccess: mocks.note }));
vi.mock('@/components/admin/screens/KakaoUnlinkWithdrawalQueueScreen', () => ({ KakaoUnlinkWithdrawalQueueScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const MEMBER = 'a11c0000-0000-4000-8000-000000000003';
const staff = (operatorAccess: ReturnType<typeof configuredOperatorAccessFixture>, role = 'staff') => ({ isConfigured: true, user: { id: 'operator' }, role, isStaff: true, operatorAccess });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue([{ userId: MEMBER, nickname: '카카오', maskedEmail: 'k***@example.test', reason: 'ACCOUNT_DELETE',
    eventAt: '2026-11-19T01:00:00Z', accountClosed: true, suspended: false }]);
});

it('회원 관리 권한으로 목록을 열고 보인 회원을 회원 검색처럼 접속기록에 남긴다(가린 이메일·사유는 싣지 않는다)', async () => {
  mocks.auth.mockResolvedValue(staff(configuredOperatorAccessFixture('primary')));
  const page = await Page();
  expect(page.props.entries).toHaveLength(1);
  expect(mocks.note).toHaveBeenCalledWith({ actorId: 'operator', action: 'view', surface: 'member.kakao_unlink_queue',
    path: '/admin/community/members/kakao-unlinks', subjectKind: 'member', subjectIds: [MEMBER], subjectCount: 1 });
  expect(JSON.stringify(mocks.note.mock.calls)).not.toContain('k***');
});

it('보인 회원이 없거나 목록을 읽지 못하면 접속기록을 남기지 않는다', async () => {
  mocks.auth.mockResolvedValue(staff(legacyOperatorAccessFixture('admin'), 'admin'));
  for (const entries of [[], null]) {
    mocks.load.mockResolvedValueOnce(entries);
    expect((await Page()).props.entries).toEqual(entries);
  }
  expect(mocks.note).not.toHaveBeenCalled();
});

it('회원 관리 권한이 없는 역할은 목록에 닿지 않는다', async () => {
  for (const auth of [staff(configuredOperatorAccessFixture('deputy')), staff(configuredOperatorAccessFixture('logistics'))]) {
    mocks.auth.mockResolvedValue(auth);
    await expect(Page()).rejects.toThrow('not_found');
  }
  expect(mocks.load).not.toHaveBeenCalled();
});
