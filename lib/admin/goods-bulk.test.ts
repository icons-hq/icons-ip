import { describe, expect, it } from 'vitest';
import { GOODS_BULK_LABELS, GOODS_BULK_SKIP_LABELS, GOODS_BULK_UNCERTAIN, goodsBulkError, goodsBulkFormValues, goodsBulkModeUnit, goodsBulkPriceConfirmation, goodsBulkShippingHref, goodsBulkSkipLabel, goodsBulkSkipMessage,
  parseGoodsBulkPreview, parseGoodsBulkReceipt, parseGoodsBulkRequest, parseGoodsBulkShippingIds, type GoodsBulkFormFields, type GoodsBulkPreview, type GoodsBulkRequest } from './goods-bulk';
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
  it('IP 전체 기간 할인은 IP 하나와 할인 명령만 받는다', () => {
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
  /* TKT-033: 목록 판매가 칸의 할인 중지는 상품 1개에 한해 기간 없는 즉시할인(정가 표시)도 멈출 할인으로 받는다. */
  it('상품 1개 할인 중지만 includeInstant를 받고, 비교는 멈출 기간 없는 즉시할인을 싣는다', () => {
    const single: GoodsBulkRequest = { kind: 'goods', ids: ['good-a'], command: 'discount_stop', values: { includeInstant: true } };
    expect(parseGoodsBulkRequest(single)).toEqual(single);
    for (const bad of [{ ...single, ids: ['good-a', 'good-b'] }, { ...single, kind: 'ip', ids: ['maple'] }, { ...single, values: { includeInstant: false } },
      { ...single, values: { includeInstant: 'true' } }, { ...single, command: 'discount', values: { includeInstant: true } }, { ...single, command: 'stop', values: { includeInstant: true } }])
      expect(parseGoodsBulkRequest(bad), JSON.stringify(bad)).toBeNull();
    const row = { ...preview.goods[0], id: 'good-a', skip: null, discounts: null, instantDiscount: { regularPrice: 12000, salePrice: 9000 } };
    expect(parseGoodsBulkPreview({ ...preview, request: single, goods: [row] }, id, single)?.goods[0].instantDiscount).toEqual({ regularPrice: 12000, salePrice: 9000 });
    for (const bad of [{ regularPrice: 9000, salePrice: 9000 }, { regularPrice: 12000 }, { regularPrice: 12000, salePrice: 9000, extra: 1 }])
      expect(parseGoodsBulkPreview({ ...preview, request: single, goods: [{ ...row, instantDiscount: bad }] }, id, single)).toBeNull();
    const plainStop: GoodsBulkRequest = { ...single, values: {} };
    expect(parseGoodsBulkPreview({ ...preview, request: plainStop, goods: [row] }, id, plainStop)).toBeNull();
    expect(goodsBulkSkipLabel('instant_discount_active')).toContain('기간 없는 즉시할인');
  });
  it('진행 중인 기간 할인 때문에 판매가를 못 바꾸면 할인 중지를 안내한다', () => {
    expect(goodsBulkError('active_price_period_requires_reset')).toContain('기간 할인을 먼저 중지');
    expect(goodsBulkError('active_price_period_requires_reset')).not.toContain('굿즈');
    expect(goodsBulkError('goods_bulk_no_active_discount')).toContain('멈출 기간 할인이 없습니다');
  });
  /* D4(20261126120000): 공개·초안·판매상태·보관·복원·판매가·판매기간도 상품마다 건너뛴다. 미리보기와 저장이 같은 판정을 쓴다. */
  it('모든 명령의 비교가 상품별 건너뛰기를 받고, 할인이 아니면 모두 건너뛰어도 이유를 보여 주려고 받는다', () => {
    const publish: GoodsBulkRequest = { kind: 'goods', ids: ['good-a', 'good-b'], command: 'publish', values: {} };
    const rows = [{ ...preview.goods[0], id: 'good-a', skip: null }, { ...preview.goods[0], id: 'good-b', skip: 'goods_category_required' }];
    expect(parseGoodsBulkPreview({ ...preview, request: publish, goods: rows }, id, publish)?.goods.map(row => row.skip)).toEqual([null, 'goods_category_required']);
    expect(parseGoodsBulkPreview({ ...preview, request: publish, goods: rows.map(row => ({ ...row, skip: 'good_archived' })) }, id, publish)).not.toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, goods: [{ ...preview.goods[0], skip: 'active_price_period_requires_reset' }] }, id, request)).not.toBeNull();
    expect(parseGoodsBulkPreview({ ...preview, request: publish, goods: [rows[0], { ...rows[1], skip: 'Bad reason' }] }, id, publish)).toBeNull();
  });
  it('비교 줄의 판매상태 값과 지금 판매기간을 받고, 모양이 틀리면 거절한다', () => {
    const stop: GoodsBulkRequest = { kind: 'goods', ids: ['good-a'], command: 'stop', values: {} };
    const row = { ...preview.goods[0], skip: null, discounts: null, stock: 'low', saleStartsAt: '2026-12-01T01:00:00+00:00', saleEndsAt: '2026-12-07T14:59:00+00:00' };
    expect(parseGoodsBulkPreview({ ...preview, request: stop, goods: [row] }, id, stop)?.goods[0]).toMatchObject({ stock: 'low', saleStartsAt: '2026-12-01T01:00:00+00:00' });
    expect(parseGoodsBulkPreview({ ...preview, request: stop, goods: [{ ...row, saleStartsAt: null, saleEndsAt: null }] }, id, stop)).not.toBeNull();
    for (const bad of [{ stock: 'paused' }, { stock: null }, { saleStartsAt: '2026-12-01' }, { saleEndsAt: 12 }, { extra: true }])
      expect(parseGoodsBulkPreview({ ...preview, request: stop, goods: [{ ...row, ...bad }] }, id, stop), JSON.stringify(bad)).toBeNull();
  });
  it('건너뛴 이유를 표 한 칸의 짧은 말로 옮기고, 모르는 이유도 다음에 볼 곳을 말한다', () => {
    for (const reason of ['good_archived', 'goods_category_required', 'goods_kc_review_required', 'goods_publish_incomplete', 'good_has_stock',
      'goods_bulk_already_published', 'goods_bulk_already_draft', 'goods_bulk_not_stopped', 'goods_bulk_already_stopped', 'goods_bulk_already_archived',
      'goods_bulk_not_archived', 'active_price_period_requires_reset', 'goods_compare_at_price_invalid', 'goods_sale_period_preorder_conflict', 'goods_bulk_busy'])
      expect(GOODS_BULK_SKIP_LABELS[reason], reason).toBeTruthy();
    expect(goodsBulkSkipLabel('goods_bulk_not_stopped')).toBe('판매중지가 아님');
    expect(goodsBulkSkipLabel('goods_bulk_price_invalid')).toBe('할인가가 1원 미만이거나 판매가 이상');
    expect(goodsBulkSkipLabel('goods_bulk_price_invalid', 'price')).toBe('새 판매가가 1원보다 작거나 너무 큼');
    expect(goodsBulkSkipLabel('random_option_count')).toContain('랜덤 판매');
    expect(goodsBulkSkipLabel('some_new_reason')).toBe('지금은 바꿀 수 없음(상품 수정에서 확인)');
    /* 상품 1개짜리 변경(목록 바로 수정)은 같은 이유를 문장으로 받는다. */
    expect(goodsBulkSkipMessage('good_archived')).toBe('보관된 상품은 바꿀 수 없습니다. 먼저 복원해주세요.');
    expect(goodsBulkSkipMessage('random_option_count')).toBe('판매 중인 옵션이 2개 이상이어야 랜덤 판매를 쓸 수 있습니다.');
  });
  it('버튼·카드 이름은 화면 낱말 표를 따른다', () => {
    expect(GOODS_BULK_LABELS).toMatchObject({ publish: '공개로', unpublish: '초안으로', start: '판매중으로', stop: '판매중지로', archive: '보관', restore: '복원', discount: '기간 할인 걸기', discount_stop: '기간 할인 중지' });
    expect(GOODS_BULK_UNCERTAIN).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    for (const stale of ['판매 재개', '판매 운영', '전시 중지', '즉시할인 등록']) expect(Object.values(GOODS_BULK_LABELS)).not.toContain(stale);
  });
  it('오류 문장은 무엇이 문제인지와 다음에 할 일을 함께 말한다', () => {
    expect(goodsBulkError('operator_capability_required')).toBe('상품을 바꿀 권한이 없습니다. 최고 관리자에게 매니저 관리에서 상품 관리 권한을 요청해주세요.');
    expect(goodsBulkError('goods_category_required')).toBe('대표 카테고리가 없어 공개할 수 없습니다. 상품 수정에서 대표 카테고리를 골라주세요.');
    expect(goodsBulkError('goods_bulk_all_skipped')).toContain('바꿀 수 있는 상품이 없습니다.');
    for (const code of ['goods_bulk_changed', 'goods_kc_review_required', 'good_archived', 'goods_compare_at_price_invalid', 'unknown_code']) expect(goodsBulkError(code), code).not.toContain('해당');
  });
  it('할인이 아닌 명령의 완료 영수증도 건너뛴 상품과 이유를 싣는다', () => {
    const receipt = { state: 'completed', operationId: id, goodsCount: 1, groupsCount: 0, error: null, skipped: [{ id: 'good-b', name: '상품 B', code: 'GOOD-B', reason: 'goods_category_required' }] };
    expect(parseGoodsBulkReceipt(receipt, id)?.skipped).toEqual(receipt.skipped);
    expect(parseGoodsBulkReceipt({ ...receipt, skipped: [] }, id)).not.toBeNull();
    expect(parseGoodsBulkReceipt({ ...receipt, state: 'rejected', goodsCount: 0, error: 'goods_bulk_all_skipped' }, id)).toBeNull();
    expect(parseGoodsBulkReceipt({ state: 'rejected', operationId: id, goodsCount: 0, groupsCount: 0, error: 'goods_bulk_all_skipped' }, id)).not.toBeNull();
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

/* CAT-008: 일괄 판매가 변경을 적용하기 전에 크게 바뀌거나 1,000원 미만이 되는 상품을 이전 → 새 값으로 확인받는다. */
describe('일괄 판매가 변경 오입력 확인', () => {
  const row = preview.goods[0];
  it('판매가 변경의 오입력 후보만 상품별로 묻고, 다른 변경·정상 범위는 묻지 않는다', () => {
    expect(goodsBulkPriceConfirmation(preview)).toBeNull();
    const typo = goodsBulkPriceConfirmation({ request, goods: [{ ...row, price: 29000, nextPrice: 2900 }, { ...row, id: 'good-b', name: '상품 B', price: 20000, nextPrice: 21000 },
      { ...row, id: 'good-c', name: '상품 C', price: 900, nextPrice: 950 }] });
    expect(typo).toMatchObject({ title: '판매가 확인', confirmLabel: '이대로 적용' });
    expect(typo?.message).toContain('· 상품 A: 29,000원 → 2,900원 (이전 금액의 절반 이하)');
    expect(typo?.message).toContain('· 상품 C: 900원 → 950원 (1,000원 미만)');
    expect(typo?.message).not.toContain('상품 B');
    expect(typo?.message).toContain('맞으면 3개 상품에 판매가 변경을 적용합니다.');
    expect(goodsBulkPriceConfirmation({ request: { ...request, command: 'discount' }, goods: [{ ...row, price: 29000, nextPrice: 2900 }] })).toBeNull();
  });
});

/* B-02·B-09·B-10: 창의 입력을 요청 값으로 옮긴다. 틀린 칸은 어느 칸이 왜 안 되는지 말하고, 판매기간의 두 선택은 함께 읽지 않는다. */
describe('일괄 변경 창의 입력', () => {
  const fields: GoodsBulkFormFields = { mode: 'set', value: '', periodMode: 'range', startsAt: '', endsAt: '' };
  it('금액·비율을 숫자로 옮기고, 방식에 맞는 단위와 범위로 안내한다', () => {
    expect(goodsBulkFormValues('price', { ...fields, value: '12,000' })).toEqual({ values: { mode: 'set', value: 12000 } });
    expect(goodsBulkFormValues('price', { ...fields, value: '' })).toEqual({ error: '금액은 1 이상의 숫자로 입력해주세요.' });
    expect(goodsBulkFormValues('price', { ...fields, mode: 'percent_decrease', value: '0' })).toEqual({ error: '비율은 1 이상의 숫자로 입력해주세요.' });
    expect(goodsBulkFormValues('price', { ...fields, mode: 'percent_decrease', value: '100' })).toEqual({ error: '내리는 비율은 99% 이하로 입력해주세요.' });
    expect(goodsBulkFormValues('price', { ...fields, mode: 'percent_increase', value: '1001' })).toEqual({ error: '올리는 비율은 1,000% 이하로 입력해주세요.' });
    expect(goodsBulkFormValues('price', { ...fields, value: '2147483648' })).toEqual({ error: '금액이 너무 큽니다. 2,147,483,647원 이하로 입력해주세요.' });
    expect(goodsBulkModeUnit('set')).toBe('원'); expect(goodsBulkModeUnit('amount')).toBe('원');
    expect(goodsBulkModeUnit('rate')).toBe('%'); expect(goodsBulkModeUnit('percent_increase')).toBe('%');
  });
  it('기간 할인은 금액과 기간(KST 입력)을 함께 옮긴다', () => {
    const discount = { ...fields, mode: 'rate', value: '10', startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' };
    expect(goodsBulkFormValues('discount', discount)).toEqual({ values: { mode: 'rate', value: 10, startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-07T14:59:00.000Z' } });
    expect(goodsBulkFormValues('discount', { ...discount, value: '100' })).toEqual({ error: '할인 비율은 99% 이하로 입력해주세요.' });
    expect(goodsBulkFormValues('discount', { ...discount, endsAt: '' })).toEqual({ error: '시작 (KST)과 종료 (KST)를 모두 입력해주세요. 종료는 시작보다 늦어야 합니다.' });
    expect(goodsBulkFormValues('discount', { ...discount, endsAt: '2026-11-30T00:00' })).toHaveProperty('error');
  });
  it("판매기간은 '기간 정하기'면 날짜가 있어야 하고, '기간 없이 계속 판매'면 적어 둔 날짜를 읽지 않는다", () => {
    const dated = { ...fields, startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' };
    expect(goodsBulkFormValues('period', dated)).toEqual({ values: { startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-07T14:59:00.000Z' } });
    expect(goodsBulkFormValues('period', fields)).toHaveProperty('error');
    expect(goodsBulkFormValues('period', { ...dated, periodMode: 'none' })).toEqual({ values: { startsAt: null, endsAt: null } });
    /* 옮긴 값은 요청 검사를 그대로 지난다. */
    for (const input of [goodsBulkFormValues('period', dated), goodsBulkFormValues('period', { ...dated, periodMode: 'none' })])
      expect('values' in input && parseGoodsBulkRequest({ kind: 'goods', ids: ['good-a'], command: 'period', values: input.values })).toBeTruthy();
    expect(goodsBulkFormValues('publish', fields)).toEqual({ values: {} });
  });
});
