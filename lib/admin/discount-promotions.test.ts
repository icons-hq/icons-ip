import { describe, expect, it } from 'vitest';
import {
  DISCOUNT_PROMOTION_GOODS_LIMIT,
  discountPromotionError,
  discountPromotionHref,
  discountPromotionListHref,
  discountPromotionPhase,
  discountPromotionRuleLocked,
  discountPromotionSkipLabel,
  discountRuleLabel,
  newDiscountPromotionHref,
  parseDiscountPromotionDetail,
  parseDiscountPromotionList,
  parseDiscountPromotionPreview,
  parseDiscountPromotionReceipt,
  parseDiscountPromotionRequest,
  parseDiscountPromotionStopReceipt,
  parseDiscountPromotionTargetOptions,
  type DiscountPromotionRequest,
} from './discount-promotions';

const OPERATION = '6f1c2a9e-3d4b-4c5d-8e6f-7a8b9c0d1e2f';
const request: DiscountPromotionRequest = {
  name: '오픈 기획전 10%', startsAt: '2026-11-20T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z',
  target: { kind: 'campaign', ids: ['hongsil-open'] }, rule: { mode: 'rate', value: 10 },
  exceptions: [{ goodId: 'good-b', mode: 'rate', value: 20 }, { goodId: 'good-g', mode: 'exclude' }],
};
const previewRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `상품 ${id}`, code: `CODE-${id}`, price: 10000, priceMin: 10000, priceMax: 10000, nextMin: 9000, nextMax: 9000,
  published: true, archived: false, rule: { source: 'default', mode: 'rate', value: 10 }, skip: null, overlap: null, ...extra,
});
const preview = {
  state: 'ready', operationId: OPERATION, request, target: { kind: 'campaign', ids: ['hongsil-open'], label: '홍실 오픈 기획전' },
  goods: [previewRow('good-a'),
    previewRow('good-b', { rule: { source: 'exception', mode: 'rate', value: 20 }, nextMin: 8000, nextMax: 8000 }),
    previewRow('good-d', { skip: 'price_period_overlap', nextMin: null, nextMax: null,
      overlap: { promotionId: null, promotionName: null, startsAt: '2026-11-21T00:00:00+00:00', endsAt: '2026-11-22T00:00:00+00:00' } }),
    previewRow('good-g', { rule: { source: 'exception', mode: 'exclude', value: null }, skip: 'discount_promotion_excluded', nextMin: null, nextMax: null })],
  expiresAt: '2026-11-11T09:15:00.000+00:00',
};
const summary = {
  id: OPERATION, name: '오픈 기획전 10%', state: 'active', startsAt: '2026-11-20T00:00:00+00:00', endsAt: '2026-11-30T00:00:00+00:00',
  target: { kind: 'campaign', id: 'hongsil-open', label: '홍실 오픈 기획전' }, rule: { mode: 'rate', value: 10 },
  goodsCount: 4, appliedCount: 2, exceptionCount: 2, discounts: { active: 2, ended: 0, disabled: 0 }, revision: 1,
  createdAt: '2026-11-11T09:00:00+00:00', createdByName: '운영자', stoppedAt: null, stoppedByName: null,
};

describe('할인 프로모션 요청', () => {
  it('일괄 율·예외(율·금액·예외가·제외)를 DB 검증과 같은 규칙으로 받는다', () => {
    expect(parseDiscountPromotionRequest(request)).toEqual(request);
    expect(parseDiscountPromotionRequest({ ...request, exceptions: [{ goodId: 'good-c', mode: 'price', value: 7000 }, { goodId: 'good-e', mode: 'amount', value: 500 }] })).not.toBeNull();
    expect(parseDiscountPromotionRequest({ ...request, target: { kind: 'goods', ids: ['good-a', 'good-b'] } })).not.toBeNull();
    expect(parseDiscountPromotionRequest({ ...request, target: { kind: 'ip', ids: ['maple'] } })).not.toBeNull();
  });
  it('잘못된 값은 서버로 보내지 않는다', () => {
    const bad = [
      { ...request, name: ' 앞뒤 공백 ' }, { ...request, name: '' }, { ...request, name: '가'.repeat(61) },
      { ...request, startsAt: request.endsAt }, { ...request, startsAt: '2026-11-20T00:00' },
      { ...request, rule: { mode: 'rate', value: 100 } }, { ...request, rule: { mode: 'price', value: 1000 } }, { ...request, rule: { mode: 'amount', value: 0 } },
      { ...request, target: { kind: 'campaign', ids: ['a', 'b'] } }, { ...request, target: { kind: 'ip', ids: [] } },
      { ...request, target: { kind: 'goods', ids: ['good-a', 'good-a'] } }, { ...request, target: { kind: 'goods', ids: ['Bad Id'] } },
      { ...request, target: { kind: 'goods', ids: Array.from({ length: DISCOUNT_PROMOTION_GOODS_LIMIT + 1 }, (_, index) => `g${index}`) } },
      { ...request, exceptions: [{ goodId: 'good-a', mode: 'exclude', value: 1 }] }, { ...request, exceptions: [{ goodId: 'good-a', mode: 'rate', value: 100 }] },
      { ...request, exceptions: [{ goodId: 'good-a', mode: 'rate', value: 5 }, { goodId: 'good-a', mode: 'amount', value: 5 }] },
      { ...request, extra: true },
    ];
    for (const value of bad) expect(parseDiscountPromotionRequest(value), JSON.stringify(value).slice(0, 80)).toBeNull();
  });
});

