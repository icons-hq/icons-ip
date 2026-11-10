import { describe, expect, it } from 'vitest';
import type { Good, GoodOption } from './data';
import type { GoodsTransactionOffer } from './goods-transaction-offers';
import { goodsDeliveryPaymentLabel, goodsPurchaseVolumePreview, goodsQuantityDeliveryLabel, goodsQuantityDeliveryPreview, goodsVolumeBoundary, goodsVolumeConditionLabel } from './goods-transaction-presentation';
const offer: GoodsTransactionOffer = { goodId: 'one', volume: { id: '00000000-0000-4000-8000-000000000001', goodId: 'one', revision: 1, status: 'active', draftValues: {},
  terms: { condition: 'quantity', threshold: 3, discountKind: 'fixed', discountValue: 1000, startsAt: null, endsAt: null } },
  delivery: { id: '00000000-0000-4000-8000-000000000002', goodId: 'one', revision: 1, status: 'active', draftValues: {}, paymentMode: 'collect', quantityTerms: { kind: 'tier3', baseFee: 3000, firstLimit: 2, secondLimit: 4, extra1: 1000, extra2: 2500 } },
  collectReady: false, collector: null };
const good: Good = { id: 'one', name: 'TEST 상품', ip: 'test', type: '문구', price: 8000, stockQty: 100, stock: 'ok', badge: null, img: '',
  transactionOffer: offer, transactionCalculatedAt: '2026-10-14T00:00:00Z' };
const option = { id: '00000000-0000-4000-8000-000000000003', price: 8000,
  pricing: { regularPrice: 10000, effectivePrice: 8000, calculatedAt: '2026-10-14T00:00:00Z' } } as GoodOption;
describe('상품상세 거래조건 표시', () => {
  it('원상품에서 분리된 상품의 수량을 합산하고 표시 라인의 실제 상품은 유지한다', () => {
    const aggregation = { id: '00000000-0000-4000-8000-000000000009', requiresV2: true as const, runtimeEnabled: true };
    const first = { ...good, transactionOffer: { ...offer, aggregation } };
    const second = { ...good, id: 'two', price: 5000, transactionOffer: { ...offer, goodId: 'two', aggregation,
      volume: { ...offer.volume!, goodId: 'two' } } };
    const preview = goodsPurchaseVolumePreview([{ good: first, option, quantity: 2 }, { good: second, quantity: 1 }]);
    expect(preview).toMatchObject({ subtotal: 21000, volumeDiscountTotal: 3000, netSubtotal: 18000 });
    expect(preview?.lines.map(line => line.goodId)).toEqual(['one', 'two']);
    expect(goodsVolumeConditionLabel(first.transactionOffer)).toBe('같은 굿즈에서 나뉜 항목 합산 3개 이상 구매 시 개당 ₩1,000 할인');
    expect(goodsPurchaseVolumePreview([{ good: first, option, quantity: 2 }, { good: { ...second, transactionOffer: {
      ...second.transactionOffer, volume: { ...second.transactionOffer.volume, revision: 2 } } }, quantity: 1 }])).toBeNull();
  });
  it('같은 상품 옵션 수량만 합쳐 기간단가에 개당 할인한다', () => {
    const preview = goodsPurchaseVolumePreview([{ good, option, quantity: 2 }, { good, option, quantity: 1 },
      { good: { ...good, id: 'two', price: 5000, transactionOffer: { ...offer, goodId: 'two', volume: null, delivery: null } }, quantity: 1 }]);
    expect(preview).toMatchObject({ subtotal: 29000, volumeDiscountTotal: 3000, netSubtotal: 26000 });
    expect(goodsVolumeConditionLabel(offer)).toBe('같은 굿즈 3개 이상 구매 시 개당 ₩1,000 할인');
  });
  it('정상가 조건과 시간 경계를 현재할인 여부와 구분한다', () => {
    const timed = { ...good, transactionOffer: { ...offer, volume: { ...offer.volume!, terms: { ...offer.volume!.terms!, condition: 'regular_subtotal' as const, threshold: 30000,
      startsAt: '2026-10-15T00:00:00Z', endsAt: '2026-10-16T00:00:00Z' } } } };
    expect(goodsVolumeConditionLabel(timed.transactionOffer)).toContain('옵션 정상가 합계 ₩30,000');
    expect(goodsVolumeBoundary(timed)).toBe('2026-10-15T00:00:00Z');
    expect(goodsPurchaseVolumePreview([{ good: timed, option, quantity: 3 }])?.volumeDiscountTotal).toBe(0);
    expect(goodsVolumeBoundary({ ...timed, transactionCalculatedAt: '2026-10-16T00:00:00Z' })).toBeNull();
  });
  it('3구간 추가료를 누적하지 않고 착불을 온라인결제와 구분한다', () => {
    expect(goodsQuantityDeliveryPreview(offer, 5)).toBe(5500);
    expect(goodsQuantityDeliveryLabel(offer.delivery!.quantityTerms!)).toBe('2개까지 ₩3,000, 4개까지 ₩4,000, 초과 시 ₩5,500');
    expect(goodsDeliveryPaymentLabel(offer)).toContain('배송 시 결제(착불)');
    expect(goodsDeliveryPaymentLabel({ ...offer, delivery: { ...offer.delivery!, paymentMode: 'buyer_choice' } })).toContain('선결제 또는 착불 선택');
  });
  it('조회 실패·비정상 수량·시각 없음은 할인0원이라는 확정값으로 바꾸지 않는다', () => {
    expect(goodsPurchaseVolumePreview([{ good: { ...good, transactionOffer: null }, option, quantity: 3 }])).toBeNull();
    expect(goodsPurchaseVolumePreview([{ good, option, quantity: -1 }])).toBeNull();
    expect(goodsPurchaseVolumePreview([{ good: { ...good, transactionCalculatedAt: undefined }, quantity: 3 }])).toBeNull();
    expect(goodsQuantityDeliveryPreview(offer, -1)).toBeNull();
  });
});
