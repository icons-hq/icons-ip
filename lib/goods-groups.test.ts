import { describe, expect, it } from 'vitest';
import type { Good } from './data';
import { goodsGroupAxisChoices, parsePublicGoodsGroup, resolvePublicGoodsGroup } from './goods-groups';
import { applyGoodsAggregationPolicy, goodsAggregationUnavailableLabel } from './goods-aggregation';
import { goodsPurchaseConditionProblem } from './goods-options';
import type { GoodsTransactionOffer } from './goods-transaction-offers';

const group = { id: 'a6140000-0000-4000-8000-000000000001', name: '색상 키링', optionNames: ['색상', '크기'], currentGoodId: 'red-small',
  members: [{ goodId: 'red-small', values: ['빨강', 'S'], sortOrder: 0 }, { goodId: 'red-large', values: ['빨강', 'L'], sortOrder: 1 },
    { goodId: 'blue-large', values: ['파랑', 'L'], sortOrder: 2 }] };
const good = (id: string): Good => ({ id, name: id, ip: 'test-ip', type: '키링', price: 12000, stock: 'ok', stockQty: 3, img: '', badge: null });

describe('공개 그룹 판매옵션', () => {
  it('현재 상품·조합·순서를 검증하고 공개 재조회에서 사라진 상품을 제외한다', () => {
    const reference = parsePublicGoodsGroup(group, 'red-small');
    expect(reference).toEqual(group);
    expect(resolvePublicGoodsGroup(reference, [good('red-small'), good('blue-large')])?.members.map(member => member.goodId)).toEqual(['red-small', 'blue-large']);
    expect(resolvePublicGoodsGroup(reference, [good('blue-large')])).toBeNull();
  });
  it('다른 상세의 응답·중복 조합·경로 주입·잘못된 축을 거절한다', () => {
    expect(parsePublicGoodsGroup(group, 'blue-large')).toBeNull();
    expect(parsePublicGoodsGroup({ ...group, members: [...group.members, { ...group.members[0], goodId: 'fourth', sortOrder: 3 }] }, 'red-small')).toBeNull();
    expect(parsePublicGoodsGroup({ ...group, members: [group.members[0], { ...group.members[1], goodId: '../admin' }] }, 'red-small')).toBeNull();
    expect(parsePublicGoodsGroup({ ...group, optionNames: ['색상', '색상'] }, 'red-small')).toBeNull();
    expect(parsePublicGoodsGroup({ ...group, internalCost: 5000 }, 'red-small')).toBeNull();
  });
  it('모든 조합이 없어도 다른 판매옵션에 접근하고 가능한 현재 값을 보존한다', () => {
    const resolved = resolvePublicGoodsGroup(group, group.members.map(member => good(member.goodId)))!;
    expect(goodsGroupAxisChoices(resolved, 0).find(choice => choice.value === '파랑')?.destination.goodId).toBe('blue-large');
    expect(goodsGroupAxisChoices(resolved, 1).find(choice => choice.value === 'L')?.destination.goodId).toBe('red-large');
    expect(goodsGroupAxisChoices(resolved, 3)).toEqual([]);
  });
});

describe('합산 정책의 공개 반영', () => {
  const offer: GoodsTransactionOffer = { goodId: 'blue-large', volume: null, delivery: null, collectReady: false, collector: null,
    aggregation: { id: group.id, requiresV2: true, runtimeEnabled: false },
    sharedPolicy: { originId: group.id, shippingFeeType: 'policy', individualFee: 0, orderQuantityLimitEnabled: true, minOrderQty: 2,
      maxOrderQty: 5, memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 8 } };
  it('원상품의 현재 한도를 표시하면서 해당 상품의 가격·재고·식별자를 보존한다', () => {
    const value = { ...good('blue-large'), minOrderQty: 99, maxOrderQty: 999 };
    applyGoodsAggregationPolicy(value, offer);
    expect(value).toMatchObject({ id: 'blue-large', price: 12000, stockQty: 3, minOrderQty: 2, maxOrderQty: 5, memberLifetimeQtyLimit: 8, originId: group.id });
    expect(goodsAggregationUnavailableLabel(value)).toBe('구매 준비 중');
    expect(goodsPurchaseConditionProblem(value)).toBe('구매 준비 중인 굿즈입니다.');
  });
  it('거래 기능이 열렸거나 합산군이 없는 기존 상품은 추가로 차단하지 않는다', () => {
    expect(goodsAggregationUnavailableLabel({ transactionOffer: { ...offer, aggregation: { ...offer.aggregation!, runtimeEnabled: true } } })).toBeNull();
    expect(goodsPurchaseConditionProblem(good('normal'))).toBeNull();
  });
});
