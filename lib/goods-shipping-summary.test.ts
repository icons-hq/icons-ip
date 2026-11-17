import { describe, expect, it } from 'vitest';
import type { GoodShippingPolicy } from './fulfillment';
import type { FulfillmentMethod, FulfillmentMethodTerms, GoodsFulfillment } from './goods-fulfillment';
import type { GoodsTransactionOffer } from './goods-transaction-offers';
import {
  DOMESTIC_SHIPPING_COUNTRY_LABEL,
  REMOTE_AREA_EXTRA_FEE_NOTICE,
  goodsShippingSummary,
} from './goods-shipping-summary';

const terms = (method: FulfillmentMethod, overrides: Partial<FulfillmentMethodTerms> = {}): FulfillmentMethodTerms =>
  ({ method, feeAmount: method === 'parcel' ? null : 0, feeBasis: 'per_order', installationFee: 0, ...overrides });

const fulfillment = (methods: FulfillmentMethodTerms[], overrides: Partial<GoodsFulfillment> = {}): GoodsFulfillment =>
  ({ goodId: 'g1', revision: 1, mode: 'shipping', methods, files: [], publicNote: '', ...overrides });

const policy = (overrides: Partial<GoodShippingPolicy> = {}): GoodShippingPolicy =>
  ({ originId: 'o1', originName: '김포', baseFee: 3000, freeThreshold: 40000, feeType: 'policy', individualFee: 0, ...overrides });

const offerBase: Pick<GoodsTransactionOffer, 'delivery' | 'chargeGroup'> = { delivery: null };
const rowsOf = (summary: ReturnType<typeof goodsShippingSummary>) => summary?.parcel?.rows.map(row => [row.label, row.value]);

