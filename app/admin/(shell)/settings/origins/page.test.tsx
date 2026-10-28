import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), origins: vi.fn(), options: vi.fn(), carriers: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/fulfillment-origins.server', () => ({ loadAdminFulfillmentOrigins: mocks.origins, loadGoodsFulfillmentOptions: mocks.options }));
vi.mock('@/lib/admin/store-settings.server', () => ({ loadAdminShippingCarriers: mocks.carriers, loadAdminStoreSettingsHistory: mocks.history }));
vi.mock('@/components/admin/screens/FulfillmentOriginsScreen', () => ({ FulfillmentOriginsScreen: () => null, GoodsOriginSummaryScreen: () => null }));
vi.mock('@/components/admin/screens/ShippingChargeGroupsPanel', () => ({ ShippingChargeGroupsPanel: () => null }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.guard.mockResolvedValue({ role: 'staff', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('staff') });
  mocks.origins.mockResolvedValue([]); mocks.options.mockResolvedValue([]); mocks.carriers.mockResolvedValue([]); mocks.history.mockResolvedValue([]);
});
it('checks route access before any settings read', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.origins).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled();
});
it('keeps legacy staff read-only and forwards only origin history', async () => {
  mocks.history.mockResolvedValue([{ action: 'admin.fulfillment_origin.saved', id: 'origin' }, { action: 'admin.store_settings.saved', id: 'store' }]);
  const result = await Page();
  const [groups, origins] = result.props.children;
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/origins');
  expect(origins.props.canEdit).toBe(false);
  expect(origins.props.accountId).toBe('91000000-0000-4000-8000-000000000001');
  expect(origins.props.history).toEqual([{ action: 'admin.fulfillment_origin.saved', id: 'origin' }]);
  expect(groups.props.canEdit).toBe(true); expect(groups.props.canManageRegional).toBe(false);
});
it('?origin=을 출고지 탭으로 넘기고 모르는 값은 첫 출고지로 돌린다', async () => {
  mocks.guard.mockResolvedValue({ role: 'admin', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('admin') });
  mocks.origins.mockResolvedValue([{ id: 'a', code: 'gimpo', name: '김포' }, { id: 'b', code: 'namyangju', name: '남양주' }]);
  const tab = async (origin?: string) => (await Page({ searchParams: Promise.resolve(origin === undefined ? {} : { origin }) })).props.children[1].props.selected;
  expect(await tab('namyangju')).toBe('namyangju');
  expect(await tab('_new')).toBe('_new');
  expect(await tab('new')).toBe('gimpo');
  expect(await tab('other')).toBe('gimpo');
  expect(await tab()).toBe('gimpo');
});
it('configured deputy loads shipping options without warehouse settings or audit records', async () => {
  mocks.guard.mockResolvedValue({ role: 'staff', user: { id: '91000000-0000-4000-8000-000000000002' }, operatorAccess: configuredOperatorAccessFixture('deputy') });
  const result = await Page();
  expect(mocks.options).toHaveBeenCalledOnce(); expect(mocks.origins).not.toHaveBeenCalled();
  expect(mocks.carriers).toHaveBeenCalledOnce(); expect(mocks.history).not.toHaveBeenCalled();
  expect(result.props.children[0].props.canManageRegional).toBe(false);
});
