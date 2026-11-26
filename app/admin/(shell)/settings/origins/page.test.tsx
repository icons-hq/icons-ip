import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), origins: vi.fn(), options: vi.fn(), carriers: vi.fn(), history: vi.fn(), impact: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/fulfillment-origins.server', () => ({ loadAdminFulfillmentOrigins: mocks.origins, loadGoodsFulfillmentOptions: mocks.options }));
vi.mock('@/lib/admin/store-settings.server', () => ({ loadAdminShippingCarriers: mocks.carriers, loadAdminStoreSettingsHistory: mocks.history }));
vi.mock('@/lib/admin/shipping-impact.server', () => ({ loadOriginSaveImpact: mocks.impact }));
vi.mock('@/components/admin/screens/FulfillmentOriginsScreen', () => ({ FulfillmentOriginsScreen: () => null, GoodsOriginSummaryScreen: () => null }));
vi.mock('@/components/admin/screens/ShippingChargeGroupsPanel', () => ({ ShippingChargeGroupsPanel: () => null }));
const IMPACT = { goods: { publicGoods: 12, policyFeeGoods: 7 }, regionalFee: { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.guard.mockResolvedValue({ role: 'staff', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('staff') });
  mocks.origins.mockResolvedValue([]); mocks.options.mockResolvedValue([]); mocks.carriers.mockResolvedValue([]); mocks.history.mockResolvedValue([]); mocks.impact.mockResolvedValue(IMPACT);
});
it('checks route access before any settings read', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.origins).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled(); expect(mocks.impact).not.toHaveBeenCalled();
});
it('keeps legacy staff read-only and forwards only origin history', async () => {
  mocks.history.mockResolvedValue([{ action: 'admin.fulfillment_origin.saved', id: 'origin' }, { action: 'admin.store_settings.saved', id: 'store' }]);
  mocks.origins.mockResolvedValue([{ id: 'a', code: 'gimpo', name: '김포' }]);
  const result = await Page();
  const [origins, groups] = result.props.children;
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/origins');
  expect(origins.props.canEdit).toBe(false);
  expect(origins.props.accountId).toBe('91000000-0000-4000-8000-000000000001');
  expect(origins.props.history).toEqual([{ action: 'admin.fulfillment_origin.saved', id: 'origin' }]);
  expect(groups.props.canEdit).toBe(true); expect(groups.props.canManageRegional).toBe(false);
  /* 저장할 수 없는 사람에게는 영향을 읽어 오지 않는다. */
  expect(mocks.impact).not.toHaveBeenCalled(); expect(origins.props.impact).toBeUndefined();
});
it('?origin=을 출고지 탭으로 넘기고 모르는 값은 첫 출고지로 돌린다', async () => {
  mocks.guard.mockResolvedValue({ role: 'admin', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('admin') });
  mocks.origins.mockResolvedValue([{ id: 'a', code: 'gimpo', name: '김포' }, { id: 'b', code: 'namyangju', name: '남양주' }]);
  const tab = async (origin?: string) => (await Page({ searchParams: Promise.resolve(origin === undefined ? {} : { origin }) })).props.children[0].props.selected;
  expect(await tab('namyangju')).toBe('namyangju');
  expect(await tab('_new')).toBe('_new');
  expect(await tab('new')).toBe('gimpo');
  expect(await tab('other')).toBe('gimpo');
  expect(await tab()).toBe('gimpo');
});
it('저장 전에 알릴 영향은 지금 보는 출고지 하나만 읽어 넘기고, 출고지 추가 탭에서는 읽지 않는다 (O-1·O-2)', async () => {
  mocks.guard.mockResolvedValue({ role: 'admin', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('admin') });
  mocks.origins.mockResolvedValue([{ id: 'a', code: 'gimpo', name: '김포' }, { id: 'b', code: 'namyangju', name: '남양주' }]);
  const screen = async (origin: string) => (await Page({ searchParams: Promise.resolve({ origin }) })).props.children[0];
  expect((await screen('namyangju')).props.impact).toBe(IMPACT);
  expect(mocks.impact).toHaveBeenCalledOnce(); expect(mocks.impact).toHaveBeenCalledWith('b');
  mocks.impact.mockClear();
  expect((await screen('_new')).props.impact).toBeUndefined();
  expect(mocks.impact).not.toHaveBeenCalled();
});
it('configured deputy loads shipping options without warehouse settings or audit records', async () => {
  mocks.guard.mockResolvedValue({ role: 'staff', user: { id: '91000000-0000-4000-8000-000000000002' }, operatorAccess: configuredOperatorAccessFixture('deputy') });
  const result = await Page();
  expect(mocks.options).toHaveBeenCalledOnce(); expect(mocks.origins).not.toHaveBeenCalled();
  expect(mocks.carriers).toHaveBeenCalledOnce(); expect(mocks.history).not.toHaveBeenCalled();
  expect(result.props.children[1].props.canManageRegional).toBe(false);
  expect(mocks.impact).not.toHaveBeenCalled();
});
