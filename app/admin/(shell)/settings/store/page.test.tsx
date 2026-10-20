import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
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
it('seller information stays read-only for deputy and logistics cannot load any settings section', async () => {
  const page = await Page({ searchParams: Promise.resolve({ section: 'business' }) });
  expect(page.props.canEdit).toBe(false);
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'logistics' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
  mocks.load.mockClear();
  await expect(Page({ searchParams: Promise.resolve({ section: 'branding' }) })).rejects.toThrow('not_found');
  expect(mocks.load).not.toHaveBeenCalled();
});