describe('goodsShippingSummary (MD-0041)', () => {
  it('fulfillment 가 없으면 아무것도 그리지 않는다', () => {
    expect(goodsShippingSummary(undefined, policy(), offerBase)).toBeNull();
    expect(goodsShippingSummary(null, policy(), offerBase)).toBeNull();
  });

  describe('택배 단독', () => {
    it('제공 방식 줄 없이 배송국가·배송비·도서산간 안내만 낸다', () => {
      const summary = goodsShippingSummary(fulfillment([terms('parcel')]), policy(), offerBase);
      expect(summary?.methodsLabel).toBeNull();
      expect(rowsOf(summary)).toEqual([['배송국가', '대한민국'], ['배송비', '₩3,000 (₩40,000 이상 무료)']]);
      expect(summary?.parcel?.notice).toBe('도서산간 지역은 추가 비용이 발생할 수 있습니다.');
      expect(summary?.digital).toBe(false);
    });

    it('상수가 고정 문구와 같다', () => {
      expect(DOMESTIC_SHIPPING_COUNTRY_LABEL).toBe('대한민국');
      expect(REMOTE_AREA_EXTRA_FEE_NOTICE).toBe('도서산간 지역은 추가 비용이 발생할 수 있습니다.');
    });
  });

  it('택배와 다른 방식이 함께면 제공 방식 줄을 남기고 택배 블록을 더한다', () => {
    const summary = goodsShippingSummary(fulfillment([terms('parcel'), terms('pickup')]), policy(), offerBase);
    expect(summary?.methodsLabel).toBe('택배 · 방문수령');
    expect(rowsOf(summary)).toEqual([['배송국가', '대한민국'], ['배송비', '₩3,000 (₩40,000 이상 무료)']]);
  });

  describe('정책 인자 세 상태(위시리스트 구매 시트 D3)', () => {
    it('undefined(호출부가 정책을 싣지 않음)면 택배 블록 없이 옛 `제공 방식: 택배` 줄로 물러난다', () => {
      const only = goodsShippingSummary(fulfillment([terms('parcel')]), undefined, offerBase);
      expect(only).toEqual({ methodsLabel: '택배', parcel: null, digital: false, publicNote: '' });
      /* 다른 방식이 함께여도, 굿즈별 배송비 조건이 있어도 같다. */
      expect(goodsShippingSummary(fulfillment([terms('parcel'), terms('pickup')]), undefined, offerBase)).toMatchObject({ methodsLabel: '택배 · 방문수령', parcel: null });
      expect(goodsShippingSummary(fulfillment([terms('parcel', { feeAmount: 3000 })]), undefined, undefined)).toMatchObject({ methodsLabel: '택배', parcel: null });
      expect(goodsShippingSummary(fulfillment([terms('parcel')], { publicNote: '평일 출고' }), undefined, offerBase)?.publicNote).toBe('평일 출고');
    });

    it('null(상품 상세가 읽었는데 정책 없음)이면 택배 블록에서 배송비 행만 뺀다', () => {
      const summary = goodsShippingSummary(fulfillment([terms('parcel')]), null, offerBase);
      expect(summary?.methodsLabel).toBeNull();
      expect(rowsOf(summary)).toEqual([['배송국가', '대한민국']]);
      expect(summary?.parcel?.notice).toBe(REMOTE_AREA_EXTRA_FEE_NOTICE);
    });

    it('정책이 있으면 택배 블록에 정책 배송비를 말한다', () => {
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy(), offerBase))).toEqual([['배송국가', '대한민국'], ['배송비', '₩3,000 (₩40,000 이상 무료)']]);
    });

    it('택배가 없거나 디지털이면 정책 인자와 상관없이 현행 그대로다', () => {
      for (const shippingPolicy of [undefined, null, policy()]) {
        expect(goodsShippingSummary(fulfillment([terms('pickup')]), shippingPolicy, offerBase)).toMatchObject({ methodsLabel: '방문수령', parcel: null });
        expect(goodsShippingSummary(fulfillment([terms('digital')], { mode: 'digital' }), shippingPolicy, offerBase)).toMatchObject({ methodsLabel: '디지털 파일 다운로드', parcel: null, digital: true });
      }
    });
  });

  it('택배가 없으면 제공 방식 줄만 현행대로 둔다', () => {
    const pickup = goodsShippingSummary(fulfillment([terms('pickup')]), policy(), offerBase);
    expect(pickup).toMatchObject({ methodsLabel: '방문수령', parcel: null, digital: false });
    const quickDirect = goodsShippingSummary(fulfillment([terms('quick', { feeAmount: 5000 }), terms('direct', { feeAmount: 0 })]), policy(), offerBase);
    expect(quickDirect).toMatchObject({ methodsLabel: '퀵 · 직접배송', parcel: null });
    const none = goodsShippingSummary(fulfillment([terms('none')], { mode: 'no_delivery' }), policy(), offerBase);
    expect(none).toMatchObject({ methodsLabel: '배송없음 · 직접전달', parcel: null });
  });

  it('디지털 굿즈는 현행 그대로 — 제공 방식 줄과 파일 제공 안내, 택배 블록 없음', () => {
    const summary = goodsShippingSummary(fulfillment([terms('digital')], { mode: 'digital', publicNote: '구매 후 바로 받아요.' }), policy(), offerBase);
    expect(summary).toEqual({ methodsLabel: '디지털 파일 다운로드', parcel: null, digital: true, publicNote: '구매 후 바로 받아요.' });
  });

  it('공개 안내(publicNote)를 그대로 싣는다', () => {
    expect(goodsShippingSummary(fulfillment([terms('parcel')], { publicNote: '평일 출고' }), policy(), offerBase)?.publicNote).toBe('평일 출고');
  });

  describe('배송비 행', () => {
    it('방식 조건의 배송비(feeAmount)가 정책보다 먼저다 — 굿즈당이면 표시한다', () => {
      const perOrder = goodsShippingSummary(fulfillment([terms('parcel', { feeAmount: 2500 })]), policy(), offerBase);
      expect(rowsOf(perOrder)?.[1]).toEqual(['배송비', '₩2,500']);
      const perItem = goodsShippingSummary(fulfillment([terms('parcel', { feeAmount: 2500, feeBasis: 'per_item' })]), policy(), offerBase);
      expect(rowsOf(perItem)?.[1]).toEqual(['배송비', '₩2,500 (굿즈당)']);
      const zero = goodsShippingSummary(fulfillment([terms('parcel', { feeAmount: 0, feeBasis: 'per_item' })]), policy(), offerBase);
      expect(rowsOf(zero)?.[1]).toEqual(['배송비', '무료']);
    });

    it('굿즈별 배송비 조건·묶음배송이 있으면 배송비 행을 빼고 국가·안내만 남긴다(거래 조건 블록이 말한다)', () => {
      const delivery = { status: 'active' } as unknown as NonNullable<GoodsTransactionOffer['delivery']>;
      const chargeGroup = { id: 'cg', revision: 1, calculationMode: 'min', regionalMode: 'inherit', available: true, inherited: false } as unknown as GoodsTransactionOffer['chargeGroup'];
      const withDelivery = goodsShippingSummary(fulfillment([terms('parcel')]), policy(), { delivery, chargeGroup: undefined });
      expect(rowsOf(withDelivery)).toEqual([['배송국가', '대한민국']]);
      expect(withDelivery?.parcel?.notice).toBe(REMOTE_AREA_EXTRA_FEE_NOTICE);
      const withGroup = goodsShippingSummary(fulfillment([terms('parcel')]), policy(), { delivery: null, chargeGroup });
      expect(rowsOf(withGroup)).toEqual([['배송국가', '대한민국']]);
      /* 방식 조건의 배송비는 그래도 말한다. */
      const direct = goodsShippingSummary(fulfillment([terms('parcel', { feeAmount: 3000 })]), policy(), { delivery, chargeGroup: undefined });
      expect(rowsOf(direct)?.[1]).toEqual(['배송비', '₩3,000']);
    });

    it('정책 배송비: 무료 기준이 있으면 정책 값에서 계산해 붙이고 없으면 금액만 낸다', () => {
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy({ baseFee: 4700, freeThreshold: 62000 }), offerBase))?.[1]).toEqual(['배송비', '₩4,700 (₩62,000 이상 무료)']);
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy({ freeThreshold: null }), offerBase))?.[1]).toEqual(['배송비', '₩3,000']);
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy({ baseFee: 0, freeThreshold: null }), offerBase))?.[1]).toEqual(['배송비', '무료']);
    });

    it('무료 정책·굿즈당 정책', () => {
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy({ feeType: 'free' }), offerBase))?.[1]).toEqual(['배송비', '무료']);
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy({ feeType: 'individual', individualFee: 2000 }), offerBase))?.[1]).toEqual(['배송비', '₩2,000 (굿즈당 1회)']);
    });

    it('정책이 없다고 읽혔으면(null) 배송비 행만 생략한다', () => {
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), null, offerBase))).toEqual([['배송국가', '대한민국']]);
      expect(rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), null, undefined))).toEqual([['배송국가', '대한민국']]);
    });

    it('숫자를 코드가 정하지 않는다 — 정책 값만 바꿔도 화면 값이 따라간다', () => {
      const at = (freeThreshold: number) => rowsOf(goodsShippingSummary(fulfillment([terms('parcel')]), policy({ freeThreshold }), offerBase))?.[1][1];
      expect(at(50000)).toBe('₩3,000 (₩50,000 이상 무료)');
      expect(at(40000)).toBe('₩3,000 (₩40,000 이상 무료)');
      expect(at(77777)).toBe('₩3,000 (₩77,777 이상 무료)');
    });
  });
});
