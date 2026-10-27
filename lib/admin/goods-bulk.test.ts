import { describe, expect, it } from 'vitest';
import { goodsBulkError, goodsBulkShippingHref, parseGoodsBulkPreview, parseGoodsBulkReceipt, parseGoodsBulkRequest, parseGoodsBulkShippingIds, type GoodsBulkPreview, type GoodsBulkRequest } from './goods-bulk';
const id = 'b9000000-0000-4000-8000-000000000001';
const request: GoodsBulkRequest = { kind: 'goods', ids: ['good-a'], command: 'price', values: { mode: 'increase', value: 100 } };
const preview: GoodsBulkPreview = { state: 'ready', operationId: id, request, groups: [], expiresAt: '2026-10-16T14:00:00.123456Z',
  goods: [{ id: 'good-a', name: '상품 A', code: 'GOOD-A', price: 1000, nextPrice: 1100, priceMin: 1000, priceMax: 1500, nextMin: 1100, nextMax: 1600, published: false, archived: false, stopped: false }] };
describe('상품 일괄 변경 계약', () => {
  it('정확한 상품·그룹 ID 및 기존 거래 범위를 받는다', () => {
    expect(parseGoodsBulkRequest(request)).toEqual(request);
    expect(parseGoodsBulkRequest({ kind: 'groups', ids: [id], command: 'dissolve', values: {} })).not.toBeNull();
    expect(parseGoodsBulkRequest({ kind: 'goods', ids: ['good-a'], command: 'period', values: { startsAt: null, endsAt: null } })).not.toBeNull();
  });
  it.each([{ ids: [] }, { ids: ['good-a', 'good-a'] }, { ids: Array.from({ length: 101 }, (_, i) => `good-${i}`) }, { ids: ['../bad'] },
    { kind: 'groups' }, { command: 'dissolve' }, { values: { mode: null, value: 1 } }, { values: { mode: 'percent_decrease', value: 100 } },
    { values: { mode: 'set', value: 1.1 } }, { values: { mode: 'set', value: 2147483648 } }, { values: { mode: 'set', value: 10, ignored: true } }])('유효하지 않은 일괄 입력 %j', patch => {
    expect(parseGoodsBulkRequest({ ...request, ...patch })).toBeNull();
  });
  it('불완전 기간·잘못된 달력·반대 기간은 거절한다', () => {
    for (const startsAt of [null, '2026-02-30T00:00:00Z', '2026-10-17T00:00:00Z']) expect(parseGoodsBulkRequest({ ...request, command: 'discount', values: { mode: 'rate', value: 10, startsAt, endsAt: '2026-10-16T00:00:00Z' } })).toBeNull();
  });
  it('비교 결과의 요청·대상·요청번호와 비공개 필드 유출을 검사한다', () => {
    expect(parseGoodsBulkPreview(preview, id, request)).toEqual(preview);
    for (const value of [{ ...preview, private: true }, { ...preview, operationId: 'b9000000-0000-4000-8000-000000000002' },
      { ...preview, request: { ...request, values: { mode: 'increase', value: 200 } } }, { ...preview, goods: [{ ...preview.goods[0], id: 'other' }] },
      { ...preview, goods: [...preview.goods, ...preview.goods] }, { ...preview, goods: [{ ...preview.goods[0], nextMin: 1700 }] }]) expect(parseGoodsBulkPreview(value, id, request)).toBeNull();
  });
  it('그룹 확장은 선택 그룹과 일치해야 한다', () => {
    const grouped: GoodsBulkRequest = { ...request, kind: 'groups', ids: [id] };
    expect(parseGoodsBulkPreview({ ...preview, request: grouped, groups: [{ id, name: '그룹', revision: 1 }] }, id, grouped)).not.toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, request: grouped }, id, grouped)).toBeNull();
  });
  it('완료·거절·미처리 영수증의 수량과 요청번호를 대조한다', () => {
    const receipt = { state: 'completed', operationId: id, goodsCount: 1, groupsCount: 0, error: null };
    expect(parseGoodsBulkReceipt(receipt, id)).toEqual(receipt);
    for (const change of [{ goodsCount: 0 }, { state: 'rejected' }, { state: 'unresolved' }, { error: 'internal' }, { operationId: 'bad' }]) expect(parseGoodsBulkReceipt({ ...receipt, ...change }, id)).toBeNull();
    expect(parseGoodsBulkReceipt({ ...receipt, state: 'rejected', goodsCount: 0, error: 'goods_bulk_changed' }, id)).not.toBeNull();
  });
  it('IP 전체 즉시할인은 IP 하나와 할인 명령만 받는다', () => {
    const values = { mode: 'rate', value: 10, startsAt: '2026-10-28T00:00:00Z', endsAt: '2026-10-30T00:00:00Z' };
    expect(parseGoodsBulkRequest({ kind: 'ip', ids: ['maple-story'], command: 'discount', values })).not.toBeNull();
    expect(parseGoodsBulkRequest({ kind: 'ip', ids: ['maple-story'], command: 'discount_stop', values: {} })).not.toBeNull();
    for (const patch of [{ ids: ['maple-story', 'other'] }, { ids: ['Bad IP'] }, { command: 'price', values: { mode: 'set', value: 10 } }, { command: 'archive', values: {} }])
      expect(parseGoodsBulkRequest({ kind: 'ip', ids: ['maple-story'], command: 'discount', values, ...patch })).toBeNull();
  });
  it('할인 비교의 건너뛰기를 받아 100개를 넘는 IP 확장도 검사한다', () => {
    const ipRequest: GoodsBulkRequest = { kind: 'ip', ids: ['maple-story'], command: 'discount', values: { mode: 'amount', value: 100, startsAt: '2026-10-28T00:00:00Z', endsAt: '2026-10-30T00:00:00Z' } };
    const goods = Array.from({ length: 150 }, (_, index) => ({ ...preview.goods[0], id: `good-${index}`, skip: index === 0 ? 'price_period_overlap' : null }));
    expect(parseGoodsBulkPreview({ ...preview, request: ipRequest, goods }, id, ipRequest)).not.toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, request: ipRequest, goods: goods.map(row => ({ ...row, skip: 'price_period_overlap' })) }, id, ipRequest)).toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, request: ipRequest, goods: [{ ...goods[0], skip: 'Bad reason' }, goods[1]] }, id, ipRequest)).toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, goods: [{ ...preview.goods[0], skip: 'price_period_overlap' }] }, id, request)).toBeNull();
    const goodsRequest: GoodsBulkRequest = { ...request, ids: Array.from({ length: 150 }, (_, index) => `good-${index}`) };
    expect(parseGoodsBulkPreview({ ...preview, request: goodsRequest, goods }, id, goodsRequest)).toBeNull();
  });
  it('할인 중지 비교는 꺼질 진행·예정 할인을 상품별로 받고 없는 상품은 건너뛴다', () => {
    const stop: GoodsBulkRequest = { kind: 'ip', ids: ['maple-story'], command: 'discount_stop', values: {} };
    const discounts = { count: 2, minPrice: 9000, maxPrice: 9500, startsAt: '2026-10-28T00:00:00Z', endsAt: '2026-10-30T00:00:00Z' };
    const goods = [{ ...preview.goods[0], id: 'good-a', skip: null, discounts }, { ...preview.goods[0], id: 'good-b', skip: 'no_active_discount', discounts: null }];
    expect(parseGoodsBulkPreview({ ...preview, request: stop, goods }, id, stop)).not.toBeNull();
    for (const bad of [{ ...discounts, count: 0 }, { ...discounts, minPrice: 9600 }, { ...discounts, endsAt: '2026-10-27T00:00:00Z' }, { ...discounts, extra: 1 }])
      expect(parseGoodsBulkPreview({ ...preview, request: stop, goods: [{ ...goods[0], discounts: bad }, goods[1]] }, id, stop)).toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, request: stop, goods: [goods[1]] }, id, stop)).toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, goods: [{ ...preview.goods[0], discounts }] }, id, request)).toBeNull();
  });
  it('진행 중인 즉시할인 때문에 판매가를 못 바꾸면 할인 중지를 안내한다', () => {
    expect(goodsBulkError('active_price_period_requires_reset')).toContain('즉시할인을 먼저 중지');
    expect(goodsBulkError('active_price_period_requires_reset')).not.toContain('굿즈');
    expect(goodsBulkError('goods_bulk_no_active_discount')).toContain('즉시할인이 없습니다');
  });
  it('완료 영수증의 건너뛴 상품 목록을 검사한다', () => {
    const receipt = { state: 'completed', operationId: id, goodsCount: 120, groupsCount: 0, error: null, skipped: [{ id: 'good-a', name: '상품 A', code: null, reason: 'price_period_overlap' }] };
    expect(parseGoodsBulkReceipt(receipt, id)).toEqual(receipt);
    expect(parseGoodsBulkReceipt({ ...receipt, skipped: [{ id: 'good-a', name: '상품 A', reason: 'price_period_overlap' }] }, id)).toBeNull();
    expect(parseGoodsBulkReceipt({ ...receipt, state: 'rejected', goodsCount: 0, error: 'goods_bulk_changed' }, id)).toBeNull();
    expect(parseGoodsBulkReceipt({ ...receipt, goodsCount: 1001 }, id)).toBeNull();
  });
  it('배송 템플릿 진입에서 선택 상품을 보존하고 잘못된 URL 입력을 버린다', () => {
    const ids = ['good-a', 'good-b']; expect(parseGoodsBulkShippingIds(new URL(goodsBulkShippingHref(ids), 'http://test').searchParams.get('goods'))).toEqual(ids);
    expect(parseGoodsBulkShippingIds('good-a,good-a')).toEqual([]); expect(parseGoodsBulkShippingIds(['good-a'])).toEqual([]);
  });
});
