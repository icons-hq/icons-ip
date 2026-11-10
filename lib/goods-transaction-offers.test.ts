import { describe, expect, it } from 'vitest';
import { parseGoodsTransactionOffers } from './goods-transaction-offers';

const policy = { id: '00000000-0000-4000-8000-000000000001', goodId: 'good-a', revision: 1, status: 'active', draftValues: {},
  paymentMode: 'buyer_choice', quantityTerms: { kind: 'repeat', baseFee: 3000, interval: 2 } };
const offer = { goodId: 'good-a', volume: null, delivery: policy, collectReady: true,
  collector: { name: 'TEST 수납사', method: '배송 시 지급', refundContact: 'TEST 연락처', instructions: 'TEST 안내' } };

describe('공개 거래 조건 projection', () => {
  it('합산 식별자는 비공개 원상품 ID 없이 정책과 런타임 상태를 함께 받는다', () => {
    const aggregated = { ...offer, aggregation: { id: '00000000-0000-4000-8000-000000000009', requiresV2: true, runtimeEnabled: false },
      sharedPolicy: { originId: '00000000-0000-4000-8000-000000000008', shippingFeeType: 'individual', individualFee: 3000,
        orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 5, memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 10 } };
    expect(parseGoodsTransactionOffers([aggregated])).toEqual([aggregated]);
    expect(parseGoodsTransactionOffers([{ ...aggregated, aggregation: { ...aggregated.aggregation, ownerGoodId: 'private-source' } }])).toBeNull();
    expect(parseGoodsTransactionOffers([{ ...aggregated, sharedPolicy: undefined }])).toBeNull();
    expect(parseGoodsTransactionOffers([{ ...aggregated, aggregation: { ...aggregated.aggregation, requiresV2: false } }])).toBeNull();
    expect(parseGoodsTransactionOffers([{ ...aggregated, sharedPolicy: { ...aggregated.sharedPolicy, maxOrderQty: -1 } }])).toBeNull();
  });
  it('선택형 운임과 공개 수납 안내만 읽는다', () => {
    expect(parseGoodsTransactionOffers([offer])).toEqual([offer]);
    expect(parseGoodsTransactionOffers([{ ...offer, delivery: null, collectReady: false, collector: null }])).not.toBeNull();
  });
  it('새 그룹 공개 offer는 요금방식·이용가능 여부만 받고 비공개 원문을 거절한다', () => {
    const chargeGroup = { id:'00000000-0000-4000-8000-000000000009', revision:1, calculationMode:'max', regionalMode:'override', available:true, inherited:false };
    expect(parseGoodsTransactionOffers([{ ...offer, chargeGroup }])).toEqual([{ ...offer, chargeGroup }]);
    for (const value of [null, undefined, { ...chargeGroup, ownerGoodId:'PRIVATE' }, { ...chargeGroup, sourceEvidence:'PRIVATE' },
      { ...chargeGroup, name:'비공개 운영명' }, { ...chargeGroup, revision:0 }, { ...chargeGroup, available:'true' }]) {
      expect(parseGoodsTransactionOffers([{ ...offer, chargeGroup:value }])).toBeNull();
    }
    expect(parseGoodsTransactionOffers([offer])).toEqual([offer]);
  });
  it('비활성/다른 상품/초안·내부 근거 노출 및 중복을 거절한다', () => {
    expect(parseGoodsTransactionOffers([offer, offer])).toBeNull();
    for (const patch of [{ status: 'draft' }, { goodId: 'another-good' }, { draftValues: { baseFee: '3000' } }]) {
      expect(parseGoodsTransactionOffers([{ ...offer, delivery: { ...policy, ...patch } }])).toBeNull();
    }
    expect(parseGoodsTransactionOffers([{ ...offer, collector: { ...offer.collector, contractReference: 'private' } }])).toBeNull();
    expect(parseGoodsTransactionOffers([{ ...offer, collectReady: false }])).toBeNull();
    expect(parseGoodsTransactionOffers([{ ...offer, collector: null }])).toBeNull();
  });
});
