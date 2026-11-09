import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), expiry: vi.fn(), policies: vi.fn(), origins: vi.fn(), carriers: vi.fn(), settings: vi.fn(), notices: vi.fn(), credits: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/operations-contacts.server', () => ({ loadAdminOperationsContacts: mocks.load }));
vi.mock('@/lib/admin/shipping-regions.server', () => ({ loadAdminShippingRegionExpiry: mocks.expiry, loadAdminShippingRegionPolicies: mocks.policies }));
vi.mock('@/lib/admin/fulfillment-origins.server', () => ({ loadGoodsFulfillmentOptions: mocks.origins }));
vi.mock('@/lib/admin/store-settings.server', () => ({ loadAdminShippingCarriers: mocks.carriers, loadAdminStoreSettings: mocks.settings }));
vi.mock('@/lib/admin/shipping-notice-templates.server', () => ({ loadActiveShippingNoticeTemplateOptions: mocks.notices }));
vi.mock('@/lib/admin/store-credits.server', () => ({ loadAdminStoreCreditPolicy: mocks.credits }));
vi.mock('@/components/admin/screens/OperationsSettingsScreen', () => ({ OperationsSettingsScreen: () => null }));
import Page from './page';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ role: 'staff' });
  mocks.load.mockResolvedValue({ contacts: [], history: [] });
  mocks.expiry.mockResolvedValue({ warnings: [] });
  mocks.policies.mockResolvedValue({ policies: [], adoptions: [] });
  mocks.origins.mockResolvedValue([]);
  mocks.carriers.mockResolvedValue([{ active: true }]);
  mocks.notices.mockResolvedValue([]);
});
it('페이지 접근 권한을 확인한 뒤 연락처를 읽는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.expiry).not.toHaveBeenCalled();
  expect(mocks.carriers).not.toHaveBeenCalled();
});
it('직원에게 조회 전용 화면을 전달한다', async () => {
  const result = await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/operations');
  expect(result.props.canEdit).toBe(false);
  expect(result.props.shippingRegionExpiry).toEqual({ warnings: [] });
  expect(mocks.credits).not.toHaveBeenCalled();
});
it('카드 상태를 읽지 못해도 화면은 열리고 그 카드만 상태를 말하지 않는다', async () => {
  mocks.carriers.mockRejectedValue(new Error('denied'));
  const result = await Page();
  expect(result.props.readiness.carriers).toBeUndefined();
  expect(result.props.readiness.regions).toEqual({ done: false, detail: '활성 정책 없음' });
});
