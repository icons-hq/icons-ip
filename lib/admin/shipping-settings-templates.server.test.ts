import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShippingSettingsOutdatedGoods, loadShippingSettingsTemplates, loadShippingSettingsUsage, parseShippingSettings, parseShippingSettingsPreview, searchShippingSettingsGoods } from './shipping-settings-templates.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc, from: mocks.from })) }));
/** goods 조회를 흉내 낸다. 건 조건을 `calls`에 남기고, 기다리면(또는 limit까지 걸면) `answer`를 돌려준다. */
function goodsQuery(answer: (filters: Record<string, unknown>) => unknown, calls: Record<string, unknown>[]) {
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = { table }; calls.push(filters);
    const query = { select: (columns: string, options: unknown) => { Object.assign(filters, { columns, options }); return query; },
      eq: (column: string, value: unknown) => { filters[`eq:${column}`] = value; return query; }, is: (column: string, value: unknown) => { filters[`is:${column}`] = value; return query; },
      in: (column: string, value: unknown) => { filters[`in:${column}`] = value; return query; },
      lt: (column: string, value: unknown) => { filters[`lt:${column}`] = value; return query; }, order: (column: string) => { filters.order = column; return query; },
      limit: (count: number) => { filters.limit = count; return query; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer(filters)).then(resolve) };
    return query;
  });
}
const settings = { originId: '00000000-0000-4000-8000-000000042201', feeType: 'free', individualFee: 3000,
  claimPolicy: { returnAllowed: true, exchangeAllowed: null, restrictionReason: null, returnFee: 0, returnFreeShippingFee: null, exchangeFee: 6000 } };
