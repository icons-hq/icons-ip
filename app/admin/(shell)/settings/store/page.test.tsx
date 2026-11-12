import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/admin/store-settings.server', () => ({ loadAdminStoreSettings: mocks.load }));
vi.mock('@/components/admin/screens/StoreSettingsScreen', () => ({ StoreSettingsScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); }, redirect: () => { throw new Error('redirect'); } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'deputy' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
  mocks.load.mockResolvedValue({ settings: {}, carriers: [], history: [] });
});
it('deputy may edit branding, but bank deep links stop before any settings loader', async () => {
  const page = await Page({ searchParams: Promise.resolve({ section: 'branding' }) });
  expect(page.props.canEdit).toBe(true);
  expect(page.props.sections).toContain('business');
  expect(page.props.sections).not.toContain('bank_transfer');
  mocks.load.mockClear();
  await expect(Page({ searchParams: Promise.resolve({ section: 'bank_transfer' }) })).rejects.toThrow('not_found');
  expect(mocks.load).not.toHaveBeenCalled();
});
/* TKT-019·099(사용자 결정 "아무나 가능하게"): 문의 자동 안내 탭을 여는 운영자는 매니저 권한 전환 전 호환 단계 staff도 저장한다.
   같은 화면의 다른 탭(사업자·계좌·브랜드·메뉴)의 호환 단계 admin 전용 저장은 그대로다. */
it('legacy staff may save inquiry auto replies while other sections stay admin-only before manager setup', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture('staff') });
  expect((await Page({ searchParams: Promise.resolve({ section: 'inquiry_auto_replies' }) })).props.canEdit).toBe(true);
  for (const section of ['business', 'bank_transfer', 'branding', 'navigation']) {
    expect((await Page({ searchParams: Promise.resolve({ section }) })).props.canEdit, section).toBe(false);
  }
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'deputy' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
  expect((await Page({ searchParams: Promise.resolve({ section: 'inquiry_auto_replies' }) })).props.canEdit).toBe(true);
});
it('seller information stays read-only for deputy and logistics cannot load any settings section', async () => {
  const page = await Page({ searchParams: Promise.resolve({ section: 'business' }) });
  expect(page.props.canEdit).toBe(false);
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'logistics' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
  mocks.load.mockClear();
  await expect(Page({ searchParams: Promise.resolve({ section: 'branding' }) })).rejects.toThrow('not_found');
  expect(mocks.load).not.toHaveBeenCalled();
});