describe('할인 프로모션 응답', () => {
  it('미리보기의 건너뛰기·겹침·예외를 그대로 읽고 요청과 어긋나면 버린다', () => {
    const parsed = parseDiscountPromotionPreview(preview, OPERATION, request);
    expect(parsed?.goods.map(row => [row.id, row.skip, row.rule.source])).toEqual([
      ['good-a', null, 'default'], ['good-b', null, 'exception'], ['good-d', 'price_period_overlap', 'default'], ['good-g', 'discount_promotion_excluded', 'exception']]);
    expect(parsed?.goods[2].overlap?.promotionId).toBeNull();
    expect(parseDiscountPromotionPreview(preview, OPERATION, { ...request, rule: { mode: 'rate', value: 15 } })).toBeNull();
    expect(parseDiscountPromotionPreview({ ...preview, goods: preview.goods.map(row => ({ ...row, skip: 'goods_bulk_price_invalid', nextMin: null, nextMax: null, overlap: null })) }, OPERATION, request)).toBeNull();
    expect(parseDiscountPromotionPreview({ ...preview, goods: [previewRow('good-a', { skip: 'price_period_overlap', nextMin: null, nextMax: null })] }, OPERATION, request)).toBeNull();
    expect(parseDiscountPromotionPreview({ ...preview, target: { ...preview.target, label: null } }, OPERATION, request)).toBeNull();
  });
  it('확정 영수증은 완료·거절·미확인·봉인을 구분한다', () => {
    expect(parseDiscountPromotionReceipt({ state: 'completed', operationId: OPERATION, promotionId: OPERATION, goodsCount: 2, periodCount: 3,
      skipped: [{ id: 'good-d', name: '상품 good-d', code: null, reason: 'price_period_overlap' }], error: null }, OPERATION)?.skipped).toHaveLength(1);
    expect(parseDiscountPromotionReceipt({ state: 'rejected', operationId: OPERATION, promotionId: null, goodsCount: 0, periodCount: 0, skipped: [], error: 'discount_promotion_changed' }, OPERATION)?.error).toBe('discount_promotion_changed');
    expect(parseDiscountPromotionReceipt({ state: 'unresolved', operationId: OPERATION, promotionId: null, goodsCount: 0, periodCount: 0, skipped: [], error: null }, OPERATION)?.state).toBe('unresolved');
    expect(parseDiscountPromotionReceipt({ state: 'completed', operationId: OPERATION, promotionId: null, goodsCount: 2, periodCount: 3, skipped: [], error: null }, OPERATION)).toBeNull();
    expect(parseDiscountPromotionReceipt({ state: 'rejected', operationId: OPERATION, promotionId: null, goodsCount: 0, periodCount: 0, skipped: [], error: 'Bad message' }, OPERATION)).toBeNull();
  });
  it('목록·상세·중지 영수증·대상 목록', () => {
    expect(parseDiscountPromotionList({ checkedAt: '2026-11-11T09:00:00+00:00', total: 1, rows: [summary] })?.rows[0].target.label).toBe('홍실 오픈 기획전');
    expect(parseDiscountPromotionList({ checkedAt: '2026-11-11T09:00:00+00:00', total: 1, rows: [{ ...summary, state: 'stopped' }] })).toBeNull();
    const stopReceipt = { state: 'completed', operationId: '0f1c2a9e-3d4b-4c5d-8e6f-7a8b9c0d1e2f', promotionId: OPERATION, disabledCount: 3, goodsCount: 2, stoppedAt: '2026-11-21T00:00:00+00:00' };
    const detail = { ...summary, state: 'stopped', stoppedAt: '2026-11-21T00:00:00+00:00', stoppedByName: '운영자', checkedAt: '2026-11-21T00:00:00+00:00', stopReceipt,
      goods: ['good-a', 'good-b', 'good-d', 'good-g'].map(id => ({ id, name: id, code: null, archived: false, rule: { source: 'default', mode: 'rate', value: 10 },
        skip: id === 'good-d' ? 'price_period_overlap' : null, priceMin: 10000, priceMax: 10000,
        discounts: { active: 0, ended: 0, disabled: id === 'good-d' ? 0 : 1, minPrice: id === 'good-d' ? null : 9000, maxPrice: id === 'good-d' ? null : 9000 } })) };
    expect(parseDiscountPromotionDetail(detail)?.stopReceipt?.disabledCount).toBe(3);
    expect(parseDiscountPromotionDetail({ ...detail, stopReceipt: null })).toBeNull();
    expect(parseDiscountPromotionDetail({ ...detail, goods: detail.goods.slice(1) })?.goods).toHaveLength(3);
    expect(parseDiscountPromotionDetail({ ...detail, goods: [...detail.goods, { ...detail.goods[0], id: 'good-z' }] })).toBeNull();
    expect(parseDiscountPromotionStopReceipt(stopReceipt, { promotionId: OPERATION, operationId: stopReceipt.operationId })).not.toBeNull();
    expect(parseDiscountPromotionStopReceipt(stopReceipt, { promotionId: OPERATION, operationId: OPERATION })).toBeNull();
    expect(parseDiscountPromotionTargetOptions({ campaigns: [{ id: 'hongsil-open', title: '홍실', status: 'published', startsAt: summary.startsAt, endsAt: summary.endsAt, goodsCount: 8 }],
      ips: [{ id: 'maple', title: '메이플스토리', goodsCount: 120 }, { id: 'Old_IP', title: '옛 IP', goodsCount: 1 }] })?.ips).toEqual([{ id: 'maple', title: '메이플스토리', goodsCount: 120 }]);
  });
});