const template = { id: '00000000-0000-4000-8000-000000063211', name: '기본', revision: 1, enabled: true, settings, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' };
const identity = { expectedActorId: 'a7150000-0000-4000-8000-000000000001', expectedSessionId: 'a7150000-0000-4000-8000-000000000011' };
beforeEach(() => { mocks.rpc.mockReset(); mocks.from.mockReset(); });
describe('배송정보 템플릿 로더', () => {
  it('검색 범위의 마지막 페이지로 복구하며 서버 검색을 사용한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { total: 1, rows: [] } }).mockResolvedValueOnce({ data: { total: 1, rows: [template] } });
    const result = await loadShippingSettingsTemplates({ query: '기본', state: 'enabled', page: 3 });
    expect(result.filters.page).toBe(1); expect(result.rows).toEqual([template]);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_shipping_settings_templates', { p_query: '기본', p_state: 'enabled', p_page: 1 });
  });
  it('기존 상품의 출고지 미설정은 표시하되 템플릿 출고지 누락은 허용하지 않는다', () => {
    expect(parseShippingSettings({ ...settings, originId: null }, true)).not.toBeNull();
    expect(parseShippingSettings({ ...settings, originId: null })).toBeNull();
    expect(parseShippingSettings({ ...settings, claimPolicy: { ...settings.claimPolicy, returnFee: -1 } })).toBeNull();
  });
  it('누락된 미리보기 정책과 잘못된 검색 응답을 숨기지 않는다', async () => {
    expect(parseShippingSettingsPreview({ template, origin: { id: settings.originId, name: '김포', updatedAt: template.updatedAt, baseFee: 3000, freeThreshold: null, returnAddress: '', defaultCarrier: 'hanjin' }, goods: [{ id: 'g', name: '상품', code: 'G', updatedAt: template.updatedAt, before: settings, after: {} }] })).toBeNull();
    mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0, page: 1, pageSize: 100 } });
    await expect(searchShippingSettingsGoods('', 1, identity)).rejects.toThrow('상품을 불러오지 못했습니다');
  });
  it('legacy 무료 설정과 남아 있는 실제 활성 수량·착불을 같이 검증한다', () => {
    const delivery = { status: 'active', paymentMode: 'collect', quantityTerms: { kind: 'repeat', baseFee: 3000, interval: 2 }, draftValues: {} };
    const effective = { originId: settings.originId, feeType: 'free', individualFee: 3000, delivery };
    const origin = { id: settings.originId, name: '합성 출고지', updatedAt: template.updatedAt, baseFee: 3000, freeThreshold: null, returnAddress: '', defaultCarrier: 'hanjin',
      collectRevision: 1, collectVersionId: 'a7150000-0000-4000-8000-000000000401', collectReady: true, collectorName: '합성 수납사' };
    const row = { id: 'g', name: '상품', code: 'G', updatedAt: template.updatedAt, ownerGoodId: 'g', ownerUpdatedAt: template.updatedAt,
      familyGoodIds: ['g'], transactionRevision: 1, deliveryVersionId: 'a7150000-0000-4000-8000-000000000501', editable: true, blocker: null,
      before: settings, after: settings, effectiveBefore: effective, effectiveAfter: effective };
    const preview = { template, actorId: identity.expectedActorId, sessionId: identity.expectedSessionId, canApply: true, origin, goods: [row] };
    expect(parseShippingSettingsPreview(preview)).toEqual(preview);
    expect(parseShippingSettingsPreview({ ...preview, goods: [{ ...row, effectiveAfter: { ...effective, delivery: null } }] })).toBeNull();
    expect(parseShippingSettingsPreview({ ...preview, goods: [{ ...row, blocker: 'collect_contract_not_ready' }] })).toBeNull();
    expect(parseShippingSettingsPreview({ ...preview, goods: [{ ...row, familyGoodIds: ['other'] }] })).toBeNull();
  });
  it('검색 후보도 실제 정책과 소유자를 반환하고 actor/session을 전달한다', async () => {
    const row = { id: 'g', name: '상품', code: 'G', updatedAt: template.updatedAt, settings, templateId: null, templateRevision: null,
      ownerGoodId: 'g', familyGoodIds: ['g'], editable: true, blocker: null, effective: { originId: settings.originId, feeType: 'free', individualFee: 3000, delivery: null } };
    mocks.rpc.mockResolvedValue({ data: { rows: [row], total: 1, page: 1, pageSize: 20 } });
    expect((await searchShippingSettingsGoods('', 1, identity)).rows).toEqual([row]);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_search_goods_for_shipping_settings_v3', { p_query: '', p_page: 1, p_expected_actor_id: identity.expectedActorId, p_expected_session_id: identity.expectedSessionId });
  });
  it('이 쪽의 템플릿이 적용된 상품을 한 번에 읽어 적용 상품 수와 고친 뒤 다시 적용하지 않은 수를 센다', async () => {
    const calls: Record<string, unknown>[] = [], other = '00000000-0000-4000-8000-000000063299';
    const linked = (id: string, revision: number) => ({ shipping_settings_template_id: id, shipping_settings_template_revision: revision });
    goodsQuery(() => ({ data: [linked(template.id, 4), linked(template.id, 3), linked(template.id, 1)], count: 3, error: null }), calls);
    expect(await loadShippingSettingsUsage([{ id: template.id, revision: 4 }, { id: other, revision: 2 }])).toEqual({ [template.id]: { applied: 3, outdated: 2 }, [other]: { applied: 0, outdated: 0 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'goods', options: { count: 'exact' }, 'in:shipping_settings_template_id': [template.id, other], 'is:archived_at': null });
    expect(await loadShippingSettingsUsage([])).toEqual({}); expect(calls).toHaveLength(1);
  });
  it('한 번에 다 읽지 못하면 템플릿마다 수만 세고, 세지 못한 템플릿은 뺀다', async () => {
    const calls: Record<string, unknown>[] = [];
    goodsQuery(filters => 'in:shipping_settings_template_id' in filters ? { data: [], count: 1500, error: null }
      : filters['eq:shipping_settings_template_id'] === 'broken' ? { count: null, error: { message: 'x' } }
        : { count: 'lt:shipping_settings_template_revision' in filters ? 2 : 7, error: null }, calls);
    expect(await loadShippingSettingsUsage([{ id: template.id, revision: 4 }, { id: 'broken', revision: 1 }])).toEqual({ [template.id]: { applied: 7, outdated: 2 } });
    expect(calls).toHaveLength(5);
    expect(calls[1]).toMatchObject({ table: 'goods', options: { count: 'exact', head: true }, 'eq:shipping_settings_template_id': template.id, 'is:archived_at': null });
    expect(calls[2]).toMatchObject({ 'lt:shipping_settings_template_revision': 4, 'is:archived_at': null });
    mocks.from.mockImplementation(() => { throw new Error('offline'); });
    expect(await loadShippingSettingsUsage([{ id: template.id, revision: 4 }])).toEqual({});
  });
  it('다시 적용할 상품은 한 번에 적용할 수 있는 수까지만 고르고 전체 수를 함께 돌려준다', async () => {
    const calls: Record<string, unknown>[] = [];
    goodsQuery(() => ({ data: [{ id: 'good-1' }, { id: 'good-2' }], count: 130, error: null }), calls);
    expect(await loadShippingSettingsOutdatedGoods(template.id, 4, 100)).toEqual({ ids: ['good-1', 'good-2'], total: 130 });
    expect(calls[0]).toMatchObject({ table: 'goods', options: { count: 'exact', head: false }, 'eq:shipping_settings_template_id': template.id,
      'lt:shipping_settings_template_revision': 4, 'is:archived_at': null, order: 'id', limit: 100 });
    goodsQuery(() => ({ data: null, count: null, error: { message: 'x' } }), calls);
    await expect(loadShippingSettingsOutdatedGoods(template.id, 4, 100)).rejects.toThrow('상품을 불러오지 못했습니다');
  });
});
