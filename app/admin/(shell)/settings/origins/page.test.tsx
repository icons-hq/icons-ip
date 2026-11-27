import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), origins: vi.fn(), options: vi.fn(), carriers: vi.fn(), history: vi.fn(), impact: vi.fn(), regions: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/fulfillment-origins.server', () => ({ loadAdminFulfillmentOrigins: mocks.origins, loadGoodsFulfillmentOptions: mocks.options }));
vi.mock('@/lib/admin/store-settings.server', () => ({ loadAdminShippingCarriers: mocks.carriers, loadAdminStoreSettingsHistory: mocks.history }));
vi.mock('@/lib/admin/shipping-impact.server', () => ({ loadOriginSaveImpact: mocks.impact }));
vi.mock('@/lib/admin/shipping-regions.server', () => ({ loadAdminShippingRegionPolicies: mocks.regions }));
vi.mock('@/components/admin/screens/FulfillmentOriginsScreen', () => ({ FulfillmentOriginsScreen: () => null, GoodsOriginSummaryScreen: () => null }));
vi.mock('@/components/admin/screens/ShippingChargeGroupsPanel', () => ({ ShippingChargeGroupsPanel: () => null }));
const IMPACT = { goods: { publicGoods: 12, policyFeeGoods: 7 }, regionalFee: { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.guard.mockResolvedValue({ role: 'staff', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('staff') });
  mocks.origins.mockResolvedValue([]); mocks.options.mockResolvedValue([]); mocks.carriers.mockResolvedValue([]); mocks.history.mockResolvedValue([]); mocks.impact.mockResolvedValue(IMPACT); mocks.regions.mockResolvedValue({ policies: [], adoptions: [] });
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

/* S5-1: 지역별 추가배송비 때문에 새 주문이 막힌 출고지는 배송정보 관리의 그 출고지에서도 보인다(지역별 추가배송비 화면과 같은 판정). */
const GIMPO = { id: '00000000-0000-4000-8000-000000042201', code: 'gimpo', name: '김포', defaultCarrier: 'hanjin', active: true };
const endedPolicy = { id: 'policy-1', originId: GIMPO.id, carrierCode: 'hanjin', status: 'retired', startsAt: '2026-01-01T00:00:00Z', endsAt: null };
const blockedCase = (extra: { origins?: unknown[]; carriers?: unknown[] } = {}) => {
  mocks.guard.mockResolvedValue({ role: 'admin', user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess: legacyOperatorAccessFixture('admin') });
  mocks.origins.mockResolvedValue(extra.origins ?? [GIMPO, { ...GIMPO, id: 'origin-2', code: 'old', name: '옛 출고지', active: false }]);
  mocks.carriers.mockResolvedValue(extra.carriers ?? [{ code: 'hanjin', active: true }]);
  mocks.regions.mockResolvedValue({ policies: [endedPolicy], adoptions: [{ originId: GIMPO.id, managedFrom: '2026-01-01T00:00:00Z' }, { originId: 'origin-2', managedFrom: '2026-01-01T00:00:00Z' }] });
};
it('끝났거나 끝낸 설정만 있는 사용 중 출고지를 막힘으로 넘기고, 사용 안 함인 출고지는 넘기지 않는다', async () => {
  blockedCase();
  const result = await Page({ searchParams: Promise.resolve({ origin: 'gimpo' }) });
  expect(result.props.children[0].props.regionBlocks).toEqual([{ originId: GIMPO.id, originName: '김포', reason: 'ended' }]);
});
it('택배사가 사용 안 함이면 설정이 적용 기간 안이어도 막힘으로 넘긴다', async () => {
  blockedCase({ carriers: [{ code: 'hanjin', active: false }] });
  mocks.regions.mockResolvedValue({ policies: [{ ...endedPolicy, status: 'active' }], adoptions: [{ originId: GIMPO.id, managedFrom: '2026-01-01T00:00:00Z' }] });
  const result = await Page({ searchParams: Promise.resolve({ origin: 'gimpo' }) });
  expect(result.props.children[0].props.regionBlocks).toEqual([{ originId: GIMPO.id, originName: '김포', reason: 'carrier_off' }]);
});
it('지역별 추가배송비 설정을 읽지 못하면 막혔다고 말하지 않고 화면은 그대로 연다', async () => {
  blockedCase();
  mocks.regions.mockRejectedValue(new Error('denied'));
  const result = await Page({ searchParams: Promise.resolve({ origin: 'gimpo' }) });
  expect(result.props.children[0].props.regionBlocks).toBeUndefined();
  expect(result.props.children[0].props.origins).toHaveLength(2);
});
it('직원용 요약 화면에도 같은 안내를 넘긴다', async () => {
  mocks.guard.mockResolvedValue({ role: 'staff', user: { id: '91000000-0000-4000-8000-000000000002' }, operatorAccess: configuredOperatorAccessFixture('deputy') });
  mocks.options.mockResolvedValue([GIMPO]);
  mocks.carriers.mockResolvedValue([{ code: 'hanjin', active: true }]);
  mocks.regions.mockResolvedValue({ policies: [endedPolicy], adoptions: [{ originId: GIMPO.id, managedFrom: '2026-01-01T00:00:00Z' }] });
  const result = await Page();
  expect(result.props.children[0].props.regionBlocks).toEqual([{ originId: GIMPO.id, originName: '김포', reason: 'ended' }]);
});