describe('할인 프로모션 화면 문구', () => {
  it('상태는 등록 상태와 기간·조회 시각으로 정한다', () => {
    expect(discountPromotionPhase(summary as never, '2026-11-19T00:00:00Z')).toBe('scheduled');
    expect(discountPromotionPhase(summary as never, '2026-11-25T00:00:00Z')).toBe('running');
    expect(discountPromotionPhase(summary as never, '2026-11-30T00:00:00Z')).toBe('ended');
    expect(discountPromotionPhase({ ...summary, state: 'stopped' } as never, '2026-11-25T00:00:00Z')).toBe('stopped');
  });
  it('규칙·건너뛴 이유·오류를 운영 문구로 읽는다', () => {
    expect([discountRuleLabel({ mode: 'rate', value: 10 }), discountRuleLabel({ mode: 'amount', value: 1500 }), discountRuleLabel({ mode: 'price', value: 7000 }), discountRuleLabel({ mode: 'exclude', value: null })])
      .toEqual(['10% 할인', '1,500원 할인', '예외가 7,000원', '할인 제외']);
    expect(discountPromotionSkipLabel('price_period_overlap')).toBe('기간이 겹치는 즉시할인이 이미 있음');
    expect(discountPromotionSkipLabel('discount_promotion_excluded')).toBe('예외로 할인에서 제외');
    expect(discountPromotionError('discount_promotion_changed')).toContain('다시 확인');
    expect(discountPromotionError('unknown_code')).toContain('처리하지 않았습니다');
  });
  it('주소는 프로모션 화면 아래에 둔다', () => {
    expect(discountPromotionHref(OPERATION)).toBe(`/admin/sales/discount-promotions/${OPERATION}`);
    expect(newDiscountPromotionHref({ campaign: 'hongsil-open' })).toBe('/admin/sales/discount-promotions/new?campaign=hongsil-open');
    expect(newDiscountPromotionHref({ ip: 'maple' })).toBe('/admin/sales/discount-promotions/new?ip=maple');
    expect(discountPromotionListHref({ campaign: 'hongsil-open', page: 2 })).toBe('/admin/sales/discount-promotions?campaign=hongsil-open&page=2');
    expect(discountPromotionListHref()).toBe('/admin/sales/discount-promotions');
  });
});

/* QA1 MD: 캠페인 편집에서 연 새 프로모션은 그 캠페인 편집으로 돌아가고, 규칙을 바꿔도 결과가 같은 건너뜀 줄은 규칙 선택을 잠근다. */
describe('할인 프로모션 QA1 정리', () => {
  it('캠페인 편집에서 연 새 프로모션 주소에 출처를 남긴다(기획전이 있을 때만)', () => {
    expect(newDiscountPromotionHref({ campaign: 'hongsil-open', from: 'campaign' })).toBe('/admin/sales/discount-promotions/new?campaign=hongsil-open&from=campaign');
    expect(newDiscountPromotionHref({ campaign: 'hongsil-open' })).toBe('/admin/sales/discount-promotions/new?campaign=hongsil-open');
    expect(newDiscountPromotionHref({ ip: 'maple', from: 'campaign' })).toBe('/admin/sales/discount-promotions/new?ip=maple');
  });
  it('기간 겹침·판매 옵션 없음·보관은 규칙을 잠그고, 할인 제외·할인가 범위 밖은 열어 둔다', () => {
    for (const skip of ['price_period_overlap', 'price_period_variant_inactive', 'good_archived']) expect(discountPromotionRuleLocked(skip), skip).toBe(true);
    for (const skip of [null, undefined, '', 'discount_promotion_excluded', 'goods_bulk_price_invalid']) expect(discountPromotionRuleLocked(skip), String(skip)).toBe(false);
  });
});
