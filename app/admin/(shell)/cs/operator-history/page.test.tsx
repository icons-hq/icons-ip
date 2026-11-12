import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/admin/inquiry-operator-history.server', () => ({ loadInquiryOperatorHistory: mocks.load }));
vi.mock('@/components/admin/screens/InquiryOperatorHistoryScreen', () => ({ InquiryOperatorHistoryScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const OPERATOR = 'a1050000-0000-4000-8000-000000000004';
const staff = (operatorAccess: ReturnType<typeof configuredOperatorAccessFixture>, role = 'staff') => ({ isConfigured: true, user: { id: 'operator' }, role, isStaff: true, operatorAccess });
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue({ from: '2026-10-12', to: '2026-11-12', operators: [], detail: null }); });

/* 1014-105: 운영자별 처리 이력은 매니저 관리 권한으로만 연다. 권한이 없으면 로더(=열람 감사)에 닿기 전에 막는다. */
it('owner, primary and legacy admin open the screen with the requested period and operator', async () => {
  for (const auth of [staff(configuredOperatorAccessFixture('owner'), 'admin'), staff(configuredOperatorAccessFixture('primary')), staff(legacyOperatorAccessFixture('admin'), 'admin')]) {
    mocks.auth.mockResolvedValue(auth);
    const page = await Page({ searchParams: Promise.resolve({ from: '2026-11-01', to: '2026-11-10', operator: OPERATOR, page: '2' }) });
    expect(page.props.filters).toMatchObject({ from: '2026-11-01', to: '2026-11-10', operator: OPERATOR, page: 2 });
  }
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-01', to: '2026-11-10', operator: OPERATOR, page: 2 }));
});
it('consultation roles and legacy staff never reach the audited loader', async () => {
  for (const auth of [staff(configuredOperatorAccessFixture('deputy')), staff(configuredOperatorAccessFixture('agency')), staff(configuredOperatorAccessFixture('influencer')),
    staff(configuredOperatorAccessFixture('logistics')), staff(legacyOperatorAccessFixture('staff'))]) {
    mocks.auth.mockResolvedValue(auth);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('not_found');
  }
  expect(mocks.load).not.toHaveBeenCalled();
});
