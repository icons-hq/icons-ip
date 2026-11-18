import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ loadPiiAccessLog: mocks.load, recordPiiAccess: mocks.record }));
vi.mock('@/components/admin/screens/PiiAccessLogScreen', () => ({ PiiAccessLogScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const MEMBER = 'a9000000-0000-4000-8000-000000000001';
const staff = (operatorAccess: ReturnType<typeof configuredOperatorAccessFixture>, role = 'staff') => ({ isConfigured: true, user: { id: 'inspector' }, role, isStaff: true, operatorAccess });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ from: '2026-11-01', to: '2026-11-10', page: 2, pageSize: 50, total: 60, summary: {}, items: [], actors: [] });
  mocks.record.mockResolvedValue('9');
});

/* CUS-084: 점검 화면은 매니저 관리 권한으로만 열고, 이 화면의 열람도 접속기록으로 남아야 연다. */
it('통합·주매니저와 호환 단계 admin은 조건대로 읽고, 화면 열람을 대상 원문 없이 기록한다', async () => {
  for (const auth of [staff(configuredOperatorAccessFixture('owner'), 'admin'), staff(configuredOperatorAccessFixture('primary')), staff(legacyOperatorAccessFixture('admin'), 'admin')]) {
    mocks.auth.mockResolvedValue(auth);
    const page = await Page({ searchParams: Promise.resolve({ from: '2026-11-01', to: '2026-11-10', subject: MEMBER, flag: 'burst', page: '2' }) });
    expect(page.props.filters).toMatchObject({ from: '2026-11-01', to: '2026-11-10', subject: MEMBER, flag: 'burst', page: 2 });
  }
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(mocks.record).toHaveBeenLastCalledWith({ actorId: 'inspector', action: 'view', surface: 'access_log', path: '/admin/settings/access-log', subjectKind: 'none',
    detail: { from: '2026-11-01', to: '2026-11-10', page: 2, actorFiltered: false, subjectFiltered: true, action: null, surface: null, flag: 'burst' } });
  expect(JSON.stringify(mocks.record.mock.calls)).not.toContain(MEMBER);
});

it('기록을 남기지 못하면 화면을 열지 않는다', async () => {
  mocks.auth.mockResolvedValue(staff(configuredOperatorAccessFixture('owner'), 'admin'));
  mocks.record.mockRejectedValueOnce(new Error('개인정보 접속기록을 남기지 못해 요청을 처리하지 않았습니다.'));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('개인정보 접속기록을 남기지 못해');
});

it('상담·물류 역할과 호환 단계 staff는 점검 기록에 닿지 않는다', async () => {
  for (const auth of [staff(configuredOperatorAccessFixture('deputy')), staff(configuredOperatorAccessFixture('agency')), staff(configuredOperatorAccessFixture('influencer')),
    staff(configuredOperatorAccessFixture('logistics')), staff(legacyOperatorAccessFixture('staff'))]) {
    mocks.auth.mockResolvedValue(auth);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('not_found');
  }
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
});
