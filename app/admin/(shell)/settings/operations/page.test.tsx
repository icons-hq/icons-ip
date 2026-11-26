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
const ORIGIN = { id: 'origin-1', name: '김포', defaultCarrier: 'hanjin', active: true };
const POLICY = { id: 'policy-1', originId: 'origin-1', carrierCode: 'hanjin', status: 'active', startsAt: '2026-01-01T00:00:00Z', endsAt: null, rules: [] };
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
  /* 지역별 추가배송비 카드는 택배사가 사용 중인지도 봐야 하므로 택배사를 읽지 못하면 말하지 않는다. */
  expect(result.props.readiness.regions).toBeUndefined();
  expect(result.props.shippingRegionExpiry).toEqual({ warnings: [] });
});
it('적용 중인 설정이 없으면 입력 필요, 지금 적용 중인 설정이 있으면 입력 완료다', async () => {
  expect((await Page()).props.readiness.regions).toEqual({ done: false, detail: '적용 중인 설정 없음' });
  mocks.origins.mockResolvedValue([ORIGIN]);
  mocks.policies.mockResolvedValue({ policies: [POLICY], adoptions: [{ originId: ORIGIN.id, managedFrom: '2026-01-01T00:00:00Z' }] });
  mocks.carriers.mockResolvedValue([{ code: 'hanjin', active: true }]);
  const result = await Page();
  expect(result.props.readiness.regions).toEqual({ done: true, detail: '적용 중인 설정 1개' });
  expect(result.props.shippingRegionExpiry).toEqual({ warnings: [] });
});
it('지역별 추가배송비 설정이 끝나 새 주문이 막힌 출고지는 입력 필요로 말하고 알림에 이름과 까닭을 넘긴다 (S5-1)', async () => {
  mocks.origins.mockResolvedValue([ORIGIN, { ...ORIGIN, id: 'origin-off', name: '옛 출고지', active: false }]);
  mocks.carriers.mockResolvedValue([{ code: 'hanjin', active: true }]);
  /* 설정을 [끝내기]로 끝냈다 — 만료 조회에는 나오지 않지만 새 주문은 막힌다. 사용 안 함인 출고지는 세지 않는다. */
  mocks.policies.mockResolvedValue({ policies: [{ ...POLICY, status: 'retired' }], adoptions: [{ originId: ORIGIN.id, managedFrom: '2026-01-01T00:00:00Z' }, { originId: 'origin-off', managedFrom: '2026-01-01T00:00:00Z' }] });
  const result = await Page();
  expect(result.props.readiness.regions).toEqual({ done: false, detail: '새 주문이 막힌 출고지 1곳' });
  expect(result.props.shippingRegionExpiry).toEqual({ warnings: [], blocked: [{ originId: ORIGIN.id, originName: '김포', reason: 'ended' }] });
});
it('설정을 읽지 못하면 막혔는지 알 수 없으니 카드 상태도 알림도 말하지 않는다', async () => {
  mocks.origins.mockResolvedValue([ORIGIN]);
  mocks.policies.mockRejectedValue(new Error('denied'));
  const result = await Page();
  expect(result.props.readiness.regions).toBeUndefined();
  expect(result.props.shippingRegionExpiry).toEqual({ warnings: [] });
});
